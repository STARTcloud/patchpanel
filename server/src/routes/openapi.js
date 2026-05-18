import { Router } from 'express';

import { specs } from '../config/swagger.js';
import { log } from '../lib/logger.js';

// Serves the OpenAPI 3.1 spec built by swagger-jsdoc from JSDoc annotations
// across the route files. The /api/docs HTML viewer is gone — the React app
// owns the interactive surface at /api-docs (web/src/pages/ApiDocsPage.jsx).

export const openapiRouter = () => {
  const router = Router();

  router.get('/openapi.json', (req, res) => {
    log.api.debug('GET /openapi.json', { ip: req.ip });
    res.set('cache-control', 'no-store').json(specs);
  });

  return router;
};
