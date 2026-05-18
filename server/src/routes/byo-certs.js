import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';

import { Router } from 'express';

import { errorResponse, localizeMessage } from '../lib/api-response.js';
import * as audit from '../lib/audit.js';
import { validateByoBundle, validateLineageName } from '../lib/byo-cert-validator.js';
import { ValidationError } from '../lib/errors.js';
import { fileExists, safePathUnder, writeAtomic } from '../lib/files.js';
import { log } from '../lib/logger.js';
import { findCertificatePemBlocks } from '../lib/pem.js';

const localizeIssues = (req, issues) =>
  (issues ?? []).map(issue => localizeMessage(req, issue.code, issue.replacements));

// v0.2.38 — BYO (bring-your-own) cert upload endpoints. The API accepts a
// `name` field (v0.2.39 renamed from `lineageName` — the word "lineage" is
// certbot-internal jargon that users don't need to know). The name is used
// as the on-disk folder name AND the cert entry's certName, so one name
// flows end-to-end.
//
//   GET  /api/byo-certs            list every uploaded cert directory
//   POST /api/byo-certs/upload     accept { name, fullchainPem, privkeyPem }
//                                  — server validates the PEM pair and writes
//                                    /data/certs/byo/<name>/{fullchain,privkey,cert}.pem
//   POST /api/byo-certs/validate   dry-run validation without writing
//   DEL  /api/byo-certs/:name      remove the cert folder entirely

const sanitizeCertPath = (byoCertsDir, name) => {
  const validationError = validateLineageName(name);
  if (validationError) {
    throw new ValidationError(validationError.code, {
      replacements: validationError.replacements,
    });
  }
  return safePathUnder(byoCertsDir, name);
};

const listCerts = async byoCertsDir => {
  if (!(await fileExists(byoCertsDir))) {
    return [];
  }
  const entries = await fs.readdir(byoCertsDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory());
  const summaries = await Promise.all(
    dirs.map(async dir => {
      const certDir = joinPath(byoCertsDir, dir.name);
      const fullchainPath = joinPath(certDir, 'fullchain.pem');
      const privkeyPath = joinPath(certDir, 'privkey.pem');
      const hasFullchain = await fileExists(fullchainPath);
      const hasPrivkey = await fileExists(privkeyPath);
      const stat = hasFullchain ? await fs.stat(fullchainPath) : null;
      return {
        name: dir.name,
        hasFullchain,
        hasPrivkey,
        complete: hasFullchain && hasPrivkey,
        uploadedAt: stat?.mtime?.toISOString() ?? null,
      };
    })
  );
  return summaries.sort((a, b) => a.name.localeCompare(b.name));
};

const writePemBundle = async (certDir, fullchainPem, privkeyPem) => {
  await fs.mkdir(certDir, { recursive: true, mode: 0o700 });
  // Route every inner path through safePathUnder rather than plain joinPath
  // — joinPath composes a new path that CodeQL doesn't recognise as
  // sanitized even when certDir itself came from safePathUnder upstream.
  const fullchainPath = safePathUnder(certDir, 'fullchain.pem');
  const privkeyPath = safePathUnder(certDir, 'privkey.pem');
  const certPath = safePathUnder(certDir, 'cert.pem');
  // Mirror certbot's on-disk layout: cert.pem (leaf only), fullchain.pem
  // (leaf+intermediates), privkey.pem. cert-lineage.js reads cert.pem +
  // privkey.pem + fullchain.pem so this layout makes BYO certs
  // indistinguishable from certbot certs downstream.
  const leafBlock = findCertificatePemBlocks(fullchainPem)[0]?.block ?? null;
  const certPemBody = leafBlock ? `${leafBlock}\n` : fullchainPem;
  await Promise.all([
    writeAtomic(fullchainPath, fullchainPem.endsWith('\n') ? fullchainPem : `${fullchainPem}\n`, {
      mode: 0o600,
    }),
    writeAtomic(privkeyPath, privkeyPem.endsWith('\n') ? privkeyPem : `${privkeyPem}\n`, {
      mode: 0o600,
    }),
    writeAtomic(certPath, certPemBody, { mode: 0o600 }),
  ]);
};

