import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as keepalivedControl from '../lib/keepalived-control.js';
import { loadNodeConfig, NodeConfigSchema, saveNodeConfig } from '../lib/node-config.js';
import { log } from '../lib/logger.js';

// Per-node identity (node.yaml). Never syncs between cluster peers.
// Write-trigger: re-render keepalived.conf is the apply-state pipeline's
// job, NOT this route's — node.yaml changes also need a state.json save
// to actually take effect. To keep the flow simple, this route just
// persists node.yaml + fires a keepalived reload IF keepalived is alive.
// A subsequent state save (or manual reload) re-renders the cfg from the
// updated node.yaml.

export const nodeConfigRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/node-config:
   *   get:
   *     summary: Read per-node identity (node.yaml)
   *     description: Returns `node.yaml` — the per-node fields that NEVER sync between cluster peers (nodeId, VRRP priority overrides, per-instance state hints).
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Node config
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 nodeId: { type: string }
   *                 vrrp: { type: object, additionalProperties: { type: object } }
   */
  router.get('/node-config', async (req, res, next) => {
    log.api.debug('GET /node-config', { ip: req.ip });
    try {
      const cfg = await loadNodeConfig(config.paths.nodeConfig);
      res.set('cache-control', 'no-store').json(cfg);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/node-config:
   *   put:
   *     summary: Write per-node identity (node.yaml)
   *     description: Persists `node.yaml` and fires a non-fatal keepalived reload. To make changes take effect in haproxy.cfg / keepalived.conf, the next state-apply (or manual reload) will re-render against the updated node config.
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
   *             description: NodeConfig (validated by NodeConfigSchema)
   *     responses:
   *       200:
   *         description: Node config saved
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 nodeConfig: { type: object }
   *       400:
   *         description: Failed NodeConfigSchema validation
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: false }
   *                 errors: { type: array, items: { type: object } }
   */
  router.put('/node-config', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('PUT /node-config', { ip: req.ip, actor });
    const parsed = NodeConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: parsed.error.issues });
      return;
    }
    try {
      const saved = await saveNodeConfig(config.paths.nodeConfig, parsed.data);
      audit.record({
        actor,
        category: 'cluster',
        action: 'node-config-write',
        outcome: 'ok',
        details: { nodeId: saved.nodeId, vrrpInstances: Object.keys(saved.vrrp ?? {}) },
      });
      // Fire-and-forget reload — failures are non-fatal because keepalived
      // may not be running yet on a freshly-installed node.
      keepalivedControl.reload({ pidPath: config.paths.keepalivedPidFile }).catch(err =>
        log.api.warn('keepalived reload after node-config write failed (non-fatal)', {
          error: err.message,
        })
      );
      res.json({ ok: true, nodeConfig: saved });
    } catch (err) {
      audit.record({
        actor,
        category: 'cluster',
        action: 'node-config-write',
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
