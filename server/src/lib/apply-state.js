import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';

import * as audit from './audit.js';
import { buildCertsList } from './cert-lineage.js';
import { mirrorCrtListToReferencedPaths } from './crt-list-mirror.js';
import { ReloadError, StateError } from './errors.js';
import { parseValidationOutput } from './haproxy-error-parser.js';
import { ensureDir, fileExists, readText, writeAtomic } from './files.js';
import { assertValidRenderedCfg } from './haproxy-validate.js';
import * as haproxyControl from './haproxy-control.js';
import * as keepalivedControl from './keepalived-control.js';
import { withLock } from './lock.js';
import { log } from './logger.js';
import { loadNodeConfig } from './node-config.js';
import { pushStateToAllPeers } from './peer-sync.js';
import { renderHaproxyConfig } from './render.js';
import { renderKeepalivedConfig } from './render-keepalived.js';
import { writeSnapshot } from './snapshots.js';
import { saveState } from './state.js';
import { StateSchema } from './state-schema.js';

const reloadLockPath = config => `${config.paths.haproxyConfig}.reload.lock`;

// Watermark stamped onto every config file patchpanel renders. The first line
// of a managed haproxy.cfg / keepalived.conf starts with WATERMARK_PREFIX so
// we can tell at a glance whether the on-disk file is ours or hand-written.
// Both formats treat `#` as a line comment, so the marker is inert.
const WATERMARK_PREFIX = '# patchpanel-managed';
const WATERMARK_LINE = `${WATERMARK_PREFIX} - do not edit by hand (regenerated on every state apply)`;

const isManagedConfig = content => {
  if (typeof content !== 'string' || content.length === 0) {
    return false;
  }
  const firstNewline = content.indexOf('\n');
  const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
  return firstLine.startsWith(WATERMARK_PREFIX);
};

const withWatermark = rendered => `${WATERMARK_LINE}\n${rendered}`;

