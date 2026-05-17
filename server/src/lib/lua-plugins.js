import { promises as fs } from 'node:fs';

import { ensureDir, fileExists, removeIfExists, safePathUnder, writeAtomic } from './files.js';

// User-uploaded Lua plugin source files. The set of dirs that may receive
// uploads is operator-configured via `paths.luaPluginsDirs` (array). The
// state document's `globalSettings.luaPlugins[].path` references files by
// absolute path — uploaded plugins land under one of the whitelisted dirs
// and the path field in state is auto-filled to the resulting location.

const LUA_PLUGIN_ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const MAX_LUA_SOURCE_BYTES = 524_288; // 512 KB

export const validateLuaPluginId = id => {
  if (typeof id !== 'string' || !LUA_PLUGIN_ID_REGEX.test(id)) {
    return 'name must match a-z, 0-9, _, - (1-63 chars, letter-start)';
  }
  return null;
};

export const validateLuaPluginSource = source => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return 'source is required';
  }
  if (source.length > MAX_LUA_SOURCE_BYTES) {
    return `source exceeds ${MAX_LUA_SOURCE_BYTES} bytes`;
  }
  return null;
};

// Reject any dir that's not exactly one of the configured whitelist entries.
// Comparison is on the raw string (no normalisation) so admins know exactly
// what they're permitting in config.yaml.
export const isAllowedLuaPluginDir = (allowedDirs, candidate) =>
  Array.isArray(allowedDirs) && typeof candidate === 'string' && allowedDirs.includes(candidate);

const sanitizeLuaPluginPath = (allowedDirs, dir, id) => {
  if (!isAllowedLuaPluginDir(allowedDirs, dir)) {
    throw new Error('dir is not in the configured luaPluginsDirs whitelist');
  }
  const idError = validateLuaPluginId(id);
  if (idError) {
    throw new Error(idError);
  }
  return safePathUnder(dir, `${id}.lua`);
};

export const luaPluginPath = (allowedDirs, dir, id) => sanitizeLuaPluginPath(allowedDirs, dir, id);

export const writeLuaPlugin = async (allowedDirs, dir, id, source) => {
  const filePath = sanitizeLuaPluginPath(allowedDirs, dir, id);
  await ensureDir(dir, 0o755);
  const body = source.endsWith('\n') ? source : `${source}\n`;
  await writeAtomic(filePath, body, { mode: 0o644 });
  return filePath;
};

export const readLuaPlugin = (allowedDirs, dir, id) => {
  const filePath = sanitizeLuaPluginPath(allowedDirs, dir, id);
  return fs.readFile(filePath, 'utf8');
};

export const removeLuaPlugin = async (allowedDirs, dir, id) => {
  const filePath = sanitizeLuaPluginPath(allowedDirs, dir, id);
  await removeIfExists(filePath);
};

export const listLuaPluginFiles = async dir => {
  if (!(await fileExists(dir))) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.lua'))
    .map(e => e.name.replace(/\.lua$/u, ''));
};

export const luaPluginFileExists = async (allowedDirs, dir, id) => {
  try {
    const filePath = sanitizeLuaPluginPath(allowedDirs, dir, id);
    return await fileExists(filePath);
  } catch {
    return false;
  }
};
