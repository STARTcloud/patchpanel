import { Router } from 'express';

import { recent } from '../lib/audit.js';

export const auditRouter = () => {
  const router = Router();
  /**
   * @swagger
   * /api/audit:
   *   get:
   *     summary: Recent audit log entries
   *     description: Returns the most recent audit entries (newest first). Audit entries record every state change, auth event, and runtime mutation with the acting user/token + outcome + details. Defaults to 100 entries, max 1000.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 1000, default: 100 }
   *       - in: query
   *         name: category
   *         schema: { type: string }
   *         description: Filter by audit category (e.g. `state`, `cert`, `haproxy`, `auth`)
   *       - in: query
   *         name: actor
   *         schema: { type: string }
   *         description: Filter by actor id (user id or token keyId)
   *     responses:
   *       200:
   *         description: Audit entries
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 entries:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       ts: { type: string, format: 'date-time' }
   *                       actor: { type: string, nullable: true }
   *                       category: { type: string }
   *                       action: { type: string }
   *                       target: { type: string, nullable: true }
   *                       outcome: { type: string, enum: [ok, error, fail] }
   *                       details: { type: object }
   */
  router.get('/audit', (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 1000);
    const filter = {};
    if (typeof req.query.category === 'string') {
      filter.category = req.query.category;
    }
    if (typeof req.query.actor === 'string') {
      filter.actor = req.query.actor;
    }
    res.json({ entries: recent(limit, filter) });
  });
  return router;
};
