import { Router } from 'express';

import { discoverByoLineages, discoverLineages, pickNewestValid } from '../lib/cert-lineage.js';
import { renewAllCerts } from '../lib/cert-renewal.js';
import { log } from '../lib/logger.js';
import { loadState } from '../lib/state.js';

const serializeLineage = lineage => ({
  lineageDir: lineage.lineageDir,
  notBefore: lineage.notBefore?.toISOString() ?? null,
  notAfter: lineage.notAfter?.toISOString() ?? null,
});

export const certificatesRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/certificates:
   *   get:
   *     summary: List configured certs with on-disk lineage status
   *     description: Joins `state.tls.certs` against the certbot lineage directories (or BYO cert folders for providers of type `byo`). Each entry shows every available lineage + the newest valid one, so the UI can flag missing or expired bundles.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Cert summary list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 certs:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id: { type: string }
   *                       certName: { type: string }
   *                       domains: { type: array, items: { type: string } }
   *                       providerId: { type: string }
   *                       providerType: { type: string, nullable: true, enum: [letsencrypt, byo, null] }
   *                       isByo: { type: boolean }
   *                       lineages:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             lineageDir: { type: string }
   *                             notBefore: { type: string, format: 'date-time', nullable: true }
   *                             notAfter: { type: string, format: 'date-time', nullable: true }
   *                       newest:
   *                         type: object
   *                         nullable: true
   *                         properties:
   *                           lineageDir: { type: string }
   *                           notBefore: { type: string, format: 'date-time', nullable: true }
   *                           notAfter: { type: string, format: 'date-time', nullable: true }
   */
  router.get('/certificates', async (req, res) => {
    log.api.debug('GET /certificates', { ip: req.ip });
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

  /**
   * @swagger
   * /api/certificates/renew:
   *   post:
   *     summary: Renew all certificates
   *     description: Triggers certbot for every Let's Encrypt cert in state. BYO certs are skipped (no renewal pipeline). Returns the per-cert result list plus the count of loadable certs after the run and the HAProxy reload outcome.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               force:
   *                 type: boolean
   *                 default: false
   *                 description: Pass `--force-renewal` to certbot, ignoring the not-yet-due check.
   *     responses:
   *       200:
   *         description: Renewal pass completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items: { type: object }
   *                 loadableCertCount: { type: integer }
   *                 reload:
   *                   type: object
   *                   properties:
   *                     ok: { type: boolean }
   *                     error: { type: string, nullable: true }
   *       409: { description: 'State not initialized', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/certificates/renew', async (req, res) => {
    log.api.info('POST /certificates/renew', {
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

  /**
   * @swagger
   * /api/certificates/{id}/renew:
   *   post:
   *     summary: Renew a single certificate
   *     description: Runs certbot for exactly one cert by id. Same body / response shape as `/api/certificates/renew` but scoped to one cert.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Cert id (matches `state.tls.certs[].id`)
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               force: { type: boolean, default: false }
   *     responses:
   *       200: { description: 'Renewal pass completed' }
   *       404: { description: 'Cert id not found in state', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'State not initialized', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/certificates/:id/renew', async (req, res) => {
    const certId = req.params.id;
    log.api.info('POST /certificates/:id/renew', {
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
