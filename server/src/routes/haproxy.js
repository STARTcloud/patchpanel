import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as haproxyControl from '../lib/haproxy-control.js';
import { errorResponse } from '../lib/api-response.js';
import { fileExists, readText } from '../lib/files.js';
import * as haproxyMaster from '../lib/haproxy-master.js';
import { fetchSslCapabilities } from '../lib/haproxy-ssl-capabilities.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import { log } from '../lib/logger.js';
import { renderHaproxyConfig } from '../lib/render.js';
import { loadState } from '../lib/state.js';

const VALID_SERVER_STATES = Object.freeze(['ready', 'drain', 'maint']);

export const haproxyRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/haproxy/cfg:
   *   get:
   *     summary: Read the rendered haproxy.cfg
   *     description: Returns the on-disk `haproxy.cfg` by default (`?source=disk`), or renders fresh from state (`?source=state`) without writing anywhere. The state-rendered variant lets the UI preview a candidate config before applying. Output is `text/plain`.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: source
   *         schema: { type: string, enum: [disk, state], default: disk }
   *     responses:
   *       200:
   *         description: HAProxy config text
   *         content:
   *           text/plain:
   *             schema: { type: string }
   *       404: { description: 'cfg file not present on disk', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'state not initialized (source=state only)', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/haproxy/cfg', async (req, res, next) => {
    const source = req.query.source === 'state' ? 'state' : 'disk';
    log.api.debug('GET /haproxy/cfg', { ip: req.ip, source });
    try {
      if (source === 'state') {
        const state = await loadState(config.paths.state);
        if (!state) {
          res.status(409).json(errorResponse(req, 'haproxy.cfg.stateNotInitialized'));
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
        res
          .status(404)
          .json(errorResponse(req, 'haproxy.cfg.notFound', { path: config.paths.haproxyConfig }));
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

  /**
   * @swagger
   * /api/haproxy/reload:
   *   post:
   *     summary: Reload HAProxy via master CLI socket
   *     description: Zero-downtime reload using HAProxy's master socket. Does NOT re-render the cfg from state — applies whatever is currently on disk.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Reload succeeded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 output: { type: string, description: 'Master socket stdout' }
   *       502: { description: 'Master socket reload failed', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/haproxy/reload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /haproxy/reload', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/haproxy/control-strategy:
   *   get:
   *     summary: Detect HAProxy supervisor strategy
   *     description: Reports how patchpanel will start/stop HAProxy on this host. `s6` (HA addon), `systemctl` (Debian), or `direct` (PID-file only — start unavailable).
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Strategy report
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 strategy: { type: string, enum: [s6, systemctl, direct] }
   *                 pidPath: { type: string }
   */
  router.get('/haproxy/control-strategy', async (req, res, next) => {
    log.api.debug('GET /haproxy/control-strategy', { ip: req.ip });
    try {
      const strategy = await haproxyControl.getStrategy();
      res.set('cache-control', 'no-store').json({ strategy, pidPath: config.paths.haproxyPidFile });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/haproxy/stop:
   *   post:
   *     summary: Stop the HAProxy process
   *     description: Stops HAProxy via the detected control strategy. Drops every proxied connection — requires explicit `{"confirm": true}` body acknowledgement.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [confirm]
   *             properties:
   *               confirm: { type: boolean, enum: [true] }
   *     responses:
   *       200:
   *         description: HAProxy stopped
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 stdout: { type: string }
   *                 stderr: { type: string }
   *       400: { description: 'confirm:true missing from body', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/haproxy/stop', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    if (req.body?.confirm !== true) {
      res.status(400).json(errorResponse(req, 'haproxy.stop.confirmRequired'));
      return;
    }
    log.api.info('POST /haproxy/stop', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/haproxy/start:
   *   post:
   *     summary: Start the HAProxy process
   *     description: Starts HAProxy via the detected supervisor (`s6` or `systemctl`). Returns an error when the strategy is `direct` (no supervisor).
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: HAProxy start command issued
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 stdout: { type: string }
   *                 stderr: { type: string }
   *       500: { description: 'Direct strategy cannot start, or supervisor failure', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/haproxy/start', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /haproxy/start', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/haproxy/ssl-capabilities:
   *   get:
   *     summary: Introspect HAProxy + OpenSSL capabilities
   *     description: Runs `haproxy -vv` and OpenSSL probes to surface the version, build features, available ciphers, TLSv1.3 ciphersuites, EC curves, and signature algorithms. The UI uses this to gate SSL/TLS option pickers.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Capability report
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 version: { type: string }
   *                 features: { type: array, items: { type: string } }
   *                 ciphers: { type: array, items: { type: string } }
   *                 ciphersuites: { type: array, items: { type: string } }
   *                 curves: { type: array, items: { type: string } }
   *                 sigalgs: { type: array, items: { type: string } }
   */
  router.get('/haproxy/ssl-capabilities', async (req, res, next) => {
    log.api.debug('GET /haproxy/ssl-capabilities', { ip: req.ip });
    try {
      const capabilities = await fetchSslCapabilities({
        haproxyBin: config.paths.haproxyBin,
      });
      res.set('cache-control', 'no-store').json(capabilities);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/haproxy/servers/{backend}/{server}/state:
   *   post:
   *     summary: Set server state (ready / drain / maint)
   *     description: Runtime-only mutation via the stats socket. `drain` stops new connections but keeps in-flight ones; `maint` disables the server fully; `ready` re-enables it. Does NOT touch state.json — survives a reload but not a process restart.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: backend
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: server
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [state]
   *             properties:
   *               state: { type: string, enum: [ready, drain, maint] }
   *     responses:
   *       200:
   *         description: State set
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 output: { type: string }
   *       400: { description: 'Invalid state value', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/haproxy/servers/:backend/:server/state', async (req, res, next) => {
    const { backend, server } = req.params;
    const desiredState = req.body?.state;
    const actor = req.user?.id ?? null;
    if (!VALID_SERVER_STATES.includes(desiredState)) {
      res.status(400).json(
        errorResponse(req, 'haproxy.server.invalidState', {
          allowed: VALID_SERVER_STATES.join(', '),
        })
      );
      return;
    }
    log.api.info('POST /haproxy/servers/:backend/:server/state', {
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

  /**
   * @swagger
   * /api/haproxy/servers/{backend}/{server}/weight:
   *   post:
   *     summary: Set server weight (0-256)
   *     description: Adjusts load-balance weight via the stats socket. 0 = drain-equivalent (no new sessions). 256 = max share. Runtime-only — doesn't persist to state.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: backend
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: server
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [weight]
   *             properties:
   *               weight: { type: integer, minimum: 0, maximum: 256 }
   *     responses:
   *       200:
   *         description: Weight set
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 output: { type: string }
   *       400: { description: 'Weight out of range', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/haproxy/servers/:backend/:server/weight', async (req, res, next) => {
    const { backend, server } = req.params;
    const weight = Number(req.body?.weight);
    const actor = req.user?.id ?? null;
    if (!Number.isInteger(weight) || weight < 0 || weight > 256) {
      res.status(400).json(errorResponse(req, 'haproxy.server.invalidWeight'));
      return;
    }
    log.api.info('POST /haproxy/servers/:backend/:server/weight', {
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
