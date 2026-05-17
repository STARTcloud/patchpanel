import { Router } from 'express';

import * as logger from '../lib/logger.js';
import { enumerateInterfaces } from '../lib/system-interfaces.js';

// Surface things the OS knows but state doesn't — primarily the network
// interface list that the BindAddressPicker reads from. Read-only; no
// state mutation.

export const systemRouter = () => {
  const router = Router();

  router.get('/system/interfaces', (req, res, next) => {
    const showFiltered = req.query.showFiltered === '1' || req.query.showFiltered === 'true';
    logger.debug('GET /system/interfaces', { ip: req.ip, showFiltered });
    try {
      const result = enumerateInterfaces({ showFiltered });
      res.set('cache-control', 'no-store').json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
