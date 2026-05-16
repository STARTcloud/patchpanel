import { promises as fs } from 'node:fs';

import { Router } from 'express';

import { listCertificates } from '../lib/certbot.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';

const TEST_TIMEOUT_MS = 8_000;

const probeUrl = async (url, opts = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      headers: opts.headers ?? {},
    });
    const elapsedMs = Date.now() - started;
    const contentType = response.headers.get('content-type') ?? '';
    let body = null;
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => null);
      if (typeof body === 'string' && body.length > 4096) {
        body = body.slice(0, 4096);
      }
    }
    return { ok: response.ok, status: response.status, elapsedMs, contentType, body };
  } finally {
    clearTimeout(timer);
  }
};

const resolveBackendAddressFromState = (state, backendId) => {
  if (!backendId) {
    return { ok: false, reason: 'no authRequestBackendId configured' };
  }
  const backend = (state?.backends ?? []).find(b => b.id === backendId);
  if (!backend) {
    return { ok: false, reason: `backend "${backendId}" not found in state.backends` };
  }
  const server = backend.servers?.[0];
  if (!server?.address) {
    return { ok: false, reason: `backend "${backendId}" has no servers configured` };
  }
  return { ok: true, backendId, backendName: backend.name, address: server.address };
};

const testAutheliaProvider = async (provider, state) => {
  const resolved = resolveBackendAddressFromState(state, provider.config?.authRequestBackendId);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const { address: backend } = resolved;
  const candidates = [
    `http://${backend}/api/configuration`,
    `http://${backend}/api/health`,
    `http://${backend}/api/state`,
  ];
  const probes = [];
  for (const url of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await probeUrl(url);
      probes.push({ url, status: r.status, ok: r.ok, elapsedMs: r.elapsedMs });
      if (r.ok) {
        return {
          ok: true,
          backend,
          backendId: resolved.backendId,
          checkedUrl: url,
          status: r.status,
          elapsedMs: r.elapsedMs,
          version: r.body?.data?.version ?? r.body?.version ?? null,
          response: r.body,
          attempts: probes,
        };
      }
    } catch (err) {
      probes.push({ url, ok: false, error: err.message });
    }
  }
  return {
    ok: false,
    backend,
    backendId: resolved.backendId,
    reason: 'no candidate endpoint returned 2xx',
    attempts: probes,
  };
};

const testBasicProvider = async provider => {
  const users = provider.config?.users ?? [];
  if (users.length === 0) {
    return { ok: false, reason: 'no users configured' };
  }
  const results = await Promise.all(
    users.map(async u => {
      try {
        const stat = await fs.stat(u.passwordHashRef);
        return {
          username: u.username,
          ref: u.passwordHashRef,
          ok: stat.isFile(),
          bytes: stat.size,
        };
      } catch (err) {
        return { username: u.username, ref: u.passwordHashRef, ok: false, error: err.message };
      }
    })
  );
  return { ok: results.every(r => r.ok), users: results };
};

const testOidcProvider = async provider => {
  const issuer = provider.config?.issuer;
  if (!issuer) {
    return { ok: false, reason: 'no issuer configured' };
  }
  const discoveryUrl = `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`;
  try {
    const r = await probeUrl(discoveryUrl);
    if (!r.ok) {
      return {
        ok: false,
        issuer,
        discoveryUrl,
        status: r.status,
        reason: `discovery returned ${r.status}`,
      };
    }
    return {
      ok: true,
      issuer,
      discoveryUrl,
      status: r.status,
      elapsedMs: r.elapsedMs,
      authorizationEndpoint: r.body?.authorization_endpoint ?? null,
      tokenEndpoint: r.body?.token_endpoint ?? null,
      jwksUri: r.body?.jwks_uri ?? null,
    };
  } catch (err) {
    return { ok: false, issuer, discoveryUrl, error: err.message };
  }
};

// v0.2.39 — Test endpoints for the new auth kinds.
//
// LDAP / SAML / Entra / JWT-verify all run their actual authentication
// through a sidecar reachable via `cfg.backendAddress`. The "Test" button
// probes the sidecar (when applicable) and the upstream identity provider
// directly so users can distinguish "patchpanel cfg wrong" from "sidecar
// unreachable" from "IdP unreachable".

