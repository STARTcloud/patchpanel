import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

import * as logger from './logger.js';

// Process-control strategies. The patchpanel addon runs under s6-overlay in
// the Home Assistant container, but the same code may run baremetal under
// systemd, or as a plain process supervised by something else. We pick the
// strategy at startup based on what's present on disk, with manual override
// via the HAPROXY_CONTROL_STRATEGY env var.
//
//   s6      → s6-svc -d /run/service/haproxy (default in the addon)
//   systemd → systemctl stop|start|is-active haproxy
//   direct  → SIGTERM the pid from haproxy.pid, no auto-restart
//
// detectStrategy is async because it stats the filesystem. Callers should
// cache the result; we expose pickStrategy() with a one-shot resolution.

const S6_SERVICE_DIR = '/run/service/haproxy';
const SYSTEMD_RUN_DIR = '/run/systemd/system';
const DEFAULT_PID_PATH = '/run/haproxy.pid';
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
  const envOverride = process.env.HAPROXY_CONTROL_STRATEGY;
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
  logger.info('haproxy control strategy resolved', { strategy: cachedStrategy });
  return cachedStrategy;
};

const stopViaS6 = () => runCommand('s6-svc', ['-Dwd', S6_SERVICE_DIR], TIMEOUT_MS);
const startViaS6 = () => runCommand('s6-svc', ['-Uwu', S6_SERVICE_DIR], TIMEOUT_MS);

const stopViaSystemd = () => runCommand('systemctl', ['stop', 'haproxy'], TIMEOUT_MS);
const startViaSystemd = () => runCommand('systemctl', ['start', 'haproxy'], TIMEOUT_MS);

const stopViaDirect = async pidPath => {
  const raw = await fs.readFile(pidPath ?? DEFAULT_PID_PATH, 'utf8').catch(() => '');
  const pid = Number.parseInt(raw.trim().split(/\s+/u)[0], 10);
  if (!Number.isInteger(pid) || pid <= 1) {
    throw new Error(`could not read HAProxy pid from ${pidPath ?? DEFAULT_PID_PATH}`);
  }
  process.kill(pid, 'SIGTERM');
  return { code: 0, stdout: `SIGTERM sent to pid ${pid}`, stderr: '' };
};

const startViaDirect = () => {
  throw new Error(
    'direct strategy cannot restart HAProxy from scratch — no supervisor configured. ' +
      'Set HAPROXY_CONTROL_STRATEGY to s6 or systemd, or start HAProxy manually.'
  );
};

const requireOk = (result, action) => {
  if (result.code !== 0) {
    throw new Error(
      `${action} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim()}`
    );
  }
  return result;
};

export const stop = async (config = {}) => {
  const strategy = await pickStrategy();
  logger.info('haproxy stop requested', { strategy });
  if (strategy === 's6') {
    return requireOk(await stopViaS6(), 's6-svc stop');
  }
  if (strategy === 'systemd') {
    return requireOk(await stopViaSystemd(), 'systemctl stop haproxy');
  }
  return stopViaDirect(config.pidPath);
};

export const start = async () => {
  const strategy = await pickStrategy();
  logger.info('haproxy start requested', { strategy });
  if (strategy === 's6') {
    return requireOk(await startViaS6(), 's6-svc start');
  }
  if (strategy === 'systemd') {
    return requireOk(await startViaSystemd(), 'systemctl start haproxy');
  }
  return startViaDirect();
};

// Liveness is NOT exposed from this module. The /api/stats endpoint is the
// canonical "is HAProxy alive" signal (it returns 502 when the stats socket
// is unreachable, which is exactly the condition we'd care about). The UI
// derives `alive` from that. This module only resolves the supervisor
// strategy so the UI knows whether the Start button is operable.
export const getStrategy = () => pickStrategy();
