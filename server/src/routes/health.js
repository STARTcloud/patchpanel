import { Router } from 'express';

import * as logger from '../lib/logger.js';

export const healthRouter = () => {
  const router = Router();
  router.get('/health', (req, res) => {
    logger.debug('GET /health', { ip: req.ip });
    res.set('cache-control', 'no-store');
    res.json({ status: 'ok', service: 'patchpanel' });
  });
  return router;
};
