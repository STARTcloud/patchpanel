import { Router } from 'express';

import { applyState } from '../lib/apply-state.js';
import * as audit from '../lib/audit.js';
import { errorResponse } from '../lib/api-response.js';
import { log } from '../lib/logger.js';
import { isValidSnapshotId, listSnapshots, readSnapshot } from '../lib/snapshots.js';

export const snapshotsRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/snapshots:
   *   get:
   *     summary: List state snapshots (newest first)
   *     description: Every successful `applyState` writes a snapshot to `paths.snapshotsDir`. This endpoint lists them with metadata only — the full state is fetched via `GET /api/snapshots/{id}`.
   *     tags: [State]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Snapshot list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshots:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id: { type: string }
   *                       snapshotAt: { type: string, format: 'date-time' }
   *                       actor: { type: string, nullable: true }
   *                       reason: { type: string, nullable: true }
   */
  router.get('/snapshots', async (req, res, next) => {
    log.api.debug('GET /snapshots', { ip: req.ip });
    try {
      const items = await listSnapshots(config.paths.snapshotsDir);
      res.set('cache-control', 'no-store').json({ snapshots: items });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/snapshots/{id}:
   *   get:
   *     summary: Read one snapshot (full state included)
   *     tags: [State]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         example: '2026-05-17T12-34-56Z-abc1234'
   *     responses:
   *       200:
   *         description: Snapshot record
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Snapshot' }
   *       400: { description: 'Malformed snapshot id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Snapshot not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/snapshots/:id', async (req, res, next) => {
    const { id } = req.params;
    if (!isValidSnapshotId(id)) {
      res.status(400).json(errorResponse(req, 'state.snapshot.invalidId', { id }));
      return;
    }
    try {
      const snap = await readSnapshot(config.paths.snapshotsDir, id);
      if (!snap) {
        res.status(404).json(errorResponse(req, 'state.snapshot.notFound', { id }));
        return;
      }
      res.set('cache-control', 'no-store').json(snap);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/snapshots/{id}/restore:
   *   post:
   *     summary: Restore state from a snapshot
   *     description: Loads the snapshot's `state` and runs it back through the full apply pipeline (render → validate → swap → reload). Same error semantics as `PUT /api/state`. Records an audit entry tagged `reason=restore:<id>`.
   *     tags: [State]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Snapshot restored and reloaded
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 restoredFrom: { type: string }
   *                 snapshotAt: { type: string, format: 'date-time' }
   *                 state: { $ref: '#/components/schemas/StateDoc' }
   *       400: { description: 'Malformed snapshot id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Snapshot not found or invalid', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       502: { description: 'Reload of snapshotted state failed; rolled back', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/snapshots/:id/restore', async (req, res, next) => {
    const { id } = req.params;
    const actor = req.user?.id ?? null;
    if (!isValidSnapshotId(id)) {
      res.status(400).json(errorResponse(req, 'state.snapshot.invalidId', { id }));
      return;
    }
    log.api.info('POST /snapshots/:id/restore', { ip: req.ip, actor, id });
    try {
      const snap = await readSnapshot(config.paths.snapshotsDir, id);
      if (!snap || !snap.state) {
        res.status(404).json(errorResponse(req, 'state.snapshot.notFoundOrInvalid', { id }));
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
