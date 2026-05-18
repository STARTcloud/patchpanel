import fs from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import yaml from 'js-yaml';
import jsonMerger from 'json-merger';

import { CONFIG_WATERMARK_PREFIX } from '../lib/config-write.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * configMigrator — template merger for PatchPanel's metadata-wrapped YAML
 * configuration. Mirrors cipher's pattern (verified firsthand against
 * G:/Projects/cipher/backend/src/config/configMigrator.js).
 *
 * On startup, the loader calls migrate(). It:
 *   - Detects fresh install vs version upgrade vs no-op (versions match).
 *   - Backs up the existing user config to <path>.backup.<ISO-timestamp>.
 *   - Runs json-merger.mergeFiles([template, userConfig]) so new template
 *     keys appear and user .value edits survive.
 *   - Substitutes the __JWT_SECRET_FROM_FILE__ placeholder with a freshly
 *     generated 32-byte hex secret, writing the secret to a sidecar at
 *     <configDir>/.jwt-secret.
 *   - Updates the top-level `version` marker to match package.json.version.
 *   - Auto-restores the latest backup on failure.
 *
 * NOT a data migrator — we don't transform user values across versions. The
 * template defines structure; users only ever set .value on leaves through
 * the Settings UI. New template fields simply appear; removed template
 * fields linger in the user config until manually cleaned.
 */

const TEMPLATE_PATHS = [
  '/opt/patchpanel/config-templates/production-config.yaml',
  join(__dirname, '../../../packaging/config/production-config.yaml'),
];

const DEFAULT_USER_CONFIG_PATH = '/etc/patchpanel/config.yaml';

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Prepend a watermark to migrator-written configs so the UI's writeRawConfig
// recognises the file as already-managed and skips its first-save preserve
// step (which would otherwise dump a redundant commentless `.preserved-<iso>`
// sidecar on the very first save after fresh install or version upgrade).
const buildMigratorWatermark = () =>
  [
    `${CONFIG_WATERMARK_PREFIX} config — written by configMigrator (auto-merge of new template fields on version upgrade)`,
    '# UI-driven saves via /api/config rewrite this file; comments do not survive the round-trip.',
    `# Last written: ${new Date().toISOString()}`,
    '',
    '',
  ].join('\n');

class ConfigMigrator {
  constructor() {
    this.userConfigPath = process.env.CONFIG_PATH || DEFAULT_USER_CONFIG_PATH;
    this.packagePath = join(__dirname, '../../../package.json');
    this.devConfigPath = join(__dirname, '../../../dev.config.yaml');
    this.isDevMode = fs.existsSync(this.devConfigPath);
    this.templatePath = this._resolveTemplatePath();
  }

  _resolveTemplatePath() {
    for (const candidate of TEMPLATE_PATHS) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return TEMPLATE_PATHS[TEMPLATE_PATHS.length - 1];
  }

  /**
   * @returns {{needed: boolean, reason: string, appVersion?: string, configVersion?: string, error?: string}}
   */
  isMigrationNeeded() {
    try {
      if (this.isDevMode) {
        return { needed: false, reason: 'dev_mode', appVersion: 'dev' };
      }

      const packageData = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
      const appVersion = packageData.version;

      if (!fs.existsSync(this.userConfigPath)) {
        return { needed: true, reason: 'fresh_install', appVersion };
      }

      const userConfig = yaml.load(fs.readFileSync(this.userConfigPath, 'utf8'));
      const configVersion = userConfig?.version;

      const needed = appVersion !== configVersion;
      return {
        needed,
        reason: needed ? 'version_mismatch' : 'up_to_date',
        appVersion,
        configVersion,
      };
    } catch (error) {
      console.warn('[configMigrator] migration check failed:', error.message);
      return { needed: false, reason: 'error', error: error.message };
    }
  }

