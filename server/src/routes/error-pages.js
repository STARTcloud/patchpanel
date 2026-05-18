import { join as joinPath } from 'node:path';

import { Router } from 'express';

import { errorResponse } from '../lib/api-response.js';
import { fileExists, readText } from '../lib/files.js';
import { log } from '../lib/logger.js';
import { ERROR_FILE_CODES } from '../lib/state-schema.js';

const VALID_CODES = ERROR_FILE_CODES;
const DEFAULT_TEMPLATES_DIR = '/etc/haproxy/errors/tpl';

const isValidCode = code => VALID_CODES.includes(code);

const readDefaultTemplate = async code => {
  const path = joinPath(DEFAULT_TEMPLATES_DIR, `${code}.http`);
  if (!(await fileExists(path))) {
    return null;
  }
  return readText(path);
};

// Per-status content overrides are now scoped to each DefaultsBlock
// (state.defaultsBlocks[].errorPageContents). This endpoint returns the
// bundled template bodies only; client code edits per-block overrides
// directly through the state document.
export const errorPagesRouter = () => {
  const router = Router();

  /**
   * @swagger
   * /api/error-pages:
   *   get:
   *     summary: List bundled error-page templates
   *     description: Returns the shipped HAProxy error templates (one per supported HTTP status code) so the UI can show them as a base for per-DefaultsBlock overrides. Per-block overrides live in `state.defaultsBlocks[].errorPageContents` and are edited via `PUT /api/state`.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Bundled templates
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 pages:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       code: { type: string, example: '503' }
   *                       template: { type: string, description: 'Raw HTTP response template' }
   */
  router.get('/error-pages', async (req, res, next) => {
    log.api.debug('GET /error-pages', { ip: req.ip });
    try {
      const pages = await Promise.all(
        VALID_CODES.map(async code => ({
          code,
          template: (await readDefaultTemplate(code)) ?? '',
        }))
      );
      res.set('cache-control', 'no-store').json({ pages });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/error-pages/{code}:
   *   get:
   *     summary: Read one bundled error template
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: code
   *         required: true
   *         schema: { type: string }
   *         description: HTTP status code (e.g. `400`, `503`)
   *     responses:
   *       200:
   *         description: Template
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 code: { type: string }
   *                 template: { type: string }
   *       400: { description: 'Unsupported status code', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/error-pages/:code', async (req, res, next) => {
    const { code } = req.params;
    if (!isValidCode(code)) {
      res.status(400).json(errorResponse(req, 'config.errorPages.unsupportedCode', { code }));
      return;
    }
    try {
      const template = (await readDefaultTemplate(code)) ?? '';
      res.set('cache-control', 'no-store').json({ code, template });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

export { VALID_CODES };
