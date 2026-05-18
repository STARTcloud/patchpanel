import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

import { ReloadError, StateError } from './errors.js';
import { log } from './logger.js';

// Mirror of haproxy-control.js for keepalived. Same auto-detect of supervisor
// strategy:
//
//   s6      → s6-svc -h /run/service/keepalived (reload via SIGHUP)
//   systemd → systemctl reload|stop|start keepalived
//   direct  → SIGHUP / SIGTERM the pid from keepalivedPidFile, can't start
//
// Override via KEEPALIVED_CONTROL_STRATEGY env var.

const S6_SERVICE_DIR = '/run/service/keepalived';
const SYSTEMD_RUN_DIR = '/run/systemd/system';
const DEFAULT_PID_PATH = '/run/keepalived.pid';
const TIMEOUT_MS = 30_000;

const fileExists = async path => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const runCommand = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => stdoutChunks.push(chunk));
    child.stderr.on('data', chunk => stderrChunks.push(chunk));
    child.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });

const detectStrategy = async () => {
  const envOverride = process.env.KEEPALIVED_CONTROL_STRATEGY;
  if (envOverride && ['s6', 'systemd', 'direct'].includes(envOverride)) {
    return envOverride;
  }
  if (await fileExists(S6_SERVICE_DIR)) {
    return 's6';
  }
  if (await fileExists(SYSTEMD_RUN_DIR)) {
    return 'systemd';
  }
  return 'direct';
};

let cachedStrategy = null;
const pickStrategy = async () => {
  if (cachedStrategy) {
    return cachedStrategy;
  }
  cachedStrategy = await detectStrategy();
  log.app.info('keepalived control strategy resolved', { strategy: cachedStrategy });
  return cachedStrategy;
};

const readPid = async pidPath => {
  const raw = await fs.readFile(pidPath ?? DEFAULT_PID_PATH, 'utf8').catch(() => '');
  const pid = Number.parseInt(raw.trim().split(/\s+/u)[0], 10);
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new StateError('cluster.keepalived.pidUnreadable', {
      replacements: { path: pidPath ?? DEFAULT_PID_PATH },
    });
  }
  return pid;
};

const signalViaDirect = async (pidPath, signal, action) => {
  const pid = await readPid(pidPath);
  process.kill(pid, signal);
  return { code: 0, stdout: `${signal} sent to pid ${pid} (${action})`, stderr: '' };
};

const requireOk = (result, action) => {
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout).trim();
    throw new ReloadError('cluster.keepalived.reloadFailed', {
      replacements: { action, code: result.code, output },
    });
  }
  return result;
};

// Keepalived reload is SIGHUP — graceful, picks up new config without
// dropping the VIP. systemctl reload + s6-svc -h both translate to SIGHUP.
export const reload = async (config = {}) => {
  const strategy = await pickStrategy();
  log.app.info('keepalived reload requested', { strategy });
  if (strategy === 's6') {
    return requireOk(await runCommand('s6-svc', ['-h', S6_SERVICE_DIR], TIMEOUT_MS), 's6-svc -h');
  }
  if (strategy === 'systemd') {
    return requireOk(
      await runCommand('systemctl', ['reload', 'keepalived'], TIMEOUT_MS),
      'systemctl reload keepalived'
    );
  }
  return signalViaDirect(config.pidPath, 'SIGHUP', 'reload');
};

export const stop = async (config = {}) => {
  const strategy = await pickStrategy();
  log.app.info('keepalived stop requested', { strategy });
  if (strategy === 's6') {
    return requireOk(await runCommand('s6-svc', ['-Dwd', S6_SERVICE_DIR], TIMEOUT_MS), 's6-svc -D');
  }
  if (strategy === 'systemd') {
    return requireOk(
      await runCommand('systemctl', ['stop', 'keepalived'], TIMEOUT_MS),
      'systemctl stop keepalived'
    );
  }
  return signalViaDirect(config.pidPath, 'SIGTERM', 'stop');
};

