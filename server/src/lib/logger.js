import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import winston from 'winston';

import configLoader from '../config/configLoader.js';

// Per-category winston logger for patchpanel. Three user-facing categories
// (`app`, `api`, `auth`) each get their own active log file under
// <logDir>/current/<name>.log; rotation moves the prior day's file into
// <logDir>/archives/<name>.log.YYYY-MM-DD (with `.N` suffix for multiple
// rotations on the same day). All categories also fan-out to a shared
// error sink at <logDir>/current/error.log so error-level events are
// queryable in one place regardless of which category emitted them.
//
// Rotation is hand-rolled on top of winston.transports.File rather than
// via winston-daily-rotate-file — the latter's `createSymlink` feature and
// `%DATE%`-in-active-filename pattern haven't held up in boxvault/armor
// production. Active files keep stable names so `tail -f current/app.log`
// Just Works; rotated copies live under archives/. Archives older than
// compression_age_days get gzipped; archives beyond max_files get deleted
// oldest-first.
//
// On boot, any pre-existing active file is moved into archives/ with
// today's date stamp so today's log starts clean. Rotation thereafter
// happens lazily in the transport's write() hook the first time a record
// is emitted on a new calendar day.
//
// Use:
//   import { log, createTimer, requestLoggingMiddleware } from './logger.js';
//   log.app.info('state applied', { ms: 42 });
//   log.api.warn('rate limit hit', { ip });
//   log.auth.error('login failed', { username, reason });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATEGORIES = Object.freeze({
  app: { filename: 'app', defaultLevel: 'info' },
  api: { filename: 'api', defaultLevel: 'info' },
  auth: { filename: 'auth', defaultLevel: 'info' },
});

const ERROR_FILENAME = 'error';

const readLoggingConfig = () => {
  try {
    return configLoader.getConfig().logging ?? {};
  } catch {
    return {};
  }
};

const loggingConfig = readLoggingConfig();

const consoleEnabled = loggingConfig.console_enabled !== false;
const performanceThresholdMs = loggingConfig.performance_threshold_ms ?? 1000;
const enableCompression = loggingConfig.enable_compression !== false;
const compressionAgeDays = loggingConfig.compression_age_days ?? 7;
const maxFilesPerCategory = loggingConfig.max_files ?? 30;

const categoryLevel = name => {
  const fromYaml = loggingConfig.categories?.[name];
  if (typeof fromYaml === 'string' && fromYaml.length > 0) {
    return fromYaml;
  }
  return CATEGORIES[name].defaultLevel;
};

// Prefer the configured log directory; fall back to ../../logs relative to
// this file when the configured path isn't writable (dev shells, containers
// without root). Lets `npm run dev` Just Work without sudo.
const resolveLogDir = configured => {
  const tryDir = dir => {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'test');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      return null;
    }
  };
  const preferred = configured ?? '/var/log/patchpanel';
  const resolved = tryDir(preferred);
  if (resolved) {
    return resolved;
  }
  const fallback = path.resolve(__dirname, '..', '..', 'logs');
  return tryDir(fallback) ?? fallback;
};

const logDir = resolveLogDir(loggingConfig.directory);
const currentDir = path.join(logDir, 'current');
const archivesDir = path.join(logDir, 'archives');

const ensureDir = dir => {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  } catch {
    // Rotation paths re-create lazily; transport keeps working.
  }
};

ensureDir(currentDir);
ensureDir(archivesDir);

// ---- rotation primitives -----------------------------------------------

const compressFile = async filePath => {
  try {
    const gzPath = `${filePath}.gz`;
    if (fs.existsSync(gzPath)) {
      return;
    }
    await new Promise((resolve, reject) => {
      const reader = fs.createReadStream(filePath);
      const writer = fs.createWriteStream(gzPath);
      reader.pipe(zlib.createGzip()).pipe(writer).on('finish', resolve).on('error', reject);
    });
    await fs.promises.unlink(filePath);
  } catch {
    // best-effort; missing/locked files are tolerable
  }
};

const isStaleArchive = (filename, base, cutoff) => {
  if (!filename.startsWith(base) || filename.endsWith('.gz')) {
    return false;
  }
  const m = filename.match(/\.(?<date>\d{4}-\d{2}-\d{2})(?:\.\d+)?$/u);
  if (!m) {
    return false;
  }
  return new Date(m.groups.date) < cutoff;
};

