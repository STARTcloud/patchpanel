import logger from 'loglevel';

// Frontend logger — derived from BoxVault's frontend/src/utils/Logger.js with
// the structural pattern preserved (lazy init from /api/health, named
// category loggers, `[CATEGORY] message {metadata}` shape) plus six
// patchpanel-specific additions none of the sibling projects have:
//
//   1. early `configLoaded = true` to fix BoxVault's repeat-init race when
//      logging is disabled
//   2. DRY level methods generated from a LEVELS array (no 60-line block
//      of near-identical handlers)
//   3. localStorage-preserving setLevel — devs who set
//      `log.getLogger('api').setLevel('debug')` from DevTools have their
//      preference honored across reloads, not clobbered by /api/health
//   4. metadata redaction — keys matching the SENSITIVE_KEYS set are
//      replaced with "[redacted]" before logging, buffering, or shipping
//   5. URL + userAgent auto-attached to error-level metadata so bug
//      reports include the route the user was on
//   6. ring buffer of the last RING_BUFFER_SIZE log entries — shipped
//      alongside error reports so server-side audit has the recent context
//   7. error shipping to POST /api/client-errors — debounced batch flush,
//      capped queue, fire-and-forget (failures are silently dropped to
//      avoid amplifying outages)

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];
const CATEGORIES = ['app', 'auth', 'api', 'state', 'haproxy', 'cert', 'peer', 'error'];
const VALID_LOGLEVEL_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'silent']);

const DEFAULT_LOGGING_CONFIG = Object.freeze({
  enabled: true,
  level: 'debug',
  categories: Object.freeze(Object.fromEntries(CATEGORIES.map(c => [c, 'debug']))),
});

const RING_BUFFER_SIZE = 100;
const MAX_ERROR_QUEUE_SIZE = 50;
const ERROR_FLUSH_DEBOUNCE_MS = 1000;

// Keys whose values are stripped from metadata before any log/buffer/ship.
// Matched case-insensitively against object keys; nested objects are walked.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'currentpassword',
  'newpassword',
  'secret',
  'token',
  'authtoken',
  'auth_token',
  'authorization',
  'apikey',
  'api_key',
  'jwt',
  'cookie',
  'wire',
  'privkey',
  'privkeypem',
  'privatekey',
  'pem',
  'fullchain',
  'fullchainpem',
]);

// Exported for tests + ad-hoc reuse in call sites that want to redact a value
// before passing it to something other than the logger (e.g. surfacing in an
// Alert). Recursive, case-insensitive key match.
export const redact = value => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
    } else {
      out[key] = redact(val);
    }
  }
  return out;
};

// ---- Ring buffer ----
const ringBuffer = [];

const pushToBuffer = entry => {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
};

// ---- Error shipping ----
const errorQueue = [];
let flushTimer = null;
let shippingInFlight = false;

const flushErrors = async () => {
  flushTimer = null;
  if (errorQueue.length === 0 || shippingInFlight) {
    return;
  }
  const batch = errorQueue.splice(0, errorQueue.length);
  const recent = ringBuffer.slice();
  shippingInFlight = true;
  try {
    await fetch(`${window.location.origin}/api/client-errors`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errors: batch, recent }),
    });
  } catch {
    // Best effort. Don't requeue on failure — a broken /api/client-errors
    // mustn't amplify into an unbounded retry storm.
  } finally {
    shippingInFlight = false;
  }
};

const scheduleErrorFlush = () => {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(flushErrors, ERROR_FLUSH_DEBOUNCE_MS);
};

const queueErrorForShipping = entry => {
  if (errorQueue.length >= MAX_ERROR_QUEUE_SIZE) {
    errorQueue.shift();
  }
  errorQueue.push(entry);
  scheduleErrorFlush();
};

// ---- localStorage-aware level application ----
const hasLocalStorageOverride = name => {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(`loglevel:${name}`) !== null;
  } catch {
    return false;
  }
};

// ---- Config fetch + init ----
const REFRESH_MIN_INTERVAL_MS = 60_000;

