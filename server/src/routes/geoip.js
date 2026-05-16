import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { downloadDatabase, getStatus, lookupIp, lookupMany } from '../lib/geoip.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';

const IP_PATTERN = /^[0-9a-fA-F:.]+$/u;

export const geoipRouter = config => {
  const router = Router();

  router.get('/geoip/status', async (req, res, next) => {
    logger.debug('GET /geoip/status', { ip: req.ip });
    try {
      const state = await loadState(config.paths.state);
      const status = await getStatus(config, state ?? { geoip: {} });
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  router.get('/geoip/lookup/:ip', async (req, res, next) => {
    const target = req.params.ip;
    if (!IP_PATTERN.test(target)) {
      res.status(400).json({ error: 'invalid ip' });
      return;
    }
    try {
      const state = await loadState(config.paths.state);
      if (!state?.geoip?.enabled) {
        res.status(409).json({ error: 'geoip not enabled' });
        return;
      }
      const result = await lookupIp(config, state, target);
      if (!result) {
        res.status(404).json({ error: 'no geoip data for ip' });
        return;
      }
      res.set('cache-control', 'public, max-age=1800').json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/geoip/lookup', async (req, res, next) => {
    const ips = Array.isArray(req.body?.ips) ? req.body.ips : null;
    if (!ips || ips.length === 0) {
      res.status(400).json({ error: 'body.ips must be a non-empty array' });
      return;
    }
    if (ips.some(ip => typeof ip !== 'string' || !IP_PATTERN.test(ip))) {
      res.status(400).json({ error: 'every ip must be a valid v4/v6 string' });
      return;
    }
    try {
      const state = await loadState(config.paths.state);
      if (!state?.geoip?.enabled) {
        res.status(409).json({ error: 'geoip not enabled' });
        return;
      }
      const results = await lookupMany(config, state, ips);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  router.post('/geoip/download', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /geoip/download', { ip: req.ip, actor });
    try {
      const state = await loadState(config.paths.state);
      const source = state?.geoip?.localDbSource ?? 'dbip';
      if (source === 'none') {
        res.status(409).json({ error: 'Local DB source is set to "none"; nothing to download.' });
        return;
      }
      if (source === 'maxmind' && !state?.geoip?.maxmindLicenseKey) {
        res
          .status(409)
          .json({ error: 'MaxMind license key required when localDbSource is "maxmind".' });
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
