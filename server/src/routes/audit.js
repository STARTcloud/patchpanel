import { Router } from 'express';

import { recent } from '../lib/audit.js';

export const auditRouter = () => {
  const router = Router();
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