let configLoaded = false;
let configPromise = null;
let lastConfigFetchAt = 0;

const fetchConfigOnce = async () => {
  try {
    const response = await fetch(`${window.location.origin}/api/health`);
    if (!response.ok) {
      throw new Error(`Health endpoint returned ${response.status}`);
    }
    return await response.json();
  } catch {
    return { environment: 'development', frontendLogging: DEFAULT_LOGGING_CONFIG };
  }
};

const loadConfig = () => {
  if (configPromise) {
    return configPromise;
  }
  configPromise = fetchConfigOnce().then(result => {
    lastConfigFetchAt = Date.now();
    return result;
  });
  return configPromise;
};

const mapLoglevelToMethod = level => {
  if (typeof level === 'string' && VALID_LOGLEVEL_LEVELS.has(level)) {
    return level;
  }
  return 'info';
};

const initializeLoggers = async () => {
  if (configLoaded) {
    return;
  }
  configLoaded = true;
  const config = await loadConfig();
  const loggingConfig = config.frontendLogging || DEFAULT_LOGGING_CONFIG;

  if (!loggingConfig.enabled) {
    logger.setLevel('silent', false);
    return;
  }

  const defaultLevel = mapLoglevelToMethod(loggingConfig.level);
  if (!hasLocalStorageOverride('')) {
    logger.setLevel(defaultLevel, false);
  }

  for (const category of CATEGORIES) {
    if (hasLocalStorageOverride(category)) {
      continue;
    }
    const categoryLogger = logger.getLogger(category);
    const level = loggingConfig.categories?.[category] ?? loggingConfig.level;
    categoryLogger.setLevel(mapLoglevelToMethod(level), false);
  }
};

// Re-fetch config + re-apply levels. Triggered by a visibility-change
// listener so operators who change `frontendLogging.*` on the backend see
// the new levels apply on next tab focus (rate-limited to once per minute
// per tab to avoid storms). User-set localStorage overrides still win.
const refreshConfig = async () => {
  if (Date.now() - lastConfigFetchAt < REFRESH_MIN_INTERVAL_MS) {
    return;
  }
  configPromise = null;
  configLoaded = false;
  await initializeLoggers();
};

// ---- Wrapped emit ----
const enrichErrorMetadata = metadata => {
  const enriched = metadata ? { ...metadata } : {};
  enriched.url = `${window.location.pathname}${window.location.search}`;
  enriched.userAgent = navigator.userAgent;
  return enriched;
};

const emit = (categoryLogger, level, category, message, metadata) => {
  const enrichedMetadata = level === 'error' ? enrichErrorMetadata(metadata) : metadata;
  const redactedMetadata = redact(enrichedMetadata);
  const hasMetadata =
    redactedMetadata && typeof redactedMetadata === 'object'
      ? Object.keys(redactedMetadata).length > 0
      : false;
  const tagged = `[${category.toUpperCase()}] ${message}`;

  if (hasMetadata) {
    categoryLogger[level](tagged, redactedMetadata);
  } else {
    categoryLogger[level](tagged);
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    metadata: hasMetadata ? redactedMetadata : null,
  };
  pushToBuffer(entry);
  if (level === 'error') {
    queueErrorForShipping(entry);
  }
};

const createLazyLogger = category => {
  const categoryLogger = logger.getLogger(category);
  return Object.fromEntries(
    LEVELS.map(level => [
      level,
      (message, metadata) => {
        initializeLoggers().then(() => {
          emit(categoryLogger, level, category, message, metadata);
        });
      },
    ])
  );
};

export const log = Object.fromEntries(
  CATEGORIES.map(category => [category, createLazyLogger(category)])
);

// Operator-side level changes on the backend reach this tab on next focus
// (rate-limited inside refreshConfig). One-shot wire — survives the page
// lifetime; no removal needed.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshConfig().catch(() => {
        // refresh failures are silent — same rationale as flushErrors
      });
    }
  });
}

export default log;
