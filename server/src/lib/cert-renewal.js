import * as audit from './audit.js';
import { buildCertsList, ensureCertsDirs } from './cert-lineage.js';
import { renewCert } from './certbot.js';
import { mirrorCrtListToReferencedPaths } from './crt-list-mirror.js';
import { StateError } from './errors.js';
import { writeAtomic } from './files.js';
import * as haproxyControl from './haproxy-control.js';
import { assertValidRenderedCfg } from './haproxy-validate.js';
import { log } from './logger.js';
import { loadNodeConfig } from './node-config.js';
import { pushStateToAllPeers } from './peer-sync.js';
import { renderHaproxyConfig } from './render.js';

const renewOne = async (config, state, cert) => {
  const provider = state.tls.providers.find(p => p.id === cert.providerId);
  if (!provider) {
    throw new StateError('cert.renewal.providerMissing', {
      replacements: { certName: cert.certName, providerId: cert.providerId },
    });
  }
  // v0.2.38 — BYO providers have no ACME flow; renewal is a no-op for them.
  // The user replaces the PEM on disk via the BYO upload UI when they want
  // to rotate. `buildCertsList` will pick up the new PEM on the next render.
  if (provider.type === 'byo') {
    log.app.info('cert is BYO; skipping certbot renewal', { certName: cert.certName });
    return;
  }
  const account = (state.acmeAccounts ?? []).find(a => a.id === cert.acmeAccountId);
  if (!account) {
    throw new StateError('cert.renewal.acmeAccountMissing', {
      replacements: { certName: cert.certName, acmeAccountId: cert.acmeAccountId },
    });
  }
  await renewCert({
    certbotBin: config.paths.certbotBin,
    cert,
    provider,
    account,
    forceRenewal: state.letsencrypt.forceRenewal,
    propagationSeconds:
      provider.options?.propagationSeconds ?? state.letsencrypt.defaultPropagationSeconds,
    letsencryptDir: config.paths.letsencryptDir,
  });
};

const assertRenewalLeader = (nodeConfig, actor, certIdFilter) => {
  if (nodeConfig.renewalLeader === true) {
    return;
  }
  log.app.info('cert renewal skipped — this node is not the renewal leader', {
    nodeId: nodeConfig.nodeId,
    actor,
  });
  audit.record({
    actor,
    category: 'cert',
    action: 'renew',
    outcome: 'error',
    details: {
      scope: certIdFilter ? 'single' : 'all',
      skipped: 'not-renewal-leader',
      nodeId: nodeConfig.nodeId,
    },
  });
  throw new StateError('cert.renewal.notLeader', {
    replacements: { nodeId: nodeConfig.nodeId },
  });
};

const recordRenewalResults = (results, { actor, renewalState, certIdFilter }) => {
  for (const r of results) {
    audit.record({
      actor,
      category: 'cert',
      action: 'renew',
      target: r.certName,
      outcome: r.ok ? 'ok' : 'error',
      details: {
        staging: renewalState.letsencrypt.staging,
        forceRenewal: renewalState.letsencrypt.forceRenewal,
        scope: certIdFilter ? 'single' : 'all',
        ...(r.ok ? {} : { error: r.error }),
      },
    });
    if (r.ok) {
      log.app.info('cert renewed', { certName: r.certName });
    } else {
      log.app.error('cert renewal failed', {
        certName: r.certName,
        error: r.error,
        ...(r.output ? { certbotOutput: r.output } : {}),
      });
    }
  }
};

const rebuildAndReload = async (config, state, actor) => {
  const emitted = await buildCertsList(config.paths, state.tls.certs, state.tls.providers);
  const loadableCertCount = emitted.length;
  await mirrorCrtListToReferencedPaths(config, state);
  const rendered = renderHaproxyConfig(state, {
    certsListPath: config.paths.haproxyCertsList,
    trustedCasDir: config.paths.trustedCasDir,
    trustedCrlsDir: config.paths.trustedCrlsDir,
    loadableCertCount,
  });
  await assertValidRenderedCfg(config.paths.haproxyBin, rendered);
  await writeAtomic(config.paths.haproxyConfig, rendered, { mode: 0o644 });
  log.app.info('haproxy.cfg re-rendered after renewal', { loadableCertCount });

  let reloadOk = true;
  let reloadError = null;
  try {
    await haproxyControl.reload(config);
    log.app.info('haproxy reloaded after renewal');
  } catch (err) {
    reloadOk = false;
    reloadError = err.message;
    log.app.warn('haproxy reload skipped or failed', { error: err.message });
  }

  audit.record({
    actor,
    category: 'haproxy',
    action: 'reload',
    outcome: reloadOk ? 'ok' : 'error',
    details: {
      trigger: 'cert-renewal',
      loadableCertCount,
      ...(reloadError ? { error: reloadError } : {}),
    },
  });

  return { loadableCertCount, reload: { ok: reloadOk, error: reloadError } };
};

const syncRenewalToCluster = async (config, state, loadableCertCount, actor) => {
  try {
    const clusterSync = await pushStateToAllPeers(config, state, {
      trigger: 'cert-renewal',
      loadableCertCount,
    });
    if (clusterSync.pushed.length > 0 || clusterSync.failed.length > 0) {
      log.app.info('cluster sync after renewal', {
        pushed: clusterSync.pushed,
        failed: clusterSync.failed,
      });
    }
    return clusterSync;
  } catch (err) {
    log.app.warn('cluster sync after renewal failed', { error: err.message });
    audit.record({
      actor,
      category: 'cluster',
      action: 'sync-push',
      outcome: 'error',
      details: { trigger: 'cert-renewal', error: err.message },
    });
    return { pushed: [], failed: [], error: err.message };
  }
};

export const renewAllCerts = async (config, state, opts = {}) => {
  const actor = opts.actor ?? 'cron';
  const force = Boolean(opts.force);
  const certIdFilter = opts.certId ?? null;

  const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
  assertRenewalLeader(nodeConfig, actor, certIdFilter);

  const certsToRenew = certIdFilter
    ? state.tls.certs.filter(c => c.id === certIdFilter)
    : state.tls.certs;

  if (certIdFilter && certsToRenew.length === 0) {
    throw new StateError('cert.renewal.certIdNotFound', {
      replacements: { certId: certIdFilter },
    });
  }

  const renewalState = force
    ? { ...state, letsencrypt: { ...state.letsencrypt, forceRenewal: true } }
    : state;

  await ensureCertsDirs(config.paths);

  const results = await Promise.all(
    certsToRenew.map(cert =>
      renewOne(config, renewalState, cert)
        .then(() => ({ certName: cert.certName, ok: true }))
        .catch(err => ({
          certName: cert.certName,
          ok: false,
          error: err.message,
          output: err.output ?? null,
        }))
    )
  );

  recordRenewalResults(results, { actor, renewalState, certIdFilter });

  // Rebuild PEMs and cfg using the FULL cert list — never the filter — so
  // other certs' PEMs aren't pruned by sanitizeOldPems, and the rendered
  // cfg keeps SNI coverage for every host in state.
  const { loadableCertCount, reload } = await rebuildAndReload(config, state, actor);
  const clusterSync =
    nodeConfig.sync?.autoPushOnSave === true
      ? await syncRenewalToCluster(config, state, loadableCertCount, actor)
      : { skipped: 'autoPushOnSave-disabled' };

  return { results, loadableCertCount, reload, clusterSync };
};
