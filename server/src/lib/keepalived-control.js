import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

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
    throw new Error(`could not read keepalived pid from ${pidPath ?? DEFAULT_PID_PATH}`);
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
    throw new Error(
      `${action} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`
    );
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
  throw new Error(
    'direct strategy cannot restart keepalived from scratch — no supervisor configured. ' +
      'Set KEEPALIVED_CONTROL_STRATEGY to s6 or systemd, or start keepalived manually.'
  );
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
