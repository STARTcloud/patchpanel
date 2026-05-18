import { promises as fs } from 'node:fs';

import yaml from 'js-yaml';

import { ValidationError } from './errors.js';
import { fileExists, readText, writeAtomic } from './files.js';

// Apply a flat {dottedPath: value} patch to a metadata-wrapped config tree
// and persist the result to disk. Each path must resolve to a metadata leaf
// (an object with both `type` and `value` keys); each value is validated
// against the leaf's schema metadata (`type`, `options`, `validation.min/max`)
// before mutation. Throws ValidationError on any failure so the route handler
// can map it to a clean 400 response.

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const isMetadataLeaf = node =>
  isPlainObject(node) && typeof node.type === 'string' && Object.hasOwn(node, 'value');

const findMetadataLeaf = (raw, dottedPath) => {
  let node = raw;
  for (const part of dottedPath.split('.')) {
    if (!isPlainObject(node)) {
      return null;
    }
    node = node[part];
  }
  return isMetadataLeaf(node) ? node : null;
};

const checkRange = (n, lo, hi) => {
  if (lo !== null && lo !== undefined && n < lo) {
    return `must be >= ${lo}`;
  }
  if (hi !== null && hi !== undefined && n > hi) {
    return `must be <= ${hi}`;
  }
  return null;
};

const validateBoolean = value => (typeof value === 'boolean' ? null : 'must be boolean');

const validateInteger = (value, leaf) => {
  if (!Number.isInteger(value)) {
    return 'must be integer';
  }
  return checkRange(value, leaf.validation?.min ?? leaf.min, leaf.validation?.max ?? leaf.max);
};

const validateSelect = (value, leaf) => {
  if (!Array.isArray(leaf.options)) {
    return null;
  }
  return leaf.options.includes(value) ? null : `must be one of: ${leaf.options.join(', ')}`;
};

const validateArray = value => {
  if (!Array.isArray(value)) {
    return 'must be array';
  }
  return value.every(item => typeof item === 'string') ? null : 'array items must be strings';
};

const validateString = (value, leaf) => {
  if (typeof value !== 'string') {
    return 'must be string';
  }
  return checkRange(
    value.length,
    leaf.validation?.min ?? leaf.min,
    leaf.validation?.max ?? leaf.max
  );
};

const VALIDATORS = Object.freeze({
  boolean: validateBoolean,
  integer: validateInteger,
  select: validateSelect,
  array: validateArray,
  string: validateString,
  host: validateString,
  url: validateString,
  password: validateString,
  textarea: validateString,
});

const validateValue = (leaf, value) => {
  if (value === null || value === undefined) {
    return leaf.required ? 'required' : null;
  }
  const validator = VALIDATORS[leaf.type];
  return validator ? validator(value, leaf) : null;
};

export const applyConfigPatch = (raw, patch) => {
  if (!isPlainObject(patch)) {
    throw new ValidationError('patch must be an object');
  }
  // Deep-clone the raw tree before mutating so a validation failure halfway
  // through doesn't leave the loader's cached tree partially modified.
  const updated = JSON.parse(JSON.stringify(raw));
  for (const [path, value] of Object.entries(patch)) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new ValidationError(`invalid path: ${String(path)}`);
    }
    const leaf = findMetadataLeaf(updated, path);
    if (!leaf) {
      throw new ValidationError(`unknown config path: ${path}`);
    }
    const err = validateValue(leaf, value);
    if (err) {
      throw new ValidationError(`${path}: ${err}`);
    }
    leaf.value = value;
  }
  return updated;
};

export const dumpConfigYaml = raw => yaml.dump(raw, { defaultFlowStyle: false, lineWidth: -1 });

// Marker on the first line of every config we write so we can tell at a
// glance whether the file on disk came from us. Mirrors the watermarking
// pattern in apply-state.js (the haproxy.cfg / keepalived.conf renderer).
export const CONFIG_WATERMARK_PREFIX = '# patchpanel-managed';

// One-shot preservation of an operator's hand-written or migrator-emitted
// config the first time the UI takes over the file. If the existing file
// doesn't carry our watermark, copy it to a timestamped `.preserved-<iso>`
// sidecar so any comments / hand formatting survive. Returns the preserved
// path, or null when no preservation was needed.
const preserveForeignConfig = async configPath => {
  if (!(await fileExists(configPath))) {
    return null;
  }
  const existing = await readText(configPath);
  const newlineIdx = existing.indexOf('\n');
  const firstLine = newlineIdx === -1 ? existing : existing.slice(0, newlineIdx);
  if (firstLine.startsWith(CONFIG_WATERMARK_PREFIX)) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const preservedPath = `${configPath}.preserved-${stamp}`;
  await fs.copyFile(configPath, preservedPath);
  return preservedPath;
};

const buildWatermark = preservedPath => {
  const lines = [
    `${CONFIG_WATERMARK_PREFIX} config — regenerated on every save via /api/config`,
    '# (Settings page in the UI). Hand-editing is still allowed, but comments',
    '# and custom formatting will NOT survive the next UI-driven save — js-yaml',
    '# does not round-trip comments.',
  ];
  if (preservedPath) {
    lines.push(
      '#',
      '# Original contents (with any comments) preserved verbatim at:',
      `#   ${preservedPath}`
    );
  }
  lines.push(`# Last written: ${new Date().toISOString()}`);
  return `${lines.join('\n')}\n`;
};

export const writeRawConfig = async (configPath, raw) => {
  const preservedPath = await preserveForeignConfig(configPath);
  const body = `${buildWatermark(preservedPath)}${dumpConfigYaml(raw)}`;
  await writeAtomic(configPath, body, { mode: 0o644 });
  return { preservedPath };
};