const compressOldArchives = async (base, options) => {
  if (!options.enableCompression) {
    return;
  }
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.compressionAgeDays);
    const archives = await fs.promises.readdir(archivesDir);
    const stale = archives.filter(f => isStaleArchive(f, base, cutoff));
    await Promise.all(stale.map(f => compressFile(path.join(archivesDir, f))));
  } catch {
    // ignore — best-effort housekeeping
  }
};

const pruneArchives = async (base, maxFiles) => {
  try {
    const archives = await fs.promises.readdir(archivesDir);
    const matching = archives
      .filter(f => f.startsWith(base))
      .sort()
      .reverse();
    if (matching.length > maxFiles) {
      const overflow = matching.slice(maxFiles);
      await Promise.all(overflow.map(f => fs.promises.unlink(path.join(archivesDir, f))));
    }
  } catch {
    // ignore
  }
};

const reserveArchivePath = base => {
  const [today] = new Date().toISOString().split('T');
  let candidate = path.join(archivesDir, `${base}.${today}`);
  let counter = 1;
  while (fs.existsSync(candidate) && counter < 1000) {
    candidate = path.join(archivesDir, `${base}.${today}.${counter}`);
    counter += 1;
  }
  return candidate;
};

const renameToArchive = async filePath => {
  const base = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const archivePath = reserveArchivePath(base);
  try {
    await fs.promises.rename(filePath, archivePath);
    return base;
  } catch {
    return null;
  }
};

const rotateLogFile = async (filePath, options) => {
  try {
    await fs.promises.mkdir(archivesDir, { recursive: true });
  } catch {
    return;
  }
  const base = await renameToArchive(filePath);
  if (!base) {
    return;
  }
  await compressOldArchives(base, options);
  await pruneArchives(base, options.maxFiles);
};

// Boot-time sweep: any active file that survived a prior process restart
// gets moved into archives/ with today's stamp so today's session starts
// fresh. Synchronous + best-effort so we never block startup on a stuck
// filesystem.
const initializeLogDirectory = () => {
  try {
    ensureDir(currentDir);
    ensureDir(archivesDir);
    const expected = [
      ...Object.values(CATEGORIES).map(c => `${c.filename}.log`),
      `${ERROR_FILENAME}.log`,
    ];
    for (const name of expected) {
      const activePath = path.join(currentDir, name);
      if (!fs.existsSync(activePath)) {
        continue;
      }
      try {
        const target = reserveArchivePath(name);
        fs.renameSync(activePath, target);
      } catch {
        // leave the active file in place; next rotation handles it
      }
    }
  } catch {
    // ignore — best-effort
  }
};

initializeLogDirectory();

class DailyRotatingFileTransport extends winston.transports.File {
  constructor(options) {
    super(options);
    this.rotationOptions = {
      enableCompression: options.enableCompression ?? enableCompression,
      compressionAgeDays: options.compressionAgeDays ?? compressionAgeDays,
      maxFiles: options.maxFiles ?? maxFilesPerCategory,
    };
    this.lastRotateDate = null;
  }

  async write(info, callback) {
    try {
      const [today] = new Date().toISOString().split('T');
      if (this.lastRotateDate !== today && fs.existsSync(this.filename)) {
        await rotateLogFile(this.filename, this.rotationOptions);
      }
      this.lastRotateDate = today;
    } catch {
      // Let super.write proceed with whatever the active file looks like.
    }
    super.write(info, callback);
  }
}

// ---- formats -----------------------------------------------------------

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ level, message, timestamp, category, ...meta }) => {
    const categoryStr = category ? `[${category}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${categoryStr} ${level}: ${message}${metaStr}`;
  })
);

// ---- transports + loggers ---------------------------------------------

const makeCategoryTransport = (name, definition) =>
  new DailyRotatingFileTransport({
    filename: path.join(currentDir, `${definition.filename}.log`),
    level: categoryLevel(name),
    format: fileFormat,
  });

const errorTransport = new DailyRotatingFileTransport({
  filename: path.join(currentDir, `${ERROR_FILENAME}.log`),
  level: 'error',
  format: fileFormat,
});

const consoleTransport = consoleEnabled
  ? new winston.transports.Console({ format: consoleFormat })
  : null;

const createCategoryLogger = (name, definition) => {
  const transports = [makeCategoryTransport(name, definition), errorTransport];
  if (consoleTransport) {
    transports.push(consoleTransport);
  }
  return winston.createLogger({
    level: categoryLevel(name),
    format: fileFormat,
    defaultMeta: { category: name, service: 'patchpanel' },
    transports,
    exitOnError: false,
  });
};

