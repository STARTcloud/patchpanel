import { promises as fs } from 'node:fs';

import { ValidationError } from './errors.js';
import { ensureDir, fileExists, removeIfExists, safePathUnder, writeAtomic } from './files.js';

// User-uploaded Lua plugin source files. The set of dirs that may receive
// uploads is operator-configured via `paths.luaPluginsDirs` (array). The
// state document's `globalSettings.luaPlugins[].path` references files by
// absolute path — uploaded plugins land under one of the whitelisted dirs
// and the path field in state is auto-filled to the resulting location.

const LUA_PLUGIN_ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const MAX_LUA_SOURCE_BYTES = 524_288; // 512 KB

// Validators return a {code, replacements} object on failure (or null on
// success). Routes turn the object into a localized errorResponse() body.
export const validateLuaPluginId = id => {
  if (typeof id !== 'string' || !LUA_PLUGIN_ID_REGEX.test(id)) {
    return { code: 'lua.plugin.idInvalid' };
  }
  return null;
};

export const validateLuaPluginSource = source => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return { code: 'lua.plugin.sourceRequired' };
  }
  if (source.length > MAX_LUA_SOURCE_BYTES) {
    return {
      code: 'lua.plugin.sourceTooLarge',
      replacements: { maxBytes: MAX_LUA_SOURCE_BYTES },
    };
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
    throw new ValidationError('lua.plugin.dirNotWhitelisted');
  }
  const idError = validateLuaPluginId(id);
  if (idError) {
    throw new ValidationError(idError.code, { replacements: idError.replacements });
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
