import { join as joinPath } from 'node:path';

import { Router } from 'express';

import { fileExists, readText } from '../lib/files.js';
import * as logger from '../lib/logger.js';
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

  router.get('/error-pages', async (req, res, next) => {
    logger.debug('GET /error-pages', { ip: req.ip });
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

  router.get('/error-pages/:code', async (req, res, next) => {
    const { code } = req.params;
    if (!isValidCode(code)) {
      res.status(400).json({ error: `unsupported status code: ${code}` });
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
