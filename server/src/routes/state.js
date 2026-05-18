import { Router } from 'express';

import { applyState } from '../lib/apply-state.js';
import { ValidationError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { loadState } from '../lib/state.js';
import { StateSchema, emptyState } from '../lib/state-schema.js';

export const stateRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/state:
   *   get:
   *     summary: Read the canonical state document
   *     description: Returns the full state.json the renderer consumes. If the on-disk state is missing, an empty-state shell is returned (lets the SPA seed defaults). No-cache.
   *     tags: [State]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Current state document
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/StateDoc' }
   *       401: { description: 'Not authenticated', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/state', async (req, res) => {
    log.api.debug('GET /state', { ip: req.ip });
    const current = (await loadState(config.paths.state)) ?? emptyState();
    res.json(current);
  });

  /**
   * @swagger
   * /api/state:
   *   put:
   *     summary: Replace the state document
   *     description: |
   *       Full-document replacement. The body is Zod-validated, then the apply pipeline runs:
   *       render `haproxy.cfg` → `haproxy -c` validation → atomic swap → master-socket reload → rollback on reload failure → snapshot + audit entry on success. On `haproxy -c` failure the request returns 502 with parsed hints and NO state change.
   *     tags: [State]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/StateDoc' }
   *     responses:
   *       200:
   *         description: State applied, HAProxy reloaded, snapshot written
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/StateDoc' }
   *       401: { description: 'Not authenticated', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       422:
   *         description: State failed Zod schema validation
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/Error'
   *                 - type: object
   *                   properties:
   *                     issues:
   *                       type: array
   *                       description: Zod issue list
   *                       items: { type: object }
   *       502:
   *         description: '`haproxy -c` rejected the rendered cfg; rolled back'
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/Error'
   *                 - type: object
   *                   properties:
   *                     output: { type: string, description: 'HAProxy stderr' }
   *                     hints:
   *                       type: array
   *                       items: { type: object }
   */
  router.put('/state', async (req, res) => {
    const parsed = StateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('state.schema.invalid', { issues: parsed.error.issues });
    }
    log.api.info('PUT /state', { ip: req.ip, actor: req.user?.id ?? null });
    const next = await applyState(config, parsed.data, { editor: req.user?.id ?? null });
    res.json(next);
  });

  return router;
};
