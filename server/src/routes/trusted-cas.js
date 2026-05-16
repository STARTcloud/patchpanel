import { promises as fs } from 'node:fs';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as logger from '../lib/logger.js';
import {
  listTrustedCaFiles,
  readTrustedCa,
  removeTrustedCa,
  trustedCaFileExists,
  trustedCaPath,
  validateTrustedCaId,
  validateTrustedCaPem,
  writeTrustedCa,
} from '../lib/trusted-cas.js';

// Trusted CA endpoints mirror the byo-certs pattern:
//   GET    /trusted-cas              list the PEM files on disk (mtime,
//                                    presence) — the UI joins this against
//                                    state.trustedCas[] to surface orphans
//   POST   /trusted-cas/validate     dry-run validation, no disk write
//   POST   /trusted-cas/upload       { id, pem } — validates + writes
//                                    /data/trusted-cas/<id>.pem
//   DELETE /trusted-cas/:id          removes the on-disk PEM
//
// State persistence (the TrustedCA entry in state.trustedCas[]) goes through
// the standard apply-state pipeline — the UI augments state with the parsed
// info from the upload response and calls PUT /api/state.

const listFiles = async dir => {
  const ids = await listTrustedCaFiles(dir);
  const summaries = await Promise.all(
    ids.map(async id => {
      const filePath = trustedCaPath(dir, id);
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

export const trustedCasRouter = config => {
  const router = Router();
  const dir = () => config.paths.trustedCasDir;

  router.get('/trusted-cas', async (req, res, next) => {
    logger.debug('GET /trusted-cas', { ip: req.ip });
    try {
      const files = await listFiles(dir());
      res.set('cache-control', 'no-store').json({ files, trustedCasDir: dir() });
    } catch (err) {
      next(err);
    }
  });

  router.get('/trusted-cas/:id', async (req, res, next) => {
    const { id } = req.params;
    logger.debug('GET /trusted-cas/:id', { ip: req.ip, id });
    const idError = validateTrustedCaId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    try {
      if (!(await trustedCaFileExists(dir(), id))) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      const pem = await readTrustedCa(dir(), id);
      res
        .set('content-type', 'application/x-pem-file; charset=utf-8')
        .set('cache-control', 'no-store')
        .send(pem);
    } catch (err) {
      next(err);
    }
  });

  router.post('/trusted-cas/validate', (req, res) => {
    const { pem } = req.body ?? {};
    const result = validateTrustedCaPem({ pem });
    res.json(result);
  });

  router.post('/trusted-cas/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { id, pem } = req.body ?? {};
    const idError = validateTrustedCaId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    const validation = validateTrustedCaPem({ pem });
    if (!validation.ok) {
      res.status(400).json({ ok: false, errors: validation.errors, warnings: validation.warnings });
      return;
    }
    try {
      const filePath = await writeTrustedCa(dir(), id, pem);
      audit.record({
        actor,
        category: 'trusted-ca',
        action: 'upload',
        target: id,
        outcome: 'ok',
        details: {
          fingerprint: validation.info.fingerprint,
          subjectSummary: validation.info.subjectSummary,
          certCount: validation.info.certCount,
        },
      });
      logger.info('trusted CA uploaded', { id, fingerprint: validation.info.fingerprint });
      res.json({
        ok: true,
        id,
        path: filePath,
        info: validation.info,
        warnings: validation.warnings,
      });
    } catch (err) {
      audit.record({
        actor,
        category: 'trusted-ca',
        action: 'upload',
        target: id,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  router.delete('/trusted-cas/:id', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { id } = req.params;
    const idError = validateTrustedCaId(id);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    try {
      await removeTrustedCa(dir(), id);
      audit.record({
        actor,
        category: 'trusted-ca',
        action: 'delete',
        target: id,
        outcome: 'ok',
      });
      logger.info('trusted CA deleted', { id });
      res.json({ ok: true });
    } catch (err) {
      audit.record({
        actor,
        category: 'trusted-ca',
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
