import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { errorResponse } from '../lib/api-response.js';
import { downloadDatabase, getStatus, lookupIp, lookupMany } from '../lib/geoip.js';
import { log } from '../lib/logger.js';
import { loadState } from '../lib/state.js';

const IP_PATTERN = /^[0-9a-fA-F:.]+$/u;

export const geoipRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/geoip/status:
   *   get:
   *     summary: GeoIP feature status
   *     description: Reports whether GeoIP is enabled, which local DB source is configured (`maxmind` / `dbip` / `none`), DB freshness, and online-fallback provider.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'GeoIP status', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/geoip/status', async (req, res, next) => {
    log.api.debug('GET /geoip/status', { ip: req.ip });
    try {
      const state = await loadState(config.paths.state);
      const status = await getStatus(config, state ?? { geoip: {} });
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/geoip/lookup/{ip}:
   *   get:
   *     summary: Geo-lookup a single IP
   *     description: Tries the local MaxMind / DB-IP MMDB first, then falls back to the configured online provider (`ip-api`, `ipinfo`, or `none`). Returns 409 when GeoIP is disabled in state.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ip
   *         required: true
   *         schema: { type: string }
   *         description: IPv4 or IPv6 string
   *     responses:
   *       200: { description: 'Geo data', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'Invalid IP', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'No data for IP', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'GeoIP not enabled', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/geoip/lookup/:ip', async (req, res, next) => {
    const target = req.params.ip;
    if (!IP_PATTERN.test(target)) {
      res.status(400).json(errorResponse(req, 'geoip.invalidIp'));
      return;
    }
    try {
      const state = await loadState(config.paths.state);
      if (!state?.geoip?.enabled) {
        res.status(409).json(errorResponse(req, 'geoip.notEnabled'));
        return;
      }
      const result = await lookupIp(config, state, target);
      if (!result) {
        res.status(404).json(errorResponse(req, 'geoip.noData'));
        return;
      }
      res.set('cache-control', 'public, max-age=1800').json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/geoip/lookup:
   *   post:
   *     summary: Bulk geo-lookup
   *     description: Looks up many IPs in one call. Returns a `{ip → result}` map. Subject to the same MMDB + online-fallback chain as the single-IP variant.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [ips]
   *             properties:
   *               ips:
   *                 type: array
   *                 items: { type: string }
   *                 description: Non-empty list of IPv4/IPv6 strings
   *     responses:
   *       200:
   *         description: Bulk results
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results: { type: object, additionalProperties: { type: object } }
   *       400: { description: 'Empty array or non-IP string', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'GeoIP not enabled', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/geoip/lookup', async (req, res, next) => {
    const ips = Array.isArray(req.body?.ips) ? req.body.ips : null;
    if (!ips || ips.length === 0) {
      res.status(400).json(errorResponse(req, 'geoip.bulk.empty'));
      return;
    }
    if (ips.some(ip => typeof ip !== 'string' || !IP_PATTERN.test(ip))) {
      res.status(400).json(errorResponse(req, 'geoip.bulk.invalidEntry'));
      return;
    }
    try {
      const state = await loadState(config.paths.state);
      if (!state?.geoip?.enabled) {
        res.status(409).json(errorResponse(req, 'geoip.notEnabled'));
        return;
      }
      const results = await lookupMany(config, state, ips);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/geoip/download:
   *   post:
   *     summary: Download the latest GeoLite/DB-IP MMDB
   *     description: Pulls a fresh MMDB from the configured source. MaxMind requires `state.geoip.maxmindLicenseKey`; DB-IP is keyless.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: MMDB downloaded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 path: { type: string }
   *                 bytes: { type: integer }
   *                 source: { type: string, enum: [maxmind, dbip] }
   *       409: { description: 'localDbSource = none, or MaxMind key missing', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/geoip/download', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /geoip/download', { ip: req.ip, actor });
    try {
      const state = await loadState(config.paths.state);
      const source = state?.geoip?.localDbSource ?? 'dbip';
      if (source === 'none') {
        res.status(409).json(errorResponse(req, 'geoip.download.sourceNone'));
        return;
      }
      if (source === 'maxmind' && !state?.geoip?.maxmindLicenseKey) {
        res.status(409).json(errorResponse(req, 'geoip.download.maxmindKeyRequired'));
        return;
      }
      const result = await downloadDatabase(config, state);
      audit.record({
        actor,
        category: 'geoip',
        action: 'download',
        outcome: 'ok',
        details: { path: result.path, bytes: result.bytes, source: result.source },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'geoip',
        action: 'download',
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
