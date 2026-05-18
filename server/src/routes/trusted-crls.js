import { promises as fs } from 'node:fs';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { log } from '../lib/logger.js';
import {
  listTrustedCrlFiles,
  readTrustedCrl,
  removeTrustedCrl,
  trustedCrlFileExists,
  trustedCrlPath,
  validateTrustedCrlId,
  validateTrustedCrlPem,
  writeTrustedCrl,
} from '../lib/trusted-crls.js';

// Trusted CRL endpoints mirror trusted-cas:
//   GET    /trusted-crls              list the PEM files on disk
//   POST   /trusted-crls/validate     dry-run validation, no disk write
//   POST   /trusted-crls/upload       { id, pem } — validates + writes
//                                     <trustedCrlsDir>/<id>.pem
//   DELETE /trusted-crls/:id          removes the on-disk PEM
//
// State persistence (the TrustedCRL entry in state.trustedCrls[]) flows
// through the standard apply-state pipeline — the UI augments state with
// the parsed info from the upload response and calls PUT /api/state.

const listFiles = async dir => {
  const ids = await listTrustedCrlFiles(dir);
  const summaries = await Promise.all(
    ids.map(async id => {
      const filePath = trustedCrlPath(dir, id);
      const stat = await fs.stat(filePath).catch(() => null);
      return {
        id,
        uploadedAt: stat?.mtime?.toISOString() ?? null,
        sizeBytes: stat?.size ?? null,
      };
    })
  );
  return summaries.sort((a, b) => a.id.localeCompare(b.id));
};

export const trustedCrlsRouter = config => {
  const router = Router();
  const dir = () => config.paths.trustedCrlsDir;

  /**
   * @swagger
   * /api/trusted-crls:
   *   get:
   *     summary: List uploaded CRL files
   *     description: Returns one entry per `<id>.pem` file under `paths.trustedCrlsDir`. CRLs are used by mTLS-validating frontends to reject revoked client certs.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: CRL file list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 trustedCrlsDir: { type: string }
   *                 files:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id: { type: string }
   *                       uploadedAt: { type: string, format: 'date-time', nullable: true }
   *                       sizeBytes: { type: integer, nullable: true }
   */
  router.get('/trusted-crls', async (req, res, next) => {
    log.api.debug('GET /trusted-crls', { ip: req.ip });
    try {
      const files = await listFiles(dir());
      res.set('cache-control', 'no-store').json({ files, trustedCrlsDir: dir() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/trusted-crls/{id}:
   *   get:
   *     summary: Read a CRL PEM
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: CRL PEM
   *         content:
   *           application/x-pem-file:
   *             schema: { type: string, format: binary }
   *       400: { description: 'Bad id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/trusted-crls/:id', async (req, res, next) => {
    const { id } = req.params;
    log.api.debug('GET /trusted-crls/:id', { ip: req.ip, id });
    const idError = validateTrustedCrlId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    try {
      if (!(await trustedCrlFileExists(dir(), id))) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      const pem = await readTrustedCrl(dir(), id);
      res
        .set('content-type', 'application/x-pem-file; charset=utf-8')
        .set('cache-control', 'no-store')
        .send(pem);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/trusted-crls/validate:
   *   post:
   *     summary: Dry-run validation of a CRL PEM
   *     description: Parses every X509 CRL block and computes a fingerprint. No disk write.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [pem]
   *             properties:
   *               pem: { type: string }
   *     responses:
   *       200:
   *         description: Validation result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean }
   *                 errors: { type: array, items: { type: string } }
   *                 info:
   *                   type: object
   *                   properties:
   *                     fingerprint: { type: string }
   */
  router.post('/trusted-crls/validate', (req, res) => {
    const { pem } = req.body ?? {};
    const result = validateTrustedCrlPem({ pem });
    res.json(result);
  });

  /**
   * @swagger
   * /api/trusted-crls/upload:
   *   post:
   *     summary: Upload a CRL
   *     description: Validates the PEM and writes it to `paths.trustedCrlsDir/<id>.pem`. The `state.trustedCrls[]` entry must be persisted separately via `PUT /api/state`.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [id, pem]
   *             properties:
   *               id: { type: string }
   *               pem: { type: string }
   *     responses:
   *       200:
   *         description: CRL written
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 id: { type: string }
   *                 path: { type: string }
   *                 info: { type: object }
   *       400: { description: 'Bad id OR validation failed', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/trusted-crls/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { id, pem } = req.body ?? {};
    const idError = validateTrustedCrlId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    const validation = validateTrustedCrlPem({ pem });
    if (!validation.ok) {
      res.status(400).json({ ok: false, errors: validation.errors });
      return;
    }
    try {
      const filePath = await writeTrustedCrl(dir(), id, pem);
      audit.record({
        actor,
        category: 'trusted-crl',
        action: 'upload',
        target: id,
        outcome: 'ok',
        details: { fingerprint: validation.info.fingerprint },
      });
      log.api.info('trusted CRL uploaded', { id, fingerprint: validation.info.fingerprint });
      res.json({ ok: true, id, path: filePath, info: validation.info });
    } catch (err) {
      audit.record({
        actor,
        category: 'trusted-crl',
        action: 'upload',
        target: id,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  /**
   * @swagger
   * /api/trusted-crls/{id}:
   *   delete:
   *     summary: Remove a CRL
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Removed', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Bad id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/trusted-crls/:id', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { id } = req.params;
    const idError = validateTrustedCrlId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    try {
      await removeTrustedCrl(dir(), id);
      audit.record({
        actor,
        category: 'trusted-crl',
        action: 'delete',
        target: id,
        outcome: 'ok',
      });
      log.api.info('trusted CRL deleted', { id });
      res.json({ ok: true });
    } catch (err) {
      audit.record({
        actor,
        category: 'trusted-crl',
        action: 'delete',
        target: id,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
