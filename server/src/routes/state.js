import { Router } from 'express';

import { applyState } from '../lib/apply-state.js';
import { ValidationError } from '../lib/errors.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';
import { StateSchema, emptyState } from '../lib/state-schema.js';

export const stateRouter = config => {
  const router = Router();

  router.get('/state', async (req, res) => {
    logger.debug('GET /state', { ip: req.ip });
    const current = (await loadState(config.paths.state)) ?? emptyState();
    res.json(current);
  });

  router.put('/state', async (req, res) => {
    const parsed = StateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('state failed schema validation', parsed.error.issues);
    }
    logger.info('PUT /state', { ip: req.ip, actor: req.user?.id ?? null });
    const next = await applyState(config, parsed.data, { editor: req.user?.id ?? null });
    res.json(next);
  });

  return router;
};
