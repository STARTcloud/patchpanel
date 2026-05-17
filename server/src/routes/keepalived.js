import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { fileExists, readText } from '../lib/files.js';
import * as keepalivedControl from '../lib/keepalived-control.js';
import { loadNodeConfig } from '../lib/node-config.js';
import * as logger from '../lib/logger.js';
import { renderKeepalivedConfig } from '../lib/render-keepalived.js';
import { loadState } from '../lib/state.js';

// Mirrors routes/haproxy.js. Same shape, same audit conventions.
//   GET    /api/keepalived/cfg?source=disk|state
//   GET    /api/keepalived/control-strategy
//   POST   /api/keepalived/reload
//   POST   /api/keepalived/stop    (body: { confirm: true })
//   POST   /api/keepalived/start
//   GET    /api/keepalived/state                 — runtime liveness + VRRP state

export const keepalivedRouter = config => {
  const router = Router();

  router.get('/keepalived/cfg', async (req, res, next) => {
    const source = req.query.source === 'state' ? 'state' : 'disk';
    logger.debug('GET /keepalived/cfg', { ip: req.ip, source });
    try {
      if (source === 'state') {
        const state = await loadState(config.paths.state);
        if (!state) {
          res.status(409).json({ error: 'state not initialized' });
          return;
        }
        const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
        const rendered = renderKeepalivedConfig(state, nodeConfig);
        res
          .set('content-type', 'text/plain; charset=utf-8')
          .set('cache-control', 'no-store')
          .send(rendered);
        return;
      }
      if (!(await fileExists(config.paths.keepalivedConfig))) {
        res
          .status(404)
          .json({ error: `keepalived.conf not found at ${config.paths.keepalivedConfig}` });
        return;
      }
      const text = await readText(config.paths.keepalivedConfig);
      res
        .set('content-type', 'text/plain; charset=utf-8')
        .set('cache-control', 'no-store')
        .send(text);
    } catch (err) {
      next(err);
    }
  });

  router.get('/keepalived/control-strategy', async (req, res, next) => {
    logger.debug('GET /keepalived/control-strategy', { ip: req.ip });
    try {
      const strategy = await keepalivedControl.getStrategy();
      res
        .set('cache-control', 'no-store')
        .json({ strategy, pidPath: config.paths.keepalivedPidFile });
    } catch (err) {
      next(err);
    }
  });

  router.post('/keepalived/reload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /keepalived/reload', { ip: req.ip, actor });
    try {
      const result = await keepalivedControl.reload({ pidPath: config.paths.keepalivedPidFile });
      audit.record({
        actor,
        category: 'keepalived',
        action: 'reload',
        outcome: 'ok',
        details: { trigger: 'manual', output: (result.stdout || '').slice(0, 500) },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'keepalived',
        action: 'reload',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  router.post('/keepalived/stop', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    if (req.body?.confirm !== true) {
      res.status(400).json({
        error:
          'stop requires { "confirm": true } in body — VIPs held by this node will fail over to a peer (if one exists)',
      });
      return;
    }
    logger.info('POST /keepalived/stop', { ip: req.ip, actor });
    try {
      const result = await keepalivedControl.stop({ pidPath: config.paths.keepalivedPidFile });
      audit.record({
        actor,
        category: 'keepalived',
        action: 'stop',
        outcome: 'ok',
        details: { trigger: 'manual', output: (result.stdout || '').slice(0, 500) },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'keepalived',
        action: 'stop',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  router.post('/keepalived/start', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /keepalived/start', { ip: req.ip, actor });
    try {
      const result = await keepalivedControl.start();
      audit.record({
        actor,
        category: 'keepalived',
        action: 'start',
        outcome: 'ok',
        details: { trigger: 'manual', output: (result.stdout || '').slice(0, 500) },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'keepalived',
        action: 'start',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  // Runtime liveness. The current implementation reports pid-based liveness
  // and the configured instances; per-instance VRRP state (MASTER/BACKUP)
  // is left null for now — reading keepalived's runtime state requires
  // SIGUSR2 to /tmp/keepalived.data or a privileged DBus call, which has
  // platform-specific failure modes. UI consumers treat null as "checking".
  router.get('/keepalived/state', async (req, res, next) => {
    logger.debug('GET /keepalived/state', { ip: req.ip });
    try {
      const strategy = await keepalivedControl.getStrategy();
      const alive = await keepalivedControl.isAlive({
        pidPath: config.paths.keepalivedPidFile,
      });
      const state = await loadState(config.paths.state);
      const instances = (state?.keepalived?.instances ?? []).map(inst => ({
        id: inst.id,
        name: inst.name,
        vip: inst.vip,
        state: null,
        holding: null,
      }));
      res.set('cache-control', 'no-store').json({ alive, strategy, instances });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
