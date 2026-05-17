import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as keepalivedControl from '../lib/keepalived-control.js';
import { loadNodeConfig, NodeConfigSchema, saveNodeConfig } from '../lib/node-config.js';
import * as logger from '../lib/logger.js';

// Per-node identity (node.yaml). Never syncs between cluster peers.
// Write-trigger: re-render keepalived.conf is the apply-state pipeline's
// job, NOT this route's — node.yaml changes also need a state.json save
// to actually take effect. To keep the flow simple, this route just
// persists node.yaml + fires a keepalived reload IF keepalived is alive.
// A subsequent state save (or manual reload) re-renders the cfg from the
// updated node.yaml.

export const nodeConfigRouter = config => {
  const router = Router();

  router.get('/node-config', async (req, res, next) => {
    logger.debug('GET /node-config', { ip: req.ip });
    try {
      const cfg = await loadNodeConfig(config.paths.nodeConfig);
      res.set('cache-control', 'no-store').json(cfg);
    } catch (err) {
      next(err);
    }
  });

  router.put('/node-config', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('PUT /node-config', { ip: req.ip, actor });
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
        logger.warning('keepalived reload after node-config write failed (non-fatal)', {
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