const probeBackendAddress = async (backendAddress, paths) => {
  if (!backendAddress) {
    return { ok: false, reason: 'no backendAddress configured' };
  }
  const attempts = [];
  for (const path of paths) {
    const url = `http://${backendAddress}${path}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await probeUrl(url);
      attempts.push({ url, status: r.status, ok: r.ok, elapsedMs: r.elapsedMs });
      if (r.ok || r.status === 401 || r.status === 405) {
        // 401 + 405 still mean "reachable" for an auth endpoint — the sidecar
        // is up, it just rejected the unauthenticated probe.
        return { ok: true, checkedUrl: url, status: r.status, attempts };
      }
    } catch (err) {
      attempts.push({ url, ok: false, error: err.message });
    }
  }
  return { ok: false, reason: 'no probe returned a reachable status', attempts };
};

const testLdapProvider = async (provider, state) => {
  const cfg = provider.config ?? {};
  const resolved = resolveBackendAddressFromState(state, cfg.authRequestBackendId);
  if (!resolved.ok) {
    return {
      ldapUrl: cfg.url ?? null,
      authRequestBackendId: cfg.authRequestBackendId ?? null,
      sidecar: { ok: false, reason: resolved.reason },
      ok: false,
    };
  }
  const sidecar = await probeBackendAddress(resolved.address, [
    cfg.authRequestPath ?? '/auth',
    '/health',
    '/',
  ]);
  return {
    ldapUrl: cfg.url ?? null,
    authRequestBackendId: resolved.backendId,
    backendAddress: resolved.address,
    sidecar,
    ok: sidecar.ok,
  };
};

const testSamlProvider = async (provider, state) => {
  const cfg = provider.config ?? {};
  let metadataResult = null;
  if (cfg.idpMetadataUrl) {
    try {
      const r = await probeUrl(cfg.idpMetadataUrl);
      metadataResult = {
        ok: r.ok,
        status: r.status,
        elapsedMs: r.elapsedMs,
        contentType: r.contentType,
        bytes: typeof r.body === 'string' ? r.body.length : null,
      };
    } catch (err) {
      metadataResult = { ok: false, error: err.message };
    }
  }
  const resolved = resolveBackendAddressFromState(state, cfg.authRequestBackendId);
  if (!resolved.ok) {
    return {
      idpMetadataUrl: cfg.idpMetadataUrl ?? null,
      metadata: metadataResult,
      authRequestBackendId: cfg.authRequestBackendId ?? null,
      sidecar: { ok: false, reason: resolved.reason },
      ok: false,
    };
  }
  const sidecar = await probeBackendAddress(resolved.address, [
    cfg.authRequestPath ?? '/saml/auth',
    '/health',
    '/',
  ]);
  return {
    idpMetadataUrl: cfg.idpMetadataUrl ?? null,
    metadata: metadataResult,
    authRequestBackendId: resolved.backendId,
    backendAddress: resolved.address,
    sidecar,
    ok: (metadataResult?.ok ?? false) && sidecar.ok,
  };
};

const testEntraProvider = async (provider, state) => {
  const cfg = provider.config ?? {};
  let discoveryResult = null;
  if (cfg.tenantId) {
    const discoveryUrl = `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/v2.0/.well-known/openid-configuration`;
    try {
      const r = await probeUrl(discoveryUrl);
      discoveryResult = {
        ok: r.ok,
        status: r.status,
        elapsedMs: r.elapsedMs,
        discoveryUrl,
        authorizationEndpoint: r.body?.authorization_endpoint ?? null,
        tokenEndpoint: r.body?.token_endpoint ?? null,
        jwksUri: r.body?.jwks_uri ?? null,
      };
    } catch (err) {
      discoveryResult = { ok: false, error: err.message, discoveryUrl };
    }
  }
  const resolved = resolveBackendAddressFromState(state, cfg.authRequestBackendId);
  if (!resolved.ok) {
    return {
      tenantId: cfg.tenantId ?? null,
      discovery: discoveryResult,
      authRequestBackendId: cfg.authRequestBackendId ?? null,
      sidecar: { ok: false, reason: resolved.reason },
      ok: false,
    };
  }
  const sidecar = await probeBackendAddress(resolved.address, [
    cfg.authRequestPath ?? '/auth',
    '/health',
    '/',
  ]);
  return {
    tenantId: cfg.tenantId ?? null,
    discovery: discoveryResult,
    authRequestBackendId: resolved.backendId,
    backendAddress: resolved.address,
    sidecar,
    ok: (discoveryResult?.ok ?? false) && sidecar.ok,
  };
};

const testJwtVerifyProvider = async (provider, state) => {
  const cfg = provider.config ?? {};
  let jwksResult = null;
  if (cfg.jwksUrl) {
    try {
      const r = await probeUrl(cfg.jwksUrl);
      const keys = Array.isArray(r.body?.keys) ? r.body.keys : [];
      jwksResult = {
        ok: r.ok,
        status: r.status,
        elapsedMs: r.elapsedMs,
        keyCount: keys.length,
        algorithms: [...new Set(keys.map(k => k.alg).filter(Boolean))],
      };
    } catch (err) {
      jwksResult = { ok: false, error: err.message };
    }
  }
  const resolved = resolveBackendAddressFromState(state, cfg.authRequestBackendId);
  if (!resolved.ok) {
    return {
      jwksUrl: cfg.jwksUrl ?? null,
      jwks: jwksResult,
      authRequestBackendId: cfg.authRequestBackendId ?? null,
      sidecar: { ok: false, reason: resolved.reason },
      ok: false,
    };
  }
  const sidecar = await probeBackendAddress(resolved.address, [
    cfg.authRequestPath ?? '/verify',
    '/health',
    '/',
  ]);
  return {
    jwksUrl: cfg.jwksUrl ?? null,
    jwks: jwksResult,
    authRequestBackendId: resolved.backendId,
    backendAddress: resolved.address,
    sidecar,
    ok: (jwksResult?.ok ?? false) && sidecar.ok,
  };
};

const testMtlsAuthProvider = provider => {
  const cfg = provider.config ?? {};
  return {
    ok: true,
    note: 'mtls-auth has no backend to probe. Verify your mTLS frontend (under Frontends → Additional frontends, kind: mtls) is configured with a valid ca-file and verify: required.',
    trustedAttribute: cfg.trustedAttribute ?? 'cn',
    userHeaderName: cfg.userHeaderName ?? 'X-Client-CN',
    requirePresent: cfg.requirePresent !== false,
  };
};

const testHeaderTrustProvider = provider => {
  const cfg = provider.config ?? {};
  return {
    ok: (cfg.trustedSourceCidrs ?? []).length > 0,
    note: 'header-trust has no backend to probe. Verify the configured CIDRs match where your upstream auth proxy actually originates (e.g. Cloudflare publishes their ranges at cloudflare.com/ips/).',
    headerName: cfg.headerName ?? null,
    trustedSourceCidrs: cfg.trustedSourceCidrs ?? [],
    stripFromUntrusted: cfg.stripFromUntrusted !== false,
  };
};

const testLuaAuthProvider = async provider => {
  const cfg = provider.config ?? {};
  let pluginStat = null;
  if (cfg.pluginPath) {
    try {
      const stat = await fs.stat(cfg.pluginPath);
      pluginStat = { exists: stat.isFile(), bytes: stat.size, mode: stat.mode.toString(8) };
    } catch (err) {
      pluginStat = { exists: false, error: err.message };
    }
  }
  return {
    pluginPath: cfg.pluginPath ?? null,
    functionName: cfg.functionName ?? null,
    pluginStat,
    ok: pluginStat?.exists === true,
  };
};

const checkCredentialsFile = async ref => {
  if (!ref) {
    return null;
  }
  try {
    const stat = await fs.stat(ref);
    return { exists: true, bytes: stat.size, mode: stat.mode.toString(8) };
  } catch (err) {
    return { exists: false, error: err.message };
  }
};

const AUTH_TESTERS = Object.freeze({
  authelia: testAutheliaProvider,
  basic: testBasicProvider,
  oidc: testOidcProvider,
  ldap: testLdapProvider,
  saml: testSamlProvider,
  entra: testEntraProvider,
  'jwt-verify': testJwtVerifyProvider,
  'mtls-auth': testMtlsAuthProvider,
  'header-trust': testHeaderTrustProvider,
  'lua-auth': testLuaAuthProvider,
});

const dispatchAuthTest = (provider, state) => {
  const tester = AUTH_TESTERS[provider.type];
  if (!tester) {
    return Promise.resolve({ ok: true, type: provider.type, note: 'no-op provider' });
  }
  // Each tester may return a value or a Promise; Promise.resolve normalizes.
  // Sidecar testers consume `state` to resolve authRequestBackendId; others
  // ignore the second arg.
  return Promise.resolve(tester(provider, state));
};

const testTlsProvider = async (provider, config) => {
  const out = { type: provider.type, credentialsRef: provider.credentialsRef ?? null };
  out.credentialsFile = await checkCredentialsFile(provider.credentialsRef);
  try {
    const stdout = await listCertificates(config.paths.certbotBin);
    const lineages = (stdout.match(/Certificate Name:[^\n]+/gu) ?? []).map(line =>
      line.replace('Certificate Name:', '').trim()
    );
    out.certbotLineages = lineages;
    out.ok = true;
  } catch (err) {
    out.certbotLineages = [];
    out.ok = false;
    out.certbotError = err.message;
  }
  return out;
};

export const providersRouter = config => {
  const router = Router();

  router.post('/auth-providers/:id/test', async (req, res, next) => {
    const { id } = req.params;
    logger.info('POST /auth-providers/:id/test', { ip: req.ip, id });
    try {
      const state = await loadState(config.paths.state);
      const provider = state?.authProviders?.find(p => p.id === id);
      if (!provider) {
        res.status(404).json({ error: `auth provider not found: ${id}` });
        return;
      }
      const result = await dispatchAuthTest(provider, state);
      res.json({ id, type: provider.type, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/tls-providers/:id/test', async (req, res, next) => {
    const { id } = req.params;
    logger.info('POST /tls-providers/:id/test', { ip: req.ip, id });
    try {
      const state = await loadState(config.paths.state);
      const provider = state?.tls?.providers?.find(p => p.id === id);
      if (!provider) {
        res.status(404).json({ error: `tls provider not found: ${id}` });
        return;
      }
      const result = await testTlsProvider(provider, config);
      res.json({ id, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
