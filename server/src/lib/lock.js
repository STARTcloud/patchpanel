import { promises as fs } from 'node:fs';

import { StateError } from './errors.js';
import { log } from './logger.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const isPidAlive = pid => {
  if (!Number.isInteger(pid) || pid <= 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') {
      return true;
    }
    return false;
  }
};

const isLockStale = async lockPath => {
  let raw;
  try {
    raw = await fs.readFile(lockPath, 'utf8');
  } catch {
    return false;
  }
  const pid = Number.parseInt(raw.trim().split(/\s+/u)[0], 10);
  if (!Number.isInteger(pid)) {
    return true;
  }
  return !isPidAlive(pid);
};

const breakStaleLock = async lockPath => {
  if (!(await isLockStale(lockPath))) {
    return false;
  }
  try {
    await fs.unlink(lockPath);
    log.app.warn('removed stale lock file', { path: lockPath });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return true;
    }
    return false;
  }
};

const tryOpenExclusive = async (lockPath, deadline) => {
  const handle = await fs.open(lockPath, 'wx').catch(err => {
    if (err.code === 'EEXIST') {
      return null;
    }
    throw err;
  });
  if (handle !== null) {
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  }
  if (await breakStaleLock(lockPath)) {
    return tryOpenExclusive(lockPath, deadline);
  }
  if (Date.now() > deadline) {
    throw new StateError('lock.acquireTimeout', {
      message: `could not acquire lock at ${lockPath} within timeout`,
      replacements: { path: lockPath },
    });
  }
  await sleep(POLL_INTERVAL_MS);
  return tryOpenExclusive(lockPath, deadline);
};

export const acquireLock = async (lockPath, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const deadline = Date.now() + timeoutMs;
  const handle = await tryOpenExclusive(lockPath, deadline);
  return {
    release: async () => {
      await handle.close();
      await fs.rm(lockPath, { force: true });
    },
  };
};

export const withLock = async (lockPath, fn, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const lock = await acquireLock(lockPath, timeoutMs);
  let value;
  try {
    value = await fn();
  } catch (err) {
    await lock.release();
    throw err;
  }
  await lock.release();
  return value;
};
