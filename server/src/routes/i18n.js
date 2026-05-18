import { Router } from 'express';

import { getDefaultLocale, getSupportedLocales } from '../lib/i18n.js';
import { log } from '../lib/logger.js';

// Exposes the locales the server discovered on disk so the SPA can offer
// only the languages it can actually serve translations for. The frontend
// boot path calls this once on init to decide its `supportedLngs` list.

export const i18nRouter = () => {
  const router = Router();

  /**
   * @swagger
   * /api/i18n/languages:
   *   get:
   *     summary: List languages the server has translations for
   *     description: |
   *       Returns the locales discovered under `server/src/lib/locales/`.
   *       The frontend uses this to populate its language switcher and
   *       seed i18next's `supportedLngs`. No auth required — the same list
   *       is needed before sign-in (login page, error pages).
   *     tags: [i18n]
   *     security: []
   *     responses:
   *       200:
   *         description: Supported locales
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               required: [languages, defaultLanguage]
   *               properties:
   *                 languages:
   *                   type: array
   *                   items: { type: string }
   *                   example: ['en']
   *                 defaultLanguage:
   *                   type: string
   *                   example: 'en'
   */
  router.get('/i18n/languages', (req, res) => {
    log.api.debug('GET /api/i18n/languages', { ip: req.ip });
    res.set('cache-control', 'no-store');
    res.json({
      languages: getSupportedLocales(),
      defaultLanguage: getDefaultLocale(),
    });
  });

  return router;
};