const categoryLoggers = Object.fromEntries(
  Object.entries(CATEGORIES).map(([name, def]) => [name, createCategoryLogger(name, def)])
);

// ---- safe-log wrapper --------------------------------------------------

const MAX_STRING_LEN = 1000;

// Manual recursive walk — avoids JSON.stringify's replacer signature (which
// forces an unused first-arg `key`). Truncates long strings, breaks
// circular references, returns a structurally-safe clone that winston can
// serialise without choking.
const sanitizeValue = (value, seen) => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? `${value.slice(0, MAX_STRING_LEN)}… (truncated)` : value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, seen));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = sanitizeValue(v, seen);
  }
  return out;
};

const sanitize = value => sanitizeValue(value, new WeakSet());

const safeLog = (loggerInstance, level, message, meta = {}) => {
  try {
    loggerInstance[level](message, sanitize(meta));
  } catch (err) {
    const ts = new Date().toISOString();
    const tail = meta && Object.keys(meta).length > 0 ? ' …' : '';
    process.stderr.write(
      `${ts} [${level.toUpperCase()}] ${message}${tail} (winston error: ${err.message})\n`
    );
  }
};

const makeCategoryShortcuts = name => {
  const instance = categoryLoggers[name];
  return {
    info: (msg, meta) => safeLog(instance, 'info', msg, meta),
    warn: (msg, meta) => safeLog(instance, 'warn', msg, meta),
    error: (msg, meta) => safeLog(instance, 'error', msg, meta),
    debug: (msg, meta) => safeLog(instance, 'debug', msg, meta),
  };
};

export const log = Object.freeze(
  Object.fromEntries(Object.keys(CATEGORIES).map(name => [name, makeCategoryShortcuts(name)]))
);

// ---- timers + request middleware --------------------------------------

export const createTimer = operation => {
  const start = process.hrtime.bigint();
  return {
    end: (meta = {}) => {
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const rounded = Math.round(elapsedMs * 100) / 100;
      if (rounded >= performanceThresholdMs) {
        log.app.warn(`slow operation: ${operation}`, {
          operation,
          duration_ms: rounded,
          threshold_ms: performanceThresholdMs,
          ...meta,
        });
      }
      return rounded;
    },
  };
};

export const generateRequestId = () =>
  `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const isStaticAsset = pathname =>
  pathname.startsWith('/static/') ||
  pathname.startsWith('/assets/') ||
  /\.(?:js|mjs|css|map|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|otf|eot)$/u.test(pathname);

export const createRequestLogger = (requestId, req) => {
  const start = Date.now();
  const baseMeta = {
    requestId,
    method: req.method,
    path: req.path,
    user: req.user?.username ?? req.user?.id ?? null,
    ip: req.ip ?? req.socket?.remoteAddress,
    userAgent: req.get?.('User-Agent'),
  };
  const skip = isStaticAsset(req.path);
  if (!skip) {
    log.api.info('request started', baseMeta);
  }
  return {
    success: (statusCode, meta = {}) => {
      if (skip) {
        return;
      }
      log.api.info('request completed', {
        ...baseMeta,
        status: statusCode,
        duration_ms: Date.now() - start,
        success: true,
        ...meta,
      });
    },
    error: (statusCode, errOrMessage, meta = {}) => {
      const errMessage =
        typeof errOrMessage === 'string'
          ? errOrMessage
          : (errOrMessage?.message ?? 'unknown error');
      log.api.error('request failed', {
        ...baseMeta,
        status: statusCode,
        duration_ms: Date.now() - start,
        success: false,
        error: errMessage,
        ...meta,
      });
    },
  };
};

export const requestLoggingMiddleware = () => (req, res, next) => {
  const requestId = generateRequestId();
  req.requestId = requestId;
  const reqLogger = createRequestLogger(requestId, req);
  req.log = reqLogger;
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      reqLogger.error(res.statusCode, res.statusMessage);
    } else {
      reqLogger.success(res.statusCode);
    }
  });
  next();
};

log.app.info('logger initialized', {
  logDirectory: logDir,
  currentDirectory: currentDir,
  archivesDirectory: archivesDir,
  consoleEnabled,
  categories: Object.keys(CATEGORIES),
});
