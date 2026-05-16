import { X509Certificate } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';

import { fileExists, writeAtomic } from './files.js';
import * as logger from './logger.js';

const PEM_NAME_PATTERN = /^haproxy-.+\.pem$/u;

const parseSansFromX509 = x509 => {
  const raw = x509.subjectAltName;
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part.startsWith('DNS:'))
    .map(part => part.slice(4));
};

const readLineageMeta = async lineageDir => {
  const certPath = joinPath(lineageDir, 'cert.pem');
  const privkeyPath = joinPath(lineageDir, 'privkey.pem');
  const fullchainPath = joinPath(lineageDir, 'fullchain.pem');

  if (!(await fileExists(certPath))) {
    return null;
  }
  if (!(await fileExists(privkeyPath))) {
    return null;
  }
  if (!(await fileExists(fullchainPath))) {
    return null;
  }

  const pemText = await fs.readFile(certPath, 'utf8');
  let x509;
  try {
    x509 = new X509Certificate(pemText);
  } catch (err) {
    logger.warning('failed to parse certificate', { lineageDir, error: err.message });
    return null;
  }

  return {
    lineageDir,
    privkeyPath,
    fullchainPath,
    x509,
    notBefore: x509.validFromDate,
    notAfter: x509.validToDate,
  };
};

const groupLineagesByCertName = async (letsencryptDir, certName) => {
  const liveDir = joinPath(letsencryptDir, 'live');
  if (!(await fileExists(liveDir))) {
    return [];
  }
  const entries = await fs.readdir(liveDir, { withFileTypes: true });
  const matches = entries
    .filter(e => e.isDirectory())
    .filter(e => e.name === certName || e.name.startsWith(`${certName}-`))
    .map(e => joinPath(liveDir, e.name));
  return matches;
};

export const discoverLineages = async (letsencryptDir, certName) => {
  const candidates = await groupLineagesByCertName(letsencryptDir, certName);
  const metas = await Promise.all(candidates.map(dir => readLineageMeta(dir)));
  return metas.filter(meta => meta !== null);
};

// v0.2.38 — BYO lineage discovery. The folder under `byoCertsDir/<certName>/`
// is structured identically to a certbot lineage (cert.pem, fullchain.pem,
// privkey.pem) thanks to `routes/byo-certs.js` writing all three files on
// upload. So we can reuse `readLineageMeta` without modification.
export const discoverByoLineages = async (byoCertsDir, certName) => {
  if (!(await fileExists(byoCertsDir))) {
    return [];
  }
  const lineageDir = joinPath(byoCertsDir, certName);
  if (!(await fileExists(lineageDir))) {
    return [];
  }
  const meta = await readLineageMeta(lineageDir);
  return meta ? [meta] : [];
};

export const pickNewestValid = lineages => {
  const now = Date.now();
  const valid = lineages.filter(l => l.notAfter && l.notAfter.getTime() > now);
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((best, current) =>
    current.notBefore && best.notBefore && current.notBefore > best.notBefore ? current : best
  );
};

export const emitPem = async (haproxyCertsDir, certName, lineage) => {
  const targetPath = joinPath(haproxyCertsDir, `haproxy-${certName}.pem`);
  const [privkey, fullchain] = await Promise.all([
    fs.readFile(lineage.privkeyPath, 'utf8'),
    fs.readFile(lineage.fullchainPath, 'utf8'),
  ]);
  const content = `${privkey}${privkey.endsWith('\n') ? '' : '\n'}${fullchain}`;
  await writeAtomic(targetPath, content, { mode: 0o600 });
  logger.info('emitted haproxy PEM', { certName, target: targetPath });
  return { path: targetPath, sans: parseSansFromX509(lineage.x509) };
};

const sanitizeOldPems = async (haproxyCertsDir, validCertNames) => {
  if (!(await fileExists(haproxyCertsDir))) {
    return;
  }
  const entries = await fs.readdir(haproxyCertsDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(e => e.isFile() && PEM_NAME_PATTERN.test(e.name))
      .filter(e => {
        const name = e.name.replace(/^haproxy-/u, '').replace(/\.pem$/u, '');
        return !validCertNames.has(name);
      })
      .map(e => fs.rm(joinPath(haproxyCertsDir, e.name), { force: true }))
  );
};

// v0.2.38 — `processCert` now branches on provider type. BYO providers
// (`type === 'byo'`) skip the certbot live/ directory and pull from
// `byoCertsDir/<certName>/` instead. Falls back to letsencrypt discovery
// when no provider map is supplied (preserves the pre-v0.2.38 callers
// that don't yet pass `state.tls.providers`).
const processCert = async (paths, cert, providersById) => {
  const provider = providersById?.get(cert.providerId);
  const isByo = provider?.type === 'byo';
  const lineages = isByo
    ? await discoverByoLineages(paths.byoCertsDir, cert.certName)
    : await discoverLineages(paths.letsencryptDir, cert.certName);
  const chosen = pickNewestValid(lineages);
  if (!chosen) {
    logger.warning('no valid lineage for cert; skipping', {
      certName: cert.certName,
      providerType: provider?.type ?? 'unknown',
    });
    return null;
  }
  const result = await emitPem(paths.haproxyCertsDir, cert.certName, chosen);
  const sniList = result.sans.length > 0 ? result.sans : cert.domains;
  return {
    line: `${result.path} ${sniList.join(' ')}`,
    emitted: { certName: cert.certName, pemPath: result.path, sniList, byo: isByo },
  };
};

export const buildCertsList = async (paths, certs, providers = []) => {
  const validCertNames = new Set(certs.map(c => c.certName));
  await sanitizeOldPems(paths.haproxyCertsDir, validCertNames);

  const providersById = new Map(providers.map(p => [p.id, p]));
  const results = await Promise.all(certs.map(cert => processCert(paths, cert, providersById)));
  const successful = results.filter(r => r !== null);
  const lines = successful.map(r => r.line);
  const emitted = successful.map(r => r.emitted);

  await writeAtomic(paths.haproxyCertsList, `${lines.join('\n')}\n`, { mode: 0o644 });
  logger.info('certs.list rebuilt', { entries: emitted.length });
  return emitted;
};

export const ensureCertsDirs = async paths => {
  await fs.mkdir(dirname(paths.haproxyCertsList), { recursive: true });
  await fs.mkdir(paths.haproxyCertsDir, { recursive: true });
  await fs.mkdir(paths.letsencryptDir, { recursive: true });
  if (paths.byoCertsDir) {
    await fs.mkdir(paths.byoCertsDir, { recursive: true });
  }
};
