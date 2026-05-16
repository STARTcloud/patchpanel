import { Router } from 'express';

import { applyState } from '../lib/apply-state.js';
import * as audit from '../lib/audit.js';
import * as logger from '../lib/logger.js';
import { isValidSnapshotId, listSnapshots, readSnapshot } from '../lib/snapshots.js';

export const snapshotsRouter = config => {
  const router = Router();

  router.get('/snapshots', async (req, res, next) => {
    logger.debug('GET /snapshots', { ip: req.ip });
    try {
      const items = await listSnapshots(config.paths.snapshotsDir);
      res.set('cache-control', 'no-store').json({ snapshots: items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/snapshots/:id', async (req, res, next) => {
    const { id } = req.params;
    if (!isValidSnapshotId(id)) {
      res.status(400).json({ error: 'invalid snapshot id' });
      return;
    }
    try {
      const snap = await readSnapshot(config.paths.snapshotsDir, id);
      if (!snap) {
        res.status(404).json({ error: 'snapshot not found' });
        return;
      }
      res.set('cache-control', 'no-store').json(snap);
    } catch (err) {
      next(err);
    }
  });

  router.post('/snapshots/:id/restore', async (req, res, next) => {
    const { id } = req.params;
    const actor = req.user?.id ?? null;
    if (!isValidSnapshotId(id)) {
      res.status(400).json({ error: 'invalid snapshot id' });
      return;
    }
    logger.info('POST /snapshots/:id/restore', { ip: req.ip, actor, id });
    try {
      const snap = await readSnapshot(config.paths.snapshotsDir, id);
      if (!snap || !snap.state) {
        res.status(404).json({ error: 'snapshot not found or invalid' });
        return;
      }
      const persisted = await applyState(config, snap.state, {
        editor: actor,
        reason: `restore:${id}`,
      });
      audit.record({
        actor,
        category: 'snapshot',
        action: 'restore',
        target: id,
        outcome: 'ok',
        details: { snapshotAt: snap.snapshotAt },
      });
      res.json({ restoredFrom: id, snapshotAt: snap.snapshotAt, state: persisted });
    } catch (err) {
      audit.record({
        actor,
        category: 'snapshot',
        action: 'restore',
        target: id,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