export const byoCertsRouter = config => {
  const router = Router();
  const dir = () => config.paths.byoCertsDir;

  /**
   * @swagger
   * /api/byo-certs:
   *   get:
   *     summary: List uploaded BYO certificate directories
   *     description: Returns every folder under `paths.byoCertsDir` along with completeness flags (has fullchain + privkey).
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: BYO cert summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 byoCertsDir: { type: string }
   *                 certs:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       name: { type: string }
   *                       hasFullchain: { type: boolean }
   *                       hasPrivkey: { type: boolean }
   *                       complete: { type: boolean }
   *                       uploadedAt: { type: string, format: 'date-time', nullable: true }
   */
  router.get('/byo-certs', async (req, res, next) => {
    log.api.debug('GET /byo-certs', { ip: req.ip });
    try {
      const certs = await listCerts(dir());
      res.json({ certs, byoCertsDir: dir() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/byo-certs/validate:
   *   post:
   *     summary: Dry-run validation of a fullchain + privkey pair
   *     description: Parses the PEM blocks, verifies the privkey matches the leaf cert, returns SANs / notBefore / notAfter. Does not touch disk.
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
   *             required: [fullchainPem, privkeyPem]
   *             properties:
   *               fullchainPem: { type: string, description: 'PEM-encoded leaf + intermediates' }
   *               privkeyPem: { type: string, description: 'PEM-encoded private key (unencrypted)' }
   *     responses:
   *       200:
   *         description: Validation result (`ok: false` does NOT mean a 4xx — inspect the body)
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
   *                     sans: { type: array, items: { type: string } }
   *                     notBefore: { type: string, format: 'date-time' }
   *                     notAfter: { type: string, format: 'date-time' }
   */
  router.post('/byo-certs/validate', (req, res) => {
    const { fullchainPem, privkeyPem } = req.body ?? {};
    const result = validateByoBundle({ fullchainPem, privkeyPem });
    res.json({ ...result, errors: localizeIssues(req, result.errors) });
  });

  /**
   * @swagger
   * /api/byo-certs/upload:
   *   post:
   *     summary: Upload a BYO certificate bundle
   *     description: Validates the fullchain + privkey pair, writes them to `paths.byoCertsDir/<name>/{fullchain,privkey,cert}.pem` with mode 0600. The `name` is used as both the on-disk folder and the cert's `certName` in state. The state entry must be persisted separately via `PUT /api/state` after upload.
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
   *             required: [name, fullchainPem, privkeyPem]
   *             properties:
   *               name: { type: string, example: 'home-mydomain-net' }
   *               fullchainPem: { type: string }
   *               privkeyPem: { type: string }
   *     responses:
   *       200:
   *         description: PEMs written
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 name: { type: string }
   *                 info:
   *                   type: object
   *                   properties:
   *                     sans: { type: array, items: { type: string } }
   *                     notAfter: { type: string, format: 'date-time' }
   *       400:
   *         description: Bad name OR validation failed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: false }
   *                 error: { type: string }
   *                 errors: { type: array, items: { type: string } }
   *                 info: { type: object }
   */
  router.post('/byo-certs/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name, fullchainPem, privkeyPem } = req.body ?? {};
    let certDir;
    try {
      certDir = sanitizeCertPath(dir(), name);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, ...errorResponse(req, err.code, err.replacements) });
        return;
      }
      next(err);
      return;
    }
    const validation = validateByoBundle({ fullchainPem, privkeyPem });
    if (!validation.ok) {
      res.status(400).json({
        ok: false,
        errors: localizeIssues(req, validation.errors),
        info: validation.info,
      });
      return;
    }
    try {
      await writePemBundle(certDir, fullchainPem, privkeyPem);
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-upload',
        target: name,
        outcome: 'ok',
        details: { sans: validation.info.sans, notAfter: validation.info.notAfter },
      });
      log.api.info('BYO cert uploaded', { name, sans: validation.info.sans });
      res.json({ ok: true, info: validation.info, name });
    } catch (err) {
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-upload',
        target: name,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  // Stream a single PEM file from the cert dir back to the client. Used by
  // the cert-edit modal's "Download" buttons so users can grab a backup of
  // their existing fullchain + privkey before replacing. The privkey route
  // emits an audit record because the bytes are sensitive material; the
  // fullchain route doesn't (cert is public).
  const streamPemFile = async (req, res, next, basename, sensitive) => {
    const actor = req.user?.id ?? null;
    const { name } = req.params;
    let certDir;
    try {
      certDir = sanitizeCertPath(dir(), name);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, ...errorResponse(req, err.code, err.replacements) });
        return;
      }
      next(err);
      return;
    }
    // safePathUnder rather than joinPath — basename is a constant function
    // arg so it can't escape, but CodeQL's path-injection query treats
    // joinPath(sanitized, x) as still-tainted and needs the explicit barrier
    // on the composite path.
    const filePath = safePathUnder(certDir, basename);
    if (!(await fileExists(filePath))) {
      res
        .status(404)
        .json({ ok: false, ...errorResponse(req, 'cert.byo.fileNotFound', { basename, name }) });
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      res.set('content-type', 'application/x-pem-file');
      res.set('content-disposition', `attachment; filename="${name}-${basename}"`);
      res.set('cache-control', 'no-store');
      res.send(body);
      if (sensitive) {
        audit.record({
          actor,
          category: 'cert',
          action: 'byo-download',
          target: `${name}/${basename}`,
          outcome: 'ok',
        });
        log.api.info('BYO privkey downloaded', { name, ip: req.ip });
      }
    } catch (err) {
      next(err);
    }
  };

  /**
   * @swagger
   * /api/byo-certs/{name}/fullchain.pem:
   *   get:
   *     summary: Download the fullchain PEM
   *     description: Returns the BYO cert's `fullchain.pem` (leaf + intermediates) as an attachment. Public bytes — no audit entry recorded.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: PEM bytes
   *         content:
   *           application/x-pem-file:
   *             schema: { type: string, format: binary }
   *       400: { description: 'Bad name', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'File not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/byo-certs/:name/fullchain.pem', (req, res, next) =>
    streamPemFile(req, res, next, 'fullchain.pem', false)
  );

  /**
   * @swagger
   * /api/byo-certs/{name}/privkey.pem:
   *   get:
   *     summary: Download the private key PEM (sensitive)
   *     description: Returns the BYO cert's `privkey.pem`. Each download is audit-logged with the actor + IP since the bytes are sensitive material.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Private key PEM bytes
   *         content:
   *           application/x-pem-file:
   *             schema: { type: string, format: binary }
   *       400: { description: 'Bad name', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'File not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/byo-certs/:name/privkey.pem', (req, res, next) =>
    streamPemFile(req, res, next, 'privkey.pem', true)
  );

  /**
   * @swagger
   * /api/byo-certs/{name}:
   *   delete:
   *     summary: Delete a BYO cert directory
   *     description: Recursively removes the cert folder. The corresponding state entry should be removed via `PUT /api/state` afterwards.
   *     tags: [Certificates]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Removed', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Bad name', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/byo-certs/:name', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name } = req.params;
    let certDir;
    try {
      certDir = sanitizeCertPath(dir(), name);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, ...errorResponse(req, err.code, err.replacements) });
        return;
      }
      next(err);
      return;
    }
    try {
      await fs.rm(certDir, { recursive: true, force: true });
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-delete',
        target: name,
        outcome: 'ok',
      });
      log.api.info('BYO cert deleted', { name });
      res.json({ ok: true });
    } catch (err) {
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-delete',
        target: name,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
