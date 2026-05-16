import { promises as fs } from 'node:fs';

const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

const sleep = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const tryOpenExclusive = async (lockPath, deadline) => {
  const handle = await fs.open(lockPath, 'wx').catch(err => {
    if (err.code === 'EEXIST') {
      return null;
    }
    throw err;
  });
  if (handle !== null) {
    return handle;
  }
  if (Date.now() > deadline) {
    throw new Error(`could not acquire lock at ${lockPath} within timeout`);
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
