import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { errorResponse } from '../lib/api-response.js';
import { fileExists, readText } from '../lib/files.js';
import * as keepalivedControl from '../lib/keepalived-control.js';
import { loadNodeConfig } from '../lib/node-config.js';
import { log } from '../lib/logger.js';
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

  /**
   * @swagger
   * /api/keepalived/cfg:
   *   get:
   *     summary: Read the rendered keepalived.conf
   *     description: Returns the on-disk `keepalived.conf` (`?source=disk`, default) or renders fresh from state.json + node.yaml (`?source=state`) without writing to disk. Mirrors `/api/haproxy/cfg`.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: source
   *         schema: { type: string, enum: [disk, state], default: disk }
   *     responses:
   *       200:
   *         description: keepalived.conf text
   *         content:
   *           text/plain:
   *             schema: { type: string }
   *       404: { description: 'No keepalived.conf on disk', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'State not initialized (source=state only)', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/keepalived/cfg', async (req, res, next) => {
    const source = req.query.source === 'state' ? 'state' : 'disk';
    log.api.debug('GET /keepalived/cfg', { ip: req.ip, source });
    try {
      if (source === 'state') {
        const state = await loadState(config.paths.state);
        if (!state) {
          res.status(409).json(errorResponse(req, 'cluster.state.notInitialized'));
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
        res.status(404).json(
          errorResponse(req, 'cluster.keepalived.configNotFound', {
            path: config.paths.keepalivedConfig,
          })
        );
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

  /**
   * @swagger
   * /api/keepalived/control-strategy:
   *   get:
   *     summary: Detect keepalived supervisor strategy
   *     description: Mirrors `/api/haproxy/control-strategy`. Reports `s6` / `systemctl` / `direct`.
   *     tags: [Configuration]
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
  router.get('/keepalived/control-strategy', async (req, res, next) => {
    log.api.debug('GET /keepalived/control-strategy', { ip: req.ip });
    try {
      const strategy = await keepalivedControl.getStrategy();
      res
        .set('cache-control', 'no-store')
        .json({ strategy, pidPath: config.paths.keepalivedPidFile });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/keepalived/reload:
   *   post:
   *     summary: Reload keepalived (SIGHUP)
   *     description: Sends SIGHUP to the keepalived process, which re-reads keepalived.conf. VRRP state is preserved across SIGHUP.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'Reload issued', content: { application/json: { schema: { type: object } } } }
   *       500: { description: 'Reload failed', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/keepalived/reload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /keepalived/reload', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/keepalived/stop:
   *   post:
   *     summary: Stop keepalived
   *     description: Stops keepalived. VIPs currently held by this node will fail over to a peer (if a peer is in BACKUP state).
   *     tags: [Configuration]
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
   *       200: { description: 'keepalived stopped', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'confirm:true missing', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/keepalived/stop', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    if (req.body?.confirm !== true) {
      res.status(400).json(errorResponse(req, 'cluster.keepalived.stopConfirmRequired'));
      return;
    }
    log.api.info('POST /keepalived/stop', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/keepalived/start:
   *   post:
   *     summary: Start keepalived
   *     description: Starts keepalived via the detected supervisor. May claim VIPs immediately or remain in BACKUP depending on `priority` + peer state.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'keepalived started', content: { application/json: { schema: { type: object } } } }
   *       500: { description: 'Direct strategy or supervisor failure', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/keepalived/start', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /keepalived/start', { ip: req.ip, actor });
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
  /**
   * @swagger
   * /api/keepalived/state:
   *   get:
   *     summary: keepalived runtime state
   *     description: Reports PID-file liveness plus configured instances. Per-instance VRRP state (MASTER/BACKUP) is currently left `null` — that requires SIGUSR2 to `/tmp/keepalived.data` or a privileged DBus call, both of which have platform-specific failure modes. UI consumers treat `null` as "checking".
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Runtime state
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 installed: { type: boolean, description: 'Whether the keepalived binary exists at paths.keepalivedBin' }
   *                 alive: { type: boolean }
   *                 strategy: { type: string, enum: [s6, systemctl, direct] }
   *                 instances:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id: { type: string }
   *                       name: { type: string }
   *                       vip: { type: string }
   *                       state: { type: string, nullable: true, enum: [MASTER, BACKUP, FAULT, null] }
   *                       holding: { type: boolean, nullable: true }
   */
  router.get('/keepalived/state', async (req, res, next) => {
    log.api.debug('GET /keepalived/state', { ip: req.ip });
    try {
      const installed = await keepalivedControl.isInstalled({
        keepalivedBin: config.paths.keepalivedBin,
      });
      const strategy = await keepalivedControl.getStrategy();
      const aliveProbe = installed
        ? await keepalivedControl.isAlive({ pidPath: config.paths.keepalivedPidFile })
        : false;
      const alive = installed ? (aliveProbe ?? false) : false;
      const stateDoc = await loadState(config.paths.state);
      const nodeConfig = await loadNodeConfig(config.paths.nodeConfig).catch(() => null);
      const nodeId = nodeConfig?.nodeId ?? null;
      const participatingIds = new Set(Object.keys(nodeConfig?.vrrp ?? {}));
      const liveStates = alive
        ? await keepalivedControl
            .getInstanceStates({ pidPath: config.paths.keepalivedPidFile })
            .catch(() => new Map())
        : new Map();
      const instances = (stateDoc?.keepalived?.instances ?? []).map(inst => {
        const participates = participatingIds.has(inst.id);
        const liveState = participates ? (liveStates.get(inst.name) ?? null) : null;
        return {
          id: inst.id,
          name: inst.name,
          vip: inst.vip,
          state: liveState,
          holding: liveState === 'MASTER',
          participates,
        };
      });
      res.set('cache-control', 'no-store').json({ installed, alive, strategy, nodeId, instances });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
