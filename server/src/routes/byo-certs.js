import { promises as fs } from 'node:fs';
import { join as joinPath, resolve as resolvePath } from 'node:path';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { validateByoBundle, validateLineageName } from '../lib/byo-cert-validator.js';
import { fileExists, writeAtomic } from '../lib/files.js';
import * as logger from '../lib/logger.js';

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
    return { error: validationError };
  }
  const resolved = resolvePath(joinPath(byoCertsDir, name));
  const expectedPrefix = resolvePath(byoCertsDir);
  if (!resolved.startsWith(`${expectedPrefix}/`) && resolved !== expectedPrefix) {
    return { error: 'name resolves outside byoCertsDir' };
  }
  return { path: resolved };
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
  const fullchainPath = joinPath(certDir, 'fullchain.pem');
  const privkeyPath = joinPath(certDir, 'privkey.pem');
  // Mirror certbot's on-disk layout: cert.pem (leaf only), fullchain.pem
  // (leaf+intermediates), privkey.pem. cert-lineage.js reads cert.pem +
  // privkey.pem + fullchain.pem so this layout makes BYO certs
  // indistinguishable from certbot certs downstream.
  const leafMatch = fullchainPem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/u
  );
  const certPemBody = leafMatch ? `${leafMatch[0]}\n` : fullchainPem;
  await Promise.all([
    writeAtomic(fullchainPath, fullchainPem.endsWith('\n') ? fullchainPem : `${fullchainPem}\n`, {
      mode: 0o600,
    }),
    writeAtomic(privkeyPath, privkeyPem.endsWith('\n') ? privkeyPem : `${privkeyPem}\n`, {
      mode: 0o600,
    }),
    writeAtomic(joinPath(certDir, 'cert.pem'), certPemBody, { mode: 0o600 }),
  ]);
};

export const byoCertsRouter = config => {
  const router = Router();
  const dir = () => config.paths.byoCertsDir;

  router.get('/byo-certs', async (req, res, next) => {
    logger.debug('GET /byo-certs', { ip: req.ip });
    try {
      const certs = await listCerts(dir());
      res.json({ certs, byoCertsDir: dir() });
    } catch (err) {
      next(err);
    }
  });

  router.post('/byo-certs/validate', (req, res) => {
    const { fullchainPem, privkeyPem } = req.body ?? {};
    const result = validateByoBundle({ fullchainPem, privkeyPem });
    res.json(result);
  });

  router.post('/byo-certs/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name, fullchainPem, privkeyPem } = req.body ?? {};
    const pathResult = sanitizeCertPath(dir(), name);
    if (pathResult.error) {
      res.status(400).json({ ok: false, error: pathResult.error });
      return;
    }
    const validation = validateByoBundle({ fullchainPem, privkeyPem });
    if (!validation.ok) {
      res.status(400).json({ ok: false, errors: validation.errors, info: validation.info });
      return;
    }
    try {
      await writePemBundle(pathResult.path, fullchainPem, privkeyPem);
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-upload',
        target: name,
        outcome: 'ok',
        details: { sans: validation.info.sans, notAfter: validation.info.notAfter },
      });
      logger.info('BYO cert uploaded', { name, sans: validation.info.sans });
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

  router.delete('/byo-certs/:name', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name } = req.params;
    const pathResult = sanitizeCertPath(dir(), name);
    if (pathResult.error) {
      res.status(400).json({ ok: false, error: pathResult.error });
      return;
    }
    try {
      await fs.rm(pathResult.path, { recursive: true, force: true });
      audit.record({
        actor,
        category: 'cert',
        action: 'byo-delete',
        target: name,
        outcome: 'ok',
      });
      logger.info('BYO cert deleted', { name });
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
