import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, normalize as normalizePath } from 'node:path';

// Defense-in-depth path sanitizer. Callers (cert/CRL/credential routes)
// already validate ids against `^[a-z][a-z0-9_-]{0,62}$` and resolve+prefix
// check before calling these helpers, so under normal operation no `..`
// segment can reach here. This barrier runs unconditionally so a future
// caller that forgets to sanitize can't silently traverse, and so static
// analysis (CodeQL js/path-injection) sees an obvious sanitizer at the fs
// call site.
const assertSafePath = filePath => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('path must be a non-empty string');
  }
  const normalized = normalizePath(filePath);
  const segments = normalized.split(/[\\/]/u);
  if (segments.includes('..')) {
    throw new Error(`unsafe path (contains traversal segment): ${filePath}`);
  }
  return normalized;
};

export const ensureDir = async (dirPath, mode = 0o755) => {
  const safe = assertSafePath(dirPath);
  await fs.mkdir(safe, { recursive: true, mode });
};

export const writeAtomic = async (filePath, content, { mode = 0o644 } = {}) => {
  const safe = assertSafePath(filePath);
  await ensureDir(dirname(safe));
  const tmpPath = `${safe}.tmp.${randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(tmpPath, content, { mode });
    await fs.rename(tmpPath, safe);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
};

export const readJson = async filePath => {
  const safe = assertSafePath(filePath);
  const raw = await fs.readFile(safe, 'utf8');
  return JSON.parse(raw);
};

export const writeJson = async (filePath, value, opts = {}) => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeAtomic(filePath, content, opts);
};

export const fileExists = async filePath => {
  const safe = assertSafePath(filePath);
  try {
    await fs.access(safe);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

export const readText = filePath => fs.readFile(assertSafePath(filePath), 'utf8');

export const removeIfExists = async filePath => {
  const safe = assertSafePath(filePath);
  await fs.rm(safe, { force: true });
};
