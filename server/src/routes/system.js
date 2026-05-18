import { Router } from 'express';

import { log } from '../lib/logger.js';
import { enumerateInterfaces } from '../lib/system-interfaces.js';

// Surface things the OS knows but state doesn't — primarily the network
// interface list that the BindAddressPicker reads from. Read-only; no
// state mutation.

export const systemRouter = () => {
  const router = Router();

  /**
   * @swagger
   * /api/system/interfaces:
   *   get:
   *     summary: Enumerate network interfaces visible to the OS
   *     description: Read-only surface used by the BindAddressPicker. Pass `?showFiltered=1` to include loopback / docker / virtual interfaces that are normally hidden.
   *     tags: [System]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: showFiltered
   *         schema: { type: string, enum: ['0', '1', 'true', 'false'], default: '0' }
   *     responses:
   *       200:
   *         description: Interface list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 interfaces:
   *                   type: array
   *                   items: { type: object }
   *                 version: { type: integer, description: 'Bumps when the kernel reports a change' }
   */
  router.get('/system/interfaces', (req, res, next) => {
    const showFiltered = req.query.showFiltered === '1' || req.query.showFiltered === 'true';
    log.api.debug('GET /system/interfaces', { ip: req.ip, showFiltered });
    try {
      const result = enumerateInterfaces({ showFiltered });
      res.set('cache-control', 'no-store').json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