// One-shot preservation of an operator's hand-written config the first time
// patchpanel takes over a file. If the existing file on disk doesn't carry
// our watermark, copy it to a permanent timestamped `.preserved-<iso>` sidecar
// so the operator can salvage their original directives / comments later.
// Returns the preserved path (or null when no preservation was needed).
const preserveForeignConfig = async cfgPath => {
  if (!(await fileExists(cfgPath))) {
    return null;
  }
  const existing = await readText(cfgPath);
  if (isManagedConfig(existing)) {
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preservedPath = `${cfgPath}.preserved-${stamp}`;
  await fs.copyFile(cfgPath, preservedPath);
  log.app.info('preserved foreign config before first patchpanel write', {
    from: cfgPath,
    to: preservedPath,
  });
  return preservedPath;
};

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
    log.app.info('restored haproxy.cfg from backup after reload failure');
  } catch (err) {
    log.app.error('failed to restore haproxy.cfg backup after reload failure', {
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

const hasAnyContent = block =>
  Object.keys(block.errorPageContents ?? {}).length > 0 ||
  Object.keys(block.lfFileContents ?? {}).length > 0;

const persistRawErrorFiles = async (blockDir, contents) => {
  const codes = Object.keys(contents).filter(
    code => typeof contents[code] === 'string' && contents[code].length > 0
  );
  const written = {};
  await Promise.all(
    codes.map(async code => {
      const target = joinPath(blockDir, `${code}.http`);
      await writeAtomic(target, contents[code], { mode: 0o644 });
      written[code] = target;
    })
  );
  return written;
};

const persistLfFileContents = async (blockDir, contents) => {
  const codes = Object.keys(contents).filter(
    code => typeof contents[code] === 'string' && contents[code].length > 0
  );
  if (codes.length === 0) {
    return {};
  }
  const lfDir = joinPath(blockDir, 'lf');
  await ensureDir(lfDir);
  const written = {};
  await Promise.all(
    codes.map(async code => {
      const target = joinPath(lfDir, `${code}.html`);
      await writeAtomic(target, contents[code], { mode: 0o644 });
      written[code] = target;
    })
  );
  return written;
};

// Inject auto-managed `http-error … lf-file <path>` directives for every
// code in lfFileContents that has a written file. Existing manual entries
// in httpErrors[] are preserved unless they target the same status — in
// that case the auto-managed entry wins (lf-file content owned by patchpanel
// trumps a manually-pointed external path).
const mergeHttpErrorsWithLf = (existingHttpErrors, lfPaths) => {
  const codesManaged = new Set(Object.keys(lfPaths).map(Number));
  const filtered = (existingHttpErrors ?? []).filter(d => !codesManaged.has(d.status));
  const injected = Object.entries(lfPaths).map(([code, path]) => ({
    status: Number(code),
    contentType: 'text/html; charset=utf-8',
    lfFile: path,
  }));
  return [...filtered, ...injected];
};

const persistCustomErrorPages = async (config, candidateParsed) => {
  const blocks = candidateParsed.defaultsBlocks ?? [];
  if (blocks.length === 0) {
    return candidateParsed;
  }
  const dir = config.paths.haproxyErrorPagesDir;
  const blocksNeedingWrites = blocks.filter(hasAnyContent);
  if (blocksNeedingWrites.length === 0) {
    return candidateParsed;
  }
  if (!dir) {
    log.app.warn(
      'errorPageContents/lfFileContents set but config.paths.haproxyErrorPagesDir is missing; skipping'
    );
    return candidateParsed;
  }
  await ensureDir(dir);
  const nextBlocks = await Promise.all(
    blocks.map(async block => {
      if (!hasAnyContent(block)) {
        return block;
      }
      const blockDir = joinPath(dir, block.id);
      await ensureDir(blockDir);
      const rawWritten = await persistRawErrorFiles(blockDir, block.errorPageContents ?? {});
      const lfWritten = await persistLfFileContents(blockDir, block.lfFileContents ?? {});
      const overriddenErrorFiles = { ...block.errorFiles, ...rawWritten };
      const mergedHttpErrors = mergeHttpErrorsWithLf(block.httpErrors, lfWritten);
      return {
        ...block,
        errorFiles: overriddenErrorFiles,
        httpErrors: mergedHttpErrors,
      };
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
  log.app.info('wrote map files', { count: maps.length, dir });
};

// Render + validate keepalived.conf in isolation, returning the rendered
// string (with watermark) when keepalived is enabled, or null when it's not.
// Extracted from applyState so the main pipeline stays under the cyclomatic
// complexity ceiling — semantics are unchanged: any failure here aborts the
// apply BEFORE any on-disk file is touched.
const renderAndValidateKeepalivedConfig = async (config, candidateParsed) => {
  if (!candidateParsed.keepalived?.enabled) {
    return null;
  }
  let rendered;
  try {
    const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
    rendered = withWatermark(renderKeepalivedConfig(candidateParsed, nodeConfig));
  } catch (err) {
    throw new StateError('state.apply.keepalivedRenderFailed', {
      replacements: { detail: err.message },
      cause: err,
    });
  }
  // Validate via a temp file — keepalived -t needs an actual path.
  const tmpKeepalived = `${config.paths.keepalivedConfig}.candidate`;
  try {
    await ensureDir(
      config.paths.keepalivedConfig.slice(0, config.paths.keepalivedConfig.lastIndexOf('/'))
    );
    await writeAtomic(tmpKeepalived, rendered, { mode: 0o644 });
    const validation = await keepalivedControl.validateConfigFile(
      config.paths.keepalivedBin,
      tmpKeepalived
    );
    if (!validation.ok) {
      throw new StateError('state.apply.keepalivedValidateFailed', {
        replacements: { output: validation.output },
      });
    }
  } finally {
    await fs.rm(tmpKeepalived, { force: true }).catch(() => undefined);
  }
  return rendered;
};

const addPathIfSet = (paths, p) => {
  if (typeof p === 'string' && p.length > 0) {
    paths.add(p);
  }
};

const collectDefaultsBlockPaths = (paths, block) => {
  for (const p of Object.values(block.errorFiles ?? {})) {
    addPathIfSet(paths, p);
  }
  for (const d of block.httpErrors ?? []) {
    addPathIfSet(paths, d.lfFile);
  }
};

const collectFrontendPaths = (paths, fe) => {
  for (const bind of fe.binds ?? []) {
    addPathIfSet(paths, bind.ssl?.crtListRef);
  }
  for (const p of Object.values(fe.httpOpts?.errorFiles ?? {})) {
    addPathIfSet(paths, p);
  }
};

const collectReferencedFilePaths = state => {
  const paths = new Set();
  for (const block of state.defaultsBlocks ?? []) {
    collectDefaultsBlockPaths(paths, block);
  }
  for (const sec of state.httpErrorsSections ?? []) {
    for (const p of Object.values(sec.errorFiles ?? {})) {
      addPathIfSet(paths, p);
    }
  }
  for (const fe of state.frontends ?? []) {
    collectFrontendPaths(paths, fe);
  }
  return paths;
};

const ensureFileStub = async p => {
  if (await fileExists(p)) {
    return;
  }
  const lastSlash = p.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureDir(p.slice(0, lastSlash));
  }
  await writeAtomic(p, '', { mode: 0o644 });
  log.app.warn('created empty stub for referenced file', { path: p });
};

const ensureReferencedFilesExist = async state => {
  const paths = collectReferencedFilePaths(state);
  await Promise.all([...paths].map(ensureFileStub));
};

const validateHaproxyCfg = async (haproxyBin, rendered, candidateParsed) => {
  try {
    await assertValidRenderedCfg(haproxyBin, rendered);
  } catch (err) {
    if (err.name === 'HaproxyError') {
      err.hints = parseValidationOutput(err.output, candidateParsed);
    }
    throw err;
  }
};

const writeConfigsWithBackup = async (config, rendered, renderedKeepalived) => {
  await preserveForeignConfig(config.paths.haproxyConfig);
  if (renderedKeepalived !== null) {
    await preserveForeignConfig(config.paths.keepalivedConfig);
  }
  const backupPath = await backupCfg(config.paths.haproxyConfig);
  let keepalivedBackupPath = null;
  if (renderedKeepalived !== null && (await fileExists(config.paths.keepalivedConfig))) {
    keepalivedBackupPath = `${config.paths.keepalivedConfig}.bak`;
    await fs.copyFile(config.paths.keepalivedConfig, keepalivedBackupPath).catch(() => undefined);
  }
  await writeAtomic(config.paths.haproxyConfig, rendered, { mode: 0o644 });
  log.app.info('haproxy.cfg written', { path: config.paths.haproxyConfig });
  if (renderedKeepalived !== null) {
    await writeAtomic(config.paths.keepalivedConfig, renderedKeepalived, { mode: 0o644 });
    log.app.info('keepalived.conf written', { path: config.paths.keepalivedConfig });
  }
  return { backupPath, keepalivedBackupPath };
};

const reloadKeepalivedIfNeeded = async (config, renderedKeepalived, editor) => {
  if (renderedKeepalived === null) {
    return;
  }
  try {
    await keepalivedControl.reload({ pidPath: config.paths.keepalivedPidFile });
  } catch (err) {
    log.app.warn('keepalived reload failed (non-fatal — config is on disk)', {
      error: err.message,
    });
    audit.record({
      actor: editor,
      category: 'keepalived',
      action: 'reload',
      outcome: 'error',
      details: { trigger: 'auto-after-apply', error: err.message },
    });
  }
};

const writeOptionalSnapshot = (config, next, editor, reason) => {
  if (!config.paths.snapshotsDir) {
    return;
  }
  writeSnapshot(config.paths.snapshotsDir, next, { actor: editor, reason }).catch(err =>
    log.app.warn('snapshot write failed (non-fatal)', { error: err.message })
  );
};

const reloadHaproxyWithRollback = async (
  config,
  backupPath,
  keepalivedBackupPath,
  editor,
  loadableCertCount
) => {
  try {
    await haproxyControl.reload(config);
  } catch (err) {
    await restoreCfgFromBackup(config.paths.haproxyConfig, backupPath);
    if (keepalivedBackupPath) {
      await fs.copyFile(keepalivedBackupPath, config.paths.keepalivedConfig).catch(() => undefined);
    }
    await haproxyControl.reload(config).catch(rollbackErr => {
      log.app.error('reload after rollback also failed; HAProxy may be in inconsistent state', {
        error: rollbackErr.message,
      });
    });
    await cleanupBackup(backupPath);
    await cleanupBackup(keepalivedBackupPath);
    audit.record({
      actor: editor,
      category: 'state',
      action: 'apply',
      outcome: 'error',
      details: { loadableCertCount, error: err.message },
    });
    throw new ReloadError('state.apply.reloadFailed', {
      replacements: { detail: err.message },
      cause: err,
    });
  }
};

const triggerPeerSyncIfEnabled = async (config, next, editor) => {
  const editorIsPeer = typeof editor === 'string' && editor.startsWith('peer');
  if (editorIsPeer) {
    return;
  }
  let nodeSyncCfg = null;
  try {
    const nc = await loadNodeConfig(config.paths.nodeConfig);
    nodeSyncCfg = nc.sync ?? null;
  } catch (err) {
    log.app.warn('node config load for sync gating failed (non-fatal)', { error: err.message });
  }
  if (nodeSyncCfg?.autoPushOnSave === true) {
    pushStateToAllPeers(config, next, {}).catch(err =>
      log.app.warn('peer sync push failed (non-fatal)', { error: err.message })
    );
  }
};

export const applyState = (config, candidate, options = {}) =>
  withLock(reloadLockPath(config), async () => {
    const editor = options.editor ?? null;
    const reason = options.reason ?? null;
    const candidateBase = StateSchema.parse(candidate);
    const candidateParsed = await persistCustomErrorPages(config, candidateBase);
    await persistMaps(config, candidateParsed);

    const emitted = await buildCertsList(
      config.paths,
      candidateParsed.tls.certs,
      candidateParsed.tls.providers
    );
    const loadableCertCount = emitted.length;

    await mirrorCrtListToReferencedPaths(config, candidateParsed);

    const rendered = withWatermark(
      renderHaproxyConfig(candidateParsed, {
        certsListPath: config.paths.haproxyCertsList,
        trustedCasDir: config.paths.trustedCasDir,
        trustedCrlsDir: config.paths.trustedCrlsDir,
        loadableCertCount,
      })
    );

    await ensureReferencedFilesExist(candidateParsed);
    await validateHaproxyCfg(config.paths.haproxyBin, rendered, candidateParsed);

    const renderedKeepalived = await renderAndValidateKeepalivedConfig(config, candidateParsed);

    const { backupPath, keepalivedBackupPath } = await writeConfigsWithBackup(
      config,
      rendered,
      renderedKeepalived
    );

    await reloadHaproxyWithRollback(
      config,
      backupPath,
      keepalivedBackupPath,
      editor,
      loadableCertCount
    );

    await reloadKeepalivedIfNeeded(config, renderedKeepalived, editor);

    await cleanupBackup(backupPath);
    await cleanupBackup(keepalivedBackupPath);

    // Persist the original candidate (with errorPageContents intact, original
    // errorFiles map) — the overridden errorFiles map is a render-time detail.
    const next = await saveState(config.paths.state, candidateBase, options);
    log.app.info('state saved after successful reload', { path: config.paths.state });

    writeOptionalSnapshot(config, next, editor, reason);

    audit.record({
      actor: editor,
      category: 'state',
      action: 'apply',
      outcome: 'ok',
      details: { loadableCertCount, reason },
    });

    await triggerPeerSyncIfEnabled(config, next, editor);

    return next;
  });
