import * as audit from './audit.js';
import { buildCertsList, ensureCertsDirs } from './cert-lineage.js';
import { renewCert } from './certbot.js';
import { writeAtomic } from './files.js';
import { assertValidRenderedCfg } from './haproxy-validate.js';
import * as haproxyMaster from './haproxy-master.js';
import * as logger from './logger.js';
import { renderHaproxyConfig } from './render.js';

const renewOne = async (config, state, cert) => {
  const provider = state.tls.providers.find(p => p.id === cert.providerId);
  if (!provider) {
    throw new Error(`cert ${cert.certName} references unknown provider ${cert.providerId}`);
  }
  // v0.2.38 — BYO providers have no ACME flow; renewal is a no-op for them.
  // The user replaces the PEM on disk via the BYO upload UI when they want
  // to rotate. `buildCertsList` will pick up the new PEM on the next render.
  if (provider.type === 'byo') {
    logger.info('cert is BYO; skipping certbot renewal', { certName: cert.certName });
    return;
  }
  const account = (state.acmeAccounts ?? []).find(a => a.id === cert.acmeAccountId);
  if (!account) {
    throw new Error(`cert ${cert.certName} references unknown ACME account ${cert.acmeAccountId}`);
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

export const renewAllCerts = async (config, state, opts = {}) => {
  const actor = opts.actor ?? 'cron';
  const force = Boolean(opts.force);
  const certIdFilter = opts.certId ?? null;

  const certsToRenew = certIdFilter
    ? state.tls.certs.filter(c => c.id === certIdFilter)
    : state.tls.certs;

  if (certIdFilter && certsToRenew.length === 0) {
    throw new Error(`cert not found in state: ${certIdFilter}`);
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
      logger.info('cert renewed', { certName: r.certName });
    } else {
      logger.error('cert renewal failed', {
        certName: r.certName,
        error: r.error,
        ...(r.output ? { certbotOutput: r.output } : {}),
      });
    }
  }

  // Rebuild PEMs and cfg using the FULL cert list — never the filter — so
  // other certs' PEMs aren't pruned by sanitizeOldPems, and the rendered
  // cfg keeps SNI coverage for every host in state.
  const emitted = await buildCertsList(config.paths, state.tls.certs, state.tls.providers);
  const loadableCertCount = emitted.length;

  const rendered = renderHaproxyConfig(state, {
    certsListPath: config.paths.haproxyCertsList,
    trustedCasDir: config.paths.trustedCasDir,
    trustedCrlsDir: config.paths.trustedCrlsDir,
    loadableCertCount,
  });

  await assertValidRenderedCfg(config.paths.haproxyBin, rendered);
  await writeAtomic(config.paths.haproxyConfig, rendered, { mode: 0o644 });
  logger.info('haproxy.cfg re-rendered after renewal', { loadableCertCount });

  let reloadOk = true;
  let reloadError = null;
  try {
    await haproxyMaster.reload(config.paths.haproxyMasterSocket);
    logger.info('haproxy reloaded after renewal');
  } catch (err) {
    reloadOk = false;
    reloadError = err.message;
    logger.warning('haproxy reload skipped or failed', { error: err.message });
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

  return {
    results,
    loadableCertCount,
    reload: { ok: reloadOk, error: reloadError },
  };
};
