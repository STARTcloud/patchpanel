import { Router } from 'express';

import { discoverByoLineages, discoverLineages, pickNewestValid } from '../lib/cert-lineage.js';
import { renewAllCerts } from '../lib/cert-renewal.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';

const serializeLineage = lineage => ({
  lineageDir: lineage.lineageDir,
  notBefore: lineage.notBefore?.toISOString() ?? null,
  notAfter: lineage.notAfter?.toISOString() ?? null,
});

export const certificatesRouter = config => {
  const router = Router();

  router.get('/certificates', async (req, res) => {
    logger.debug('GET /certificates', { ip: req.ip });
    const state = await loadState(config.paths.state);
    if (!state) {
      res.json({ certs: [] });
      return;
    }
    const providersById = new Map(state.tls.providers.map(p => [p.id, p]));
    const summaries = await Promise.all(
      state.tls.certs.map(async cert => {
        const provider = providersById.get(cert.providerId);
        const isByo = provider?.type === 'byo';
        const lineages = isByo
          ? await discoverByoLineages(config.paths.byoCertsDir, cert.certName)
          : await discoverLineages(config.paths.letsencryptDir, cert.certName);
        const newest = pickNewestValid(lineages);
        return {
          id: cert.id,
          certName: cert.certName,
          domains: cert.domains,
          providerId: cert.providerId,
          providerType: provider?.type ?? null,
          isByo,
          lineages: lineages.map(serializeLineage),
          newest: newest ? serializeLineage(newest) : null,
        };
      })
    );
    res.json({ certs: summaries });
  });

  router.post('/certificates/renew', async (req, res) => {
    logger.info('POST /certificates/renew', {
      ip: req.ip,
      actor: req.user?.id ?? null,
    });
    const state = await loadState(config.paths.state);
    if (!state) {
      res.status(409).json({ error: 'state not initialized' });
      return;
    }
    if (state.tls.certs.length === 0) {
      res.json({ results: [], loadableCertCount: 0, reload: { ok: true, error: null } });
      return;
    }
    const force = Boolean(req.body?.force);
    const result = await renewAllCerts(config, state, {
      actor: req.user?.id ?? null,
      force,
    });
    res.json(result);
  });

  router.post('/certificates/:id/renew', async (req, res) => {
    const certId = req.params.id;
    logger.info('POST /certificates/:id/renew', {
      ip: req.ip,
      actor: req.user?.id ?? null,
      certId,
    });
    const state = await loadState(config.paths.state);
    if (!state) {
      res.status(409).json({ error: 'state not initialized' });
      return;
    }
    if (!state.tls.certs.some(c => c.id === certId)) {
      res.status(404).json({ error: `cert not found: ${certId}` });
      return;
    }
    const force = Boolean(req.body?.force);
    const result = await renewAllCerts(config, state, {
      actor: req.user?.id ?? null,
      force,
      certId,
    });
    res.json(result);
  });

  return router;
};
