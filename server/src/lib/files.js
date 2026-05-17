import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, resolve as resolvePath, sep } from 'node:path';

// safePathUnder is the single, well-known path-containment check for any
// user-derived filename under a known root. Mirrors the "GOOD" pattern from
// CodeQL's js/path-injection query help (path.resolve + .startsWith(ROOT))
// so the dataflow query recognises this as a barrier and stops flagging
// downstream fs.* sinks.
//
// See https://codeql.github.com/codeql-query-help/javascript/js-path-injection/
export const safePathUnder = (rootDir, name) => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('name must be a non-empty string');
  }
  const root = resolvePath(rootDir);
  const candidate = resolvePath(root, name);
  if (!candidate.startsWith(root)) {
    throw new Error(`name resolves outside root: ${name}`);
  }
  // Sibling-prefix guard: reject root=/foo, candidate=/foobar/baz. The check
  // above accepts that pair because '/foobar'.startsWith('/foo') is true.
  if (candidate.length > root.length && candidate[root.length] !== sep) {
    throw new Error(`name resolves outside root: ${name}`);
  }
  return candidate;
};

export const ensureDir = async (dirPath, mode = 0o755) => {
  await fs.mkdir(dirPath, { recursive: true, mode });
};

export const writeAtomic = async (filePath, content, { mode = 0o644 } = {}) => {
  await ensureDir(dirname(filePath));
  const tmpPath = `${filePath}.tmp.${randomBytes(6).toString('hex')}`;
  try {
    await fs.writeFile(tmpPath, content, { mode });
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
};

export const readJson = async filePath => {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

export const writeJson = async (filePath, value, opts = {}) => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeAtomic(filePath, content, opts);
};

export const fileExists = async filePath => {
  try {
    await fs.access(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
};

export const readText = filePath => fs.readFile(filePath, 'utf8');

export const removeIfExists = async filePath => {
  await fs.rm(filePath, { force: true });
};
