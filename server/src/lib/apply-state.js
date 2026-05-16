import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';

import * as audit from './audit.js';
import { buildCertsList } from './cert-lineage.js';
import { ReloadError } from './errors.js';
import { parseValidationOutput } from './haproxy-error-parser.js';
import { ensureDir, writeAtomic } from './files.js';
import { assertValidRenderedCfg } from './haproxy-validate.js';
import * as haproxyMaster from './haproxy-master.js';
import { withLock } from './lock.js';
import * as logger from './logger.js';
import { renderHaproxyConfig } from './render.js';
import { writeSnapshot } from './snapshots.js';
import { saveState } from './state.js';
import { StateSchema } from './state-schema.js';

const reloadLockPath = config => `${config.paths.haproxyConfig}.reload.lock`;

const backupCfg = async cfgPath => {
  const backupPath = `${cfgPath}.bak`;
  try {
    await fs.copyFile(cfgPath, backupPath);
    return backupPath;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};

const restoreCfgFromBackup = async (cfgPath, backupPath) => {
  if (!backupPath) {
    return;
  }
  try {
    await fs.copyFile(backupPath, cfgPath);
    logger.info('restored haproxy.cfg from backup after reload failure');
  } catch (err) {
    logger.error('failed to restore haproxy.cfg backup after reload failure', {
      error: err.message,
    });
  }
};

const cleanupBackup = async backupPath => {
  if (!backupPath) {
    return;
  }
  await fs.rm(backupPath, { force: true }).catch(() => undefined);
};

const persistCustomErrorPages = async (config, candidateParsed) => {
  const blocks = candidateParsed.defaultsBlocks ?? [];
  if (blocks.length === 0) {
    return candidateParsed;
  }
  const dir = config.paths.haproxyErrorPagesDir;
  const blocksNeedingWrites = blocks.filter(
    block => Object.keys(block.errorPageContents ?? {}).length > 0
  );
  if (blocksNeedingWrites.length === 0) {
    return candidateParsed;
  }
  if (!dir) {
    logger.warning(
      'errorPageContents set but config.paths.haproxyErrorPagesDir is missing; skipping'
    );
    return candidateParsed;
  }
  await ensureDir(dir);
  const nextBlocks = await Promise.all(
    blocks.map(async block => {
      const contents = block.errorPageContents ?? {};
      const codes = Object.keys(contents).filter(
        code => typeof contents[code] === 'string' && contents[code].length > 0
      );
      if (codes.length === 0) {
        return block;
      }
      const blockDir = joinPath(dir, block.id);
      await ensureDir(blockDir);
      const overriddenErrorFiles = { ...block.errorFiles };
      await Promise.all(
        codes.map(async code => {
          const target = joinPath(blockDir, `${code}.http`);
          await writeAtomic(target, contents[code], { mode: 0o644 });
          overriddenErrorFiles[code] = target;
        })
      );
      return { ...block, errorFiles: overriddenErrorFiles };
    })
  );
  return { ...candidateParsed, defaultsBlocks: nextBlocks };
};

const persistMaps = async (config, candidateParsed) => {
  const maps = candidateParsed.maps ?? [];
  if (maps.length === 0) {
    return;
  }
  const dir = config.paths.haproxyMapsDir ?? '/etc/haproxy/maps';
  await ensureDir(dir);
  await Promise.all(
    maps.map(async map => {
      const body = map.entries.map(e => `${e.key} ${e.value}`).join('\n');
      const target = joinPath(dir, `${map.name}.map`);
      await writeAtomic(target, body ? `${body}\n` : '', { mode: 0o644 });
    })
  );
  logger.info('wrote map files', { count: maps.length, dir });
};

export const applyState = (config, candidate, options = {}) =>
  withLock(reloadLockPath(config), async () => {
    const editor = options.editor ?? null;
    const candidateBase = StateSchema.parse(candidate);
    const candidateParsed = await persistCustomErrorPages(config, candidateBase);
    await persistMaps(config, candidateParsed);

    const emitted = await buildCertsList(
      config.paths,
      candidateParsed.tls.certs,
      candidateParsed.tls.providers
    );
    const loadableCertCount = emitted.length;

    const rendered = renderHaproxyConfig(candidateParsed, {
      certsListPath: config.paths.haproxyCertsList,
      trustedCasDir: config.paths.trustedCasDir,
      trustedCrlsDir: config.paths.trustedCrlsDir,
      loadableCertCount,
    });

    try {
      await assertValidRenderedCfg(config.paths.haproxyBin, rendered);
    } catch (err) {
      if (err.name === 'HaproxyError') {
        err.hints = parseValidationOutput(err.output, candidateParsed);
      }
      throw err;
    }

    const backupPath = await backupCfg(config.paths.haproxyConfig);

    await writeAtomic(config.paths.haproxyConfig, rendered, { mode: 0o644 });
    logger.info('haproxy.cfg written', {
      path: config.paths.haproxyConfig,
      loadableCertCount,
    });

    try {
      await haproxyMaster.reload(config.paths.haproxyMasterSocket);
    } catch (err) {
      await restoreCfgFromBackup(config.paths.haproxyConfig, backupPath);
      await haproxyMaster.reload(config.paths.haproxyMasterSocket).catch(rollbackErr => {
        logger.error('reload after rollback also failed; HAProxy may be in inconsistent state', {
          error: rollbackErr.message,
        });
      });
      await cleanupBackup(backupPath);
      audit.record({
        actor: editor,
        category: 'state',
        action: 'apply',
        outcome: 'error',
        details: { loadableCertCount, error: err.message },
      });
      throw new ReloadError(`reload failed after applying state: ${err.message}`, { cause: err });
    }

    await cleanupBackup(backupPath);

    // Persist the original candidate (with errorPageContents intact, original
    // errorFiles map) — the overridden errorFiles map is a render-time detail.
    const next = await saveState(config.paths.state, candidateBase, options);
    logger.info('state saved after successful reload', { path: config.paths.state });

    if (config.paths.snapshotsDir) {
      writeSnapshot(config.paths.snapshotsDir, next, {
        actor: editor,
        reason: options.reason ?? null,
      }).catch(err => logger.warning('snapshot write failed (non-fatal)', { error: err.message }));
    }

    audit.record({
      actor: editor,
      category: 'state',
      action: 'apply',
      outcome: 'ok',
      details: { loadableCertCount, reason: options.reason ?? null },
    });

    return next;
  });
