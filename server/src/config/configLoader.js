import fs from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import configMigrator from './configMigrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * configLoader — singleton that reads PatchPanel's bootstrap configuration.
 *
 * Mirrors cipher's pattern (verified firsthand at
 * G:/Projects/cipher/backend/src/config/configLoader.js; identical to
 * Armor's loader at G:/Projects/Armor/config/configLoader.js).
 *
 * PatchPanel difference: YAML is metadata-wrapped (every leaf is an
 * object with `{type, value, description, ...}`) so we maintain two
 * views of the loaded config:
 *
 *   - `getConfig()`     — flat view, with each leaf's `.value` hoisted
 *                         in place. This is what application code uses
 *                         (e.g. `config.server.port` returns the number,
 *                         not the metadata wrapper).
 *
 *   - `getRawConfig()`  — the original metadata-wrapped tree. Used by
 *                         the Settings UI / settings-update API to
 *                         present field metadata and preserve it on
 *                         write.
 *
 * Lookup order for the config file:
 *   1. explicit overridePath (CLI arg)
 *   2. process.env.CONFIG_PATH (set by systemd unit + Docker)
 *   3. <repo>/dev.config.yaml (developer override)
 *   4. /etc/patchpanel/config.yaml (production default)
 */

const DEFAULT_USER_CONFIG_PATH = '/etc/patchpanel/config.yaml';
const DEV_CONFIG_PATH = join(__dirname, '../../../dev.config.yaml');

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Return true iff `node` is a metadata-wrapped leaf, i.e. has both a
 * `type` field (string) and a `value` field.
 */
const isMetadataLeaf = node =>
  isPlainObject(node) && typeof node.type === 'string' && Object.hasOwn(node, 'value');

/**
 * Recursively strip metadata from a metadata-wrapped tree, returning a
 * plain values-only tree. Skips the `_sections` UI map.
 */
const flatten = node => {
  if (!isPlainObject(node)) {
    return node;
  }
  if (isMetadataLeaf(node)) {
    return node.value;
  }

  const out = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === '_sections') {
      continue;
    }
    out[key] = flatten(child);
  }
  return out;
};

class ConfigLoader {
  constructor() {
    this.raw = null;
    this.config = null;
    this.loadedFrom = null;
  }

  /**
   * Resolve which file to read, in priority order.
   */
  _resolveConfigPath(overridePath) {
    const candidates = [];
    if (overridePath) {
      candidates.push(overridePath);
    }
    if (process.env.CONFIG_PATH) {
      candidates.push(process.env.CONFIG_PATH);
    }
    candidates.push(DEV_CONFIG_PATH);
    candidates.push(DEFAULT_USER_CONFIG_PATH);
    return candidates;
  }

  /**
   * Run the migrator (if applicable), read and parse the config,
   * flatten metadata, and cache both views. Returns the flat view.
   *
   * Safe to call multiple times; subsequent calls return the cached
   * flat config without re-reading.
   */
  load(overridePath) {
    if (this.config) {
      return this.config;
    }

    // Run migrator first (handles fresh install + version upgrades).
    // We don't abort startup if migration fails — the prior config
    // (or the absence of one) will surface as a load error below.
    const migration = configMigrator.migrate();
    if (!migration.success) {
      console.warn('[configLoader] migrator reported failure:', migration.error);
    }

    const candidates = this._resolveConfigPath(overridePath);
    let content = null;
    let loadedFrom = null;

    for (const candidate of candidates) {
      try {
        content = fs.readFileSync(candidate, 'utf8');
        loadedFrom = candidate;
        break;
      } catch {
        // Try the next candidate.
      }
    }

    if (!content) {
      throw new Error(
        `No PatchPanel configuration file found. Looked at: ${candidates.join(', ')}`
      );
    }

    let parsed;
    try {
      parsed = yaml.load(content);
    } catch (err) {
      throw new Error(`Failed to parse YAML at ${loadedFrom}: ${err.message}`);
    }

    if (!isPlainObject(parsed)) {
      throw new Error(`Configuration at ${loadedFrom} is not a YAML mapping`);
    }

    this.raw = parsed;
    this.config = flatten(parsed);
    this.loadedFrom = loadedFrom;

    console.log(`[configLoader] loaded ${basename(loadedFrom)} (${loadedFrom})`);
    return this.config;
  }

  /**
   * Return the flat (values-only) view. Throws if load() hasn't run.
   */
  getConfig() {
    if (!this.config) {
      throw new Error('configLoader.load() must be called before getConfig()');
    }
    return this.config;
  }

  /**
   * Return the metadata-wrapped tree as parsed from disk. Includes the
   * `_sections` UI map at the top. Used by the settings API.
   */
  getRawConfig() {
    if (!this.raw) {
      throw new Error('configLoader.load() must be called before getRawConfig()');
    }
    return this.raw;
  }

  /**
   * Path the config was actually loaded from (useful for logging).
   */
  getLoadedFrom() {
    return this.loadedFrom;
  }

  /**
   * Reset cached state. Used by tests + the settings-update API after
   * writing a new config to disk.
   */
  reset() {
    this.raw = null;
    this.config = null;
    this.loadedFrom = null;
  }
}

const configLoader = new ConfigLoader();

export default configLoader;
