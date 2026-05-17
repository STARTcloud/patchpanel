import { createHash, X509Certificate } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { ensureDir, fileExists, removeIfExists, safePathUnder, writeAtomic } from './files.js';
import { findCertificatePemBlocks } from './pem.js';

// Trusted CA bundles uploaded by the user. A "trusted CA" entry is a PEM file
// containing one or more X.509 certificates that HAProxy can reference via
// `ca-file <path>` (on a bind for mTLS client cert validation, on a server
// line for upstream TLS chain verification). State carries the id, name, and
// parsed metadata; the PEM bytes live on disk under `<dir>/<id>.pem`.
//
// We deliberately do NOT carry the PEM in state — keeping bytes on disk
// matches the BYO cert pattern, keeps state.json small, and lets ops manage
// the file by hand if needed.

const TRUSTED_CA_ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

export const validateTrustedCaId = id => {
  if (typeof id !== 'string' || !TRUSTED_CA_ID_REGEX.test(id)) {
    return 'id must match a-z, 0-9, _, - (1-63 chars, letter-start)';
  }
  return null;
};

const splitPemChain = pemText => findCertificatePemBlocks(pemText).map(b => b.block);

// SHA-256 fingerprint of the DER-encoded cert, formatted as colon-separated
// uppercase hex (XX:XX:…) — matches `openssl x509 -fingerprint -sha256` so
// users can sanity-check against the source CA without re-parsing.
const fingerprintOf = x509 => {
  const der = x509.raw;
  const hash = createHash('sha256').update(der).digest('hex').toUpperCase();
  return hash.match(/.{2}/gu).join(':');
};

const extractSubjectSummary = x509 => {
  const cn = x509.subject?.match(/CN=(?<cn>[^,\r\n]+)/u);
  if (cn) {
    return cn.groups.cn.trim();
  }
  // Fall back to the full subject DN when there's no CN — root CAs sometimes
  // identify themselves with OU + O only.
  return (x509.subject ?? '').replace(/\s+/gu, ' ').trim().slice(0, 256);
};

// Basic Constraints: CA:TRUE marks an intermediate or root CA. Some user-
// uploaded "trust bundles" are just leaf certs that the user wants to pin
// (rare, but legal in HAProxy via `verify required`). We warn but don't
// reject when no cert in the chain has CA:TRUE — let the user decide.
const hasAnyCaCert = chain => chain.some(x => x.ca === true);

const parseChain = pemText => {
  const blocks = splitPemChain(pemText);
  if (blocks.length === 0) {
    return { ok: false, error: 'no CERTIFICATE blocks found' };
  }
  const certs = [];
  for (let i = 0; i < blocks.length; i += 1) {
    try {
      certs.push(new X509Certificate(blocks[i]));
    } catch (err) {
      return { ok: false, error: `cert #${i + 1} parse failed: ${err.message}` };
    }
  }
  return { ok: true, certs };
};

// `info` is the metadata shape persisted into state alongside the upload.
// `warnings[]` surfaces things like "no CA:TRUE cert in chain" or "earliest
// notAfter is < 30d away" so the UI can flag them without rejecting the
// upload outright.
export const validateTrustedCaPem = ({ pem }) => {
  if (typeof pem !== 'string' || pem.trim().length === 0) {
    return { ok: false, errors: ['pem is required'] };
  }
  const parsed = parseChain(pem);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error] };
  }
  const { certs } = parsed;
  const errors = [];
  const warnings = [];
  const now = Date.now();
  let earliestNotAfter = null;
  for (let i = 0; i < certs.length; i += 1) {
    const x = certs[i];
    const notBefore = x.validFromDate;
    const notAfter = x.validToDate;
    if (notAfter && notAfter.getTime() < now) {
      errors.push(`cert #${i + 1} (${extractSubjectSummary(x)}) expired ${notAfter.toISOString()}`);
    }
    if (notBefore && notBefore.getTime() > now) {
      warnings.push(`cert #${i + 1} not yet valid (notBefore ${notBefore.toISOString()})`);
    }
    if (notAfter && (earliestNotAfter === null || notAfter < earliestNotAfter)) {
      earliestNotAfter = notAfter;
    }
  }
  if (!hasAnyCaCert(certs)) {
    warnings.push(
      'no certificate in the bundle has BasicConstraints CA:TRUE — this is unusual for a trusted CA file'
    );
  }
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  const [leaf] = certs;
  return {
    ok: true,
    errors: [],
    warnings,
    info: {
      fingerprint: fingerprintOf(leaf),
      subjectSummary: extractSubjectSummary(leaf),
      notAfter: earliestNotAfter?.toISOString() ?? null,
      certCount: certs.length,
    },
  };
};

// Path safety: ids are validated above (regex `^[a-z][a-z0-9_-]{0,62}$` —
// no separators, no dots, no traversal possible), then defensively resolve
// and confirm the resulting path is still under the configured dir as a
// belt-and-suspenders barrier. Throws synchronously on a bad id so the
// dataflow from user input → fs call is linear and the regex test acts as
// an obvious sanitizer barrier.
const sanitizeTrustedCaPath = (trustedCasDir, id) => {
  const idError = validateTrustedCaId(id);
  if (idError) {
    throw new Error(idError);
  }
  return safePathUnder(trustedCasDir, `${id}.pem`);
};

export const trustedCaPath = (trustedCasDir, id) => sanitizeTrustedCaPath(trustedCasDir, id);

export const writeTrustedCa = async (trustedCasDir, id, pem) => {
  const filePath = sanitizeTrustedCaPath(trustedCasDir, id);
  await ensureDir(trustedCasDir, 0o755);
  const body = pem.endsWith('\n') ? pem : `${pem}\n`;
  await writeAtomic(filePath, body, { mode: 0o644 });
  return filePath;
};

export const readTrustedCa = (trustedCasDir, id) => {
  const filePath = sanitizeTrustedCaPath(trustedCasDir, id);
  return fs.readFile(filePath, 'utf8');
};

export const removeTrustedCa = async (trustedCasDir, id) => {
  const filePath = sanitizeTrustedCaPath(trustedCasDir, id);
  await removeIfExists(filePath);
};

export const listTrustedCaFiles = async trustedCasDir => {
  if (!(await fileExists(trustedCasDir))) {
    return [];
  }
  const entries = await fs.readdir(trustedCasDir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.pem'))
    .map(e => e.name.replace(/\.pem$/u, ''));
};

export const trustedCaFileExists = async (trustedCasDir, id) => {
  try {
    const filePath = sanitizeTrustedCaPath(trustedCasDir, id);
    return await fileExists(filePath);
  } catch {
    return false;
  }
};
