import { Router } from 'express';

import { lookupMany } from '../lib/geoip.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import { log } from '../lib/logger.js';
import { loadState } from '../lib/state.js';

export const statsRouter = (config, statsSampler) => {
  const router = Router();

  /**
   * @swagger
   * /api/stats:
   *   get:
   *     summary: HAProxy show info + show stat snapshot
   *     description: Combines `show info` (global counters, uptime, build) with `show stat` (per-frontend / per-backend / per-server rows) for a single snapshot. Use `/api/stats/history` for time-series.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Snapshot
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 info: { type: object }
   *                 stat: { type: array, items: { type: object } }
   *       502: { description: 'Stats socket unavailable', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/stats', async (req, res) => {
    log.api.debug('GET /stats', { ip: req.ip });
    try {
      const [info, stat] = await Promise.all([
        haproxyStats.showInfo(config.paths.haproxyStatsSocket),
        haproxyStats.showStat(config.paths.haproxyStatsSocket),
      ]);
      res.json({ info, stat });
    } catch (err) {
      res.status(502).json({ error: 'haproxy_stats_unavailable', message: err.message });
    }
  });

  /**
   * @swagger
   * /api/stats/history:
   *   get:
   *     summary: Server-side rolling stats sampler buffer
   *     description: Returns the in-process 1-hour rolling time-series of frontend/backend traffic. Pass `?since=<epochMs>` to receive only samples newer than the timestamp.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: since
   *         schema: { type: integer, format: 'int64', description: 'Epoch ms threshold' }
   *     responses:
   *       200: { description: 'Sampler snapshot', content: { application/json: { schema: { type: object } } } }
   *       503: { description: 'Stats sampler not running', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/stats/history', (req, res) => {
    if (!statsSampler) {
      res.status(503).json({ error: 'stats sampler not running' });
      return;
    }
    const since = req.query.since ? Number(req.query.since) : null;
    const snapshot = statsSampler.snapshot({
      since: since && Number.isFinite(since) ? since : null,
    });
    res.set('cache-control', 'no-store').json(snapshot);
  });

  /**
   * @swagger
   * /api/stats/slowest-backends:
   *   get:
   *     summary: Top-N backends by HAProxy rtime
   *     description: Sorted by `rtime` (avg response time over the last 1024 requests). Defaults to 10; clamped to 1..50.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 50, default: 10 }
   *     responses:
   *       200:
   *         description: Slowest backend rows
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 rows: { type: array, items: { type: object } }
   *       503: { description: 'Stats sampler not running', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/stats/slowest-backends', (req, res) => {
    log.api.debug('GET /stats/slowest-backends', { ip: req.ip });
    if (!statsSampler) {
      res.status(503).json({ error: 'stats sampler not running' });
      return;
    }
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    res.set('cache-control', 'no-store').json({ rows: statsSampler.slowestBackends({ limit }) });
  });

  /**
   * @swagger
   * /api/stats/http-codes:
   *   get:
   *     summary: HTTP status-code distribution across the sampled window
   *     description: Aggregated 1xx/2xx/3xx/4xx/5xx/other counts over the rolling sampler window.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Distribution totals
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 totals: { type: object }
   *       503: { description: 'Stats sampler not running', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/stats/http-codes', (req, res) => {
    log.api.debug('GET /stats/http-codes', { ip: req.ip });
    if (!statsSampler) {
      res.status(503).json({ error: 'stats sampler not running' });
      return;
    }
    res.set('cache-control', 'no-store').json({ totals: statsSampler.httpStatusDistribution() });
  });

  /**
   * @swagger
   * /api/stats/sessions:
   *   get:
   *     summary: Active session summary (top clients / frontends / backends)
   *     description: Aggregates `show sess all`. When `state.geoip.enabled` is true, the top 20 client IPs are geo-enriched.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Session summary
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 topClients: { type: array, items: { type: object } }
   *                 topFrontends: { type: array, items: { type: object } }
   *                 topBackends: { type: array, items: { type: object } }
   *       502: { description: 'Sessions socket unavailable', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/stats/sessions', async (req, res) => {
    log.api.debug('GET /stats/sessions', { ip: req.ip });
    try {
      const summary = await haproxyStats.showSessionsSummary(config.paths.haproxyStatsSocket);
      const state = await loadState(config.paths.state).catch(() => null);
      if (state?.geoip?.enabled) {
        const topIps = summary.topClients.slice(0, 20).map(c => c.key);
        const geoMap = await lookupMany(config, state, topIps).catch(() => ({}));
        summary.topClients = summary.topClients.map(entry =>
          geoMap[entry.key] ? { ...entry, geo: geoMap[entry.key] } : entry
        );
      }
      res.json(summary);
    } catch (err) {
      res.status(502).json({ error: 'haproxy_sessions_unavailable', message: err.message });
    }
  });

  return router;
};
