import { Router } from 'express';

import { log } from '../lib/logger.js';

// Frontend log categories the React app's Logger.js knows about. Returned
// inside the /health response so an operator can flip per-category levels
// at runtime via the patchpanel config — no rebuild needed. Mirrors
// BoxVault's `frontend_logging` pattern (camelCase here because the rest
// of patchpanel's API is camelCase).
const FRONTEND_LOG_CATEGORIES = Object.freeze([
  'app',
  'auth',
  'api',
  'state',
  'haproxy',
  'cert',
  'peer',
  'error',
]);

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'silent']);

const buildFrontendLoggingConfig = config => {
  const fl = config?.frontendLogging ?? {};
  const enabled = typeof fl.enabled === 'boolean' ? fl.enabled : true;
  const rawLevel = typeof fl.level === 'string' ? fl.level : null;
  const level = rawLevel && VALID_LEVELS.has(rawLevel) ? rawLevel : 'info';
  const overrides = fl.categories && typeof fl.categories === 'object' ? fl.categories : {};
  const categories = {};
  for (const name of FRONTEND_LOG_CATEGORIES) {
    const raw = overrides[name];
    categories[name] = raw && VALID_LEVELS.has(raw) ? raw : level;
  }
  return { enabled, level, categories };
};

export const healthRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Liveness probe + frontend logger config
   *     description: |
   *       Returns 200 while the patchpanel server is running. Used by the HA addon manifest's `watchdog` field and by external orchestrators. Also returns the `frontendLogging` block the React UI's Logger reads on first call — operators can flip per-category log levels by editing `frontendLogging.*` in the patchpanel config without rebuilding the frontend.
   *     tags: [Health]
   *     security: []
   *     responses:
   *       200:
   *         description: Server up; frontend logger config returned
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               required: [status, service, frontendLogging]
   *               properties:
   *                 status: { type: string, enum: [ok], example: ok }
   *                 service: { type: string, example: patchpanel }
   *                 frontendLogging:
   *                   type: object
   *                   required: [enabled, level, categories]
   *                   properties:
   *                     enabled: { type: boolean }
   *                     level:
   *                       type: string
   *                       enum: [trace, debug, info, warn, error, silent]
   *                     categories:
   *                       type: object
   *                       additionalProperties:
   *                         type: string
   *                         enum: [trace, debug, info, warn, error, silent]
   *                       example:
   *                         app: info
   *                         auth: info
   *                         api: info
   *                         state: info
   *                         haproxy: info
   *                         cert: info
   *                         peer: info
   *                         error: info
   */
  router.get('/health', (req, res) => {
    log.api.debug('GET /health', { ip: req.ip });
    res.set('cache-control', 'no-store');
    res.json({
      status: 'ok',
      service: 'patchpanel',
      frontendLogging: buildFrontendLoggingConfig(config),
    });
  });
  return router;
};
