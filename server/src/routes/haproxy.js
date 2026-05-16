import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as haproxyControl from '../lib/haproxy-control.js';
import { fileExists, readText } from '../lib/files.js';
import * as haproxyMaster from '../lib/haproxy-master.js';
import { fetchSslCapabilities } from '../lib/haproxy-ssl-capabilities.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import * as logger from '../lib/logger.js';
import { renderHaproxyConfig } from '../lib/render.js';
import { loadState } from '../lib/state.js';

const VALID_SERVER_STATES = Object.freeze(['ready', 'drain', 'maint']);

export const haproxyRouter = config => {
  const router = Router();

  router.get('/haproxy/cfg', async (req, res, next) => {
    const source = req.query.source === 'state' ? 'state' : 'disk';
    logger.debug('GET /haproxy/cfg', { ip: req.ip, source });
    try {
      if (source === 'state') {
        const state = await loadState(config.paths.state);
        if (!state) {
          res.status(409).json({ error: 'state not initialized' });
          return;
        }
        const rendered = renderHaproxyConfig(state, {
          certsListPath: config.paths.haproxyCertsList,
          trustedCasDir: config.paths.trustedCasDir,
          trustedCrlsDir: config.paths.trustedCrlsDir,
        });
        res
          .set('content-type', 'text/plain; charset=utf-8')
          .set('cache-control', 'no-store')
          .send(rendered);
        return;
      }
      if (!(await fileExists(config.paths.haproxyConfig))) {
        res.status(404).json({ error: `cfg not found at ${config.paths.haproxyConfig}` });
        return;
      }
      const text = await readText(config.paths.haproxyConfig);
      res
        .set('content-type', 'text/plain; charset=utf-8')
        .set('cache-control', 'no-store')
        .send(text);
    } catch (err) {
      next(err);
    }
  });

  router.post('/haproxy/reload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /haproxy/reload', { ip: req.ip, actor });
    try {
      const output = await haproxyMaster.reload(config.paths.haproxyMasterSocket);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'reload',
        outcome: 'ok',
        details: { trigger: 'manual', output: output.trim().slice(0, 500) },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'reload',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  router.get('/haproxy/control-strategy', async (req, res, next) => {
    logger.debug('GET /haproxy/control-strategy', { ip: req.ip });
    try {
      const strategy = await haproxyControl.getStrategy();
      res.set('cache-control', 'no-store').json({ strategy, pidPath: config.paths.haproxyPidFile });
    } catch (err) {
      next(err);
    }
  });

  router.post('/haproxy/stop', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    if (req.body?.confirm !== true) {
      res.status(400).json({
        error: 'stop requires { "confirm": true } in body — this will drop all proxied connections',
      });
      return;
    }
    logger.info('POST /haproxy/stop', { ip: req.ip, actor });
    try {
      const result = await haproxyControl.stop({ pidPath: config.paths.haproxyPidFile });
      audit.record({
        actor,
        category: 'haproxy',
        action: 'stop',
        outcome: 'ok',
        details: { trigger: 'manual', output: (result.stdout || '').slice(0, 500) },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'stop',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  router.post('/haproxy/start', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /haproxy/start', { ip: req.ip, actor });
    try {
      const result = await haproxyControl.start();
      audit.record({
        actor,
        category: 'haproxy',
        action: 'start',
        outcome: 'ok',
        details: { trigger: 'manual', output: (result.stdout || '').slice(0, 500) },
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'start',
        outcome: 'error',
        details: { trigger: 'manual', error: err.message },
      });
      next(err);
    }
  });

  router.get('/haproxy/ssl-capabilities', async (req, res, next) => {
    logger.debug('GET /haproxy/ssl-capabilities', { ip: req.ip });
    try {
      const capabilities = await fetchSslCapabilities({
        haproxyBin: config.paths.haproxyBin,
      });
      res.set('cache-control', 'no-store').json(capabilities);
    } catch (err) {
      next(err);
    }
  });

  router.post('/haproxy/servers/:backend/:server/state', async (req, res, next) => {
    const { backend, server } = req.params;
    const desiredState = req.body?.state;
    const actor = req.user?.id ?? null;
    if (!VALID_SERVER_STATES.includes(desiredState)) {
      res.status(400).json({
        error: `state must be one of: ${VALID_SERVER_STATES.join(', ')}`,
      });
      return;
    }
    logger.info('POST /haproxy/servers/:backend/:server/state', {
      ip: req.ip,
      actor,
      backend,
      server,
      desiredState,
    });
    try {
      const output = await haproxyStats.setServerState(
        config.paths.haproxyStatsSocket,
        backend,
        server,
        desiredState
      );
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-server-state',
        target: `${backend}/${server}`,
        outcome: 'ok',
        details: { state: desiredState, output: output.trim().slice(0, 200) },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-server-state',
        target: `${backend}/${server}`,
        outcome: 'error',
        details: { state: desiredState, error: err.message },
      });
      next(err);
    }
  });

  router.post('/haproxy/servers/:backend/:server/weight', async (req, res, next) => {
    const { backend, server } = req.params;
    const weight = Number(req.body?.weight);
    const actor = req.user?.id ?? null;
    if (!Number.isInteger(weight) || weight < 0 || weight > 256) {
      res.status(400).json({ error: 'weight must be an integer between 0 and 256' });
      return;
    }
    logger.info('POST /haproxy/servers/:backend/:server/weight', {
      ip: req.ip,
      actor,
      backend,
      server,
      weight,
    });
    try {
      const output = await haproxyStats.setServerWeight(
        config.paths.haproxyStatsSocket,
        backend,
        server,
        weight
      );
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-server-weight',
        target: `${backend}/${server}`,
        outcome: 'ok',
        details: { weight, output: output.trim().slice(0, 200) },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-server-weight',
        target: `${backend}/${server}`,
        outcome: 'error',
        details: { weight, error: err.message },
      });
      next(err);
    }
  });

  return router;
};