export const start = async () => {
  const strategy = await pickStrategy();
  log.app.info('keepalived start requested', { strategy });
  if (strategy === 's6') {
    return requireOk(await runCommand('s6-svc', ['-Uwu', S6_SERVICE_DIR], TIMEOUT_MS), 's6-svc -U');
  }
  if (strategy === 'systemd') {
    return requireOk(
      await runCommand('systemctl', ['start', 'keepalived'], TIMEOUT_MS),
      'systemctl start keepalived'
    );
  }
  throw new StateError('cluster.keepalived.startUnsupported');
};

// Binary-presence probe. The UI badge gates on this — if keepalived isn't
// installed at the configured binPath we hide the indicator entirely
// instead of leaving it stuck at "checking" (the previous behaviour, which
// was indistinguishable from a genuinely indeterminate isAlive() result on
// deployments that simply don't ship keepalived).
export const isInstalled = (config = {}) => {
  const bin = config.keepalivedBin || '/usr/sbin/keepalived';
  return fileExists(bin);
};

const KEEPALIVED_DATA_PATH = '/tmp/keepalived.data';
const SIGUSR2_SETTLE_MS = 300;
const STATE_CACHE_TTL_MS = 2500;

let stateCache = { ts: 0, data: new Map() };

const parseInstanceStates = text => {
  const result = new Map();
  if (typeof text !== 'string' || text.length === 0) {
    return result;
  }
  const blocks = text.split(/\n(?=\s*VRRP Instance =)/u);
  for (const block of blocks) {
    const nameMatch = block.match(/VRRP Instance = (?<name>\S+)/u);
    const stateMatch = block.match(/State = (?<state>\S+)/u);
    if (nameMatch?.groups?.name && stateMatch?.groups?.state) {
      result.set(nameMatch.groups.name, stateMatch.groups.state);
    }
  }
  return result;
};

const sendSigUsr2 = async (strategy, pidPath) => {
  if (strategy === 's6') {
    await runCommand('s6-svc', ['-2', S6_SERVICE_DIR], TIMEOUT_MS);
    return;
  }
  if (strategy === 'systemd') {
    await runCommand('systemctl', ['kill', '-s', 'USR2', 'keepalived'], TIMEOUT_MS);
    return;
  }
  const pid = await readPid(pidPath);
  process.kill(pid, 'SIGUSR2');
};

export const getInstanceStates = async (config = {}) => {
  const now = Date.now();
  if (now - stateCache.ts < STATE_CACHE_TTL_MS && stateCache.data.size > 0) {
    return stateCache.data;
  }
  let strategy;
  try {
    strategy = await pickStrategy();
    await sendSigUsr2(strategy, config.pidPath);
  } catch {
    stateCache = { ts: now, data: new Map() };
    return stateCache.data;
  }
  await new Promise(resolve => {
    setTimeout(resolve, SIGUSR2_SETTLE_MS);
  });
  let text = '';
  try {
    text = await fs.readFile(KEEPALIVED_DATA_PATH, 'utf8');
  } catch {
    stateCache = { ts: now, data: new Map() };
    return stateCache.data;
  }
  let parsed = parseInstanceStates(text);
  if (parsed.size === 0) {
    await new Promise(resolve => {
      setTimeout(resolve, SIGUSR2_SETTLE_MS);
    });
    try {
      text = await fs.readFile(KEEPALIVED_DATA_PATH, 'utf8');
      parsed = parseInstanceStates(text);
    } catch {
      // keep empty
    }
  }
  stateCache = { ts: now, data: parsed };
  return parsed;
};

// Liveness via pidfile + process check. Returns null if we can't tell
// (no pidfile, no permission to signal); true if the pid is alive; false
// if the pidfile exists but the process isn't there.
export const isAlive = async (config = {}) => {
  try {
    const pid = await readPid(config.pidPath);
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === 'EPERM') {
        return true; // process exists but we lack permission to signal
      }
      return false;
    }
  } catch {
    return null;
  }
};

// `keepalived -t -f <path>` syntax-checks a config file without applying.
// Returns { ok, output }; throws on spawn failure.
export const validateConfigFile = async (keepalivedBin, configPath) => {
  const bin = keepalivedBin || '/usr/sbin/keepalived';
  const result = await runCommand(bin, ['-t', '-f', configPath], TIMEOUT_MS);
  return { ok: result.code === 0, output: `${result.stdout}${result.stderr}`.trim() };
};

export const getStrategy = () => pickStrategy();