  migrate() {
    const check = this.isMigrationNeeded();

    if (!check.needed) {
      console.log(`[configMigrator] ${check.reason}`);
      return { success: true, action: 'none', reason: check.reason };
    }

    console.log(`[configMigrator] migration needed: ${check.reason}`);
    console.log(`[configMigrator] app=${check.appVersion} config=${check.configVersion || 'none'}`);

    try {
      if (fs.existsSync(this.userConfigPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${this.userConfigPath}.backup.${timestamp}`;
        fs.copyFileSync(this.userConfigPath, backupPath);
        console.log(`[configMigrator] backed up to ${backupPath}`);
      }

      if (check.reason === 'fresh_install') {
        return this._processFreshInstall();
      }

      const result = this._mergeConfigs();
      console.log('[configMigrator] merge completed');
      return { success: true, action: 'migrated', ...result };
    } catch (error) {
      console.error('[configMigrator] migration failed:', error.message);
      this._restoreLatestBackup();
      return { success: false, action: 'failed', error: error.message };
    }
  }

  _processFreshInstall() {
    this._ensureConfigDirectory();

    const templateYaml = yaml.load(fs.readFileSync(this.templatePath, 'utf8'));
    const processed = jsonMerger.mergeObject(templateYaml);

    this._handleJWTSecret(processed);
    this._setConfigVersion(processed);

    fs.writeFileSync(
      this.userConfigPath,
      buildMigratorWatermark() + yaml.dump(processed, { defaultFlowStyle: false, lineWidth: -1 })
    );

    console.log(`[configMigrator] fresh install: wrote ${this.userConfigPath}`);
    return { success: true, action: 'fresh_install' };
  }

  _mergeConfigs() {
    const merged = jsonMerger.mergeFiles([this.templatePath, this.userConfigPath]);

    this._handleJWTSecret(merged);
    this._setConfigVersion(merged);

    this._ensureConfigDirectory();
    fs.writeFileSync(
      this.userConfigPath,
      buildMigratorWatermark() + yaml.dump(merged, { defaultFlowStyle: false, lineWidth: -1 })
    );

    console.log(`[configMigrator] wrote merged config to ${this.userConfigPath}`);
    return { merged: true };
  }

  /**
   * Detect the JWT secret placeholder anywhere in the metadata-wrapped tree
   * and replace its `.value` with a freshly generated 32-byte hex secret.
   * Also write the secret to a sidecar file at <configDir>/.jwt-secret so
   * external scripts (e.g. systemd reload helpers) can read it without
   * parsing YAML.
   */
  _handleJWTSecret(config) {
    const leaf = config?.security?.jwtSecret;
    if (!isPlainObject(leaf)) {
      return;
    }

    const currentValue = leaf.value;
    const needsGeneration =
      !currentValue ||
      currentValue === '__JWT_SECRET_FROM_FILE__' ||
      String(currentValue).includes('change-this') ||
      String(currentValue).includes('example');

    if (!needsGeneration) {
      console.log('[configMigrator] using existing JWT secret');
      return;
    }

    const newSecret = randomBytes(32).toString('hex');
    leaf.value = newSecret;

    const sidecarPath = join(dirname(this.userConfigPath), '.jwt-secret');
    try {
      fs.writeFileSync(sidecarPath, newSecret, { mode: 0o600 });
      console.log(`[configMigrator] wrote JWT secret sidecar to ${sidecarPath}`);
    } catch (err) {
      console.warn('[configMigrator] failed to write JWT secret sidecar:', err.message);
    }
    console.log('[configMigrator] generated new JWT secret');
  }

  _setConfigVersion(config) {
    try {
      const packageData = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
      config.version = packageData.version;
    } catch (error) {
      console.warn('[configMigrator] failed to set config version:', error.message);
    }
  }

  _ensureConfigDirectory() {
    const configDir = dirname(this.userConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log(`[configMigrator] created ${configDir}`);
    }
  }

  _restoreLatestBackup() {
    try {
      const configDir = dirname(this.userConfigPath);
      const configBase = basename(this.userConfigPath);
      const backups = fs
        .readdirSync(configDir)
        .filter(f => f.startsWith(`${configBase}.backup.`))
        .sort()
        .reverse();

      if (backups.length === 0) {
        return;
      }

      const latest = join(configDir, backups[0]);
      fs.copyFileSync(latest, this.userConfigPath);
      console.log(`[configMigrator] restored backup ${latest}`);
    } catch (err) {
      console.error('[configMigrator] backup restore failed:', err.message);
    }
  }
}

export default new ConfigMigrator();
