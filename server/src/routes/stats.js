import { Router } from 'express';

import { lookupMany } from '../lib/geoip.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';

export const statsRouter = (config, statsSampler) => {
  const router = Router();

  router.get('/stats', async (req, res) => {
    logger.debug('GET /stats', { ip: req.ip });
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

  router.get('/stats/slowest-backends', (req, res) => {
    logger.debug('GET /stats/slowest-backends', { ip: req.ip });
    if (!statsSampler) {
      res.status(503).json({ error: 'stats sampler not running' });
      return;
    }
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    res.set('cache-control', 'no-store').json({ rows: statsSampler.slowestBackends({ limit }) });
  });

  router.get('/stats/http-codes', (req, res) => {
    logger.debug('GET /stats/http-codes', { ip: req.ip });
    if (!statsSampler) {
      res.status(503).json({ error: 'stats sampler not running' });
      return;
    }
    res.set('cache-control', 'no-store').json({ totals: statsSampler.httpStatusDistribution() });
  });

  router.get('/stats/sessions', async (req, res) => {
    logger.debug('GET /stats/sessions', { ip: req.ip });
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
