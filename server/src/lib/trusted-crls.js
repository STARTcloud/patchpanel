import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { ValidationError } from './errors.js';
import { ensureDir, fileExists, removeIfExists, safePathUnder, writeAtomic } from './files.js';
import { findCrlPemBlocks } from './pem.js';

// Trusted X.509 CRLs (Certificate Revocation Lists). Referenced from a
// bind's ssl block via `crlTrustedCrlId`, rendered into HAProxy's `crl-file
// <path>` directive. The PEM bytes live on disk under
// `<dir>/<id>.pem`; state carries a SHA-256 fingerprint of the DER body so
// the UI can show a stable identifier without re-parsing.
//
// CRL semantic parsing (nextUpdate timestamp, revoked-cert list) is
// deferred. Node's `crypto.X509Certificate` parses certs but not CRLs, and
// adding `node-forge` or shelling out to `openssl crl` to extract those
// fields isn't worth the surface area right now — HAProxy validates the
// CRL file at `haproxy -c` time, which catches malformed input before any
// reload happens. We do shallow PEM-marker validation here so non-PEM
// uploads get rejected before they hit disk.

const TRUSTED_CRL_ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

// Returns null when id valid, otherwise `{ code, replacements }`.
export const validateTrustedCrlId = id => {
  if (typeof id !== 'string' || !TRUSTED_CRL_ID_REGEX.test(id)) {
    return { code: 'cert.trustedCrl.idInvalid', replacements: {} };
  }
  return null;
};

const stripTrailingEquals = s => {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 61) {
    end -= 1;
  }
  return s.slice(0, end);
};

const fingerprintFromBody = b64Body => {
  const cleaned = b64Body.replace(/\s+/gu, '');
  if (cleaned.length === 0) {
    return null;
  }
  // node's Buffer.from('base64') accepts anything and silently drops bad
  // bytes, so we re-check by round-tripping. A real CRL body is hundreds of
  // bytes; an empty round-trip means the input wasn't base64.
  const der = Buffer.from(cleaned, 'base64');
  if (der.length === 0) {
    return null;
  }
  const reencoded = der.toString('base64');
  if (stripTrailingEquals(reencoded) !== stripTrailingEquals(cleaned)) {
    return null;
  }
  const hash = createHash('sha256').update(der).digest('hex').toUpperCase();
  return hash.match(/.{2}/gu).join(':');
};

// `errors[]` carries `{ code, replacements }` objects.
export const validateTrustedCrlPem = ({ pem }) => {
  if (typeof pem !== 'string' || pem.trim().length === 0) {
    return { ok: false, errors: [{ code: 'cert.trustedCrl.pemRequired', replacements: {} }] };
  }
  const blocks = findCrlPemBlocks(pem);
  if (blocks.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'cert.trustedCrl.noCrlBlock', replacements: {} }],
    };
  }
  const fingerprint = fingerprintFromBody(blocks[0].body);
  if (!fingerprint) {
    return {
      ok: false,
      errors: [{ code: 'cert.trustedCrl.bodyNotBase64', replacements: {} }],
    };
  }
  return {
    ok: true,
    errors: [],
    warnings: [],
    info: { fingerprint },
  };
};

const sanitizeTrustedCrlPath = (trustedCrlsDir, id) => {
  const idError = validateTrustedCrlId(id);
  if (idError) {
    throw new ValidationError(idError.code, { replacements: idError.replacements });
  }
  return safePathUnder(trustedCrlsDir, `${id}.pem`);
};

export const trustedCrlPath = (trustedCrlsDir, id) => sanitizeTrustedCrlPath(trustedCrlsDir, id);

export const writeTrustedCrl = async (trustedCrlsDir, id, pem) => {
  const filePath = sanitizeTrustedCrlPath(trustedCrlsDir, id);
  await ensureDir(trustedCrlsDir, 0o755);
  const body = pem.endsWith('\n') ? pem : `${pem}\n`;
  await writeAtomic(filePath, body, { mode: 0o644 });
  return filePath;
};

export const readTrustedCrl = (trustedCrlsDir, id) => {
  const filePath = sanitizeTrustedCrlPath(trustedCrlsDir, id);
  return fs.readFile(filePath, 'utf8');
};

export const removeTrustedCrl = async (trustedCrlsDir, id) => {
  const filePath = sanitizeTrustedCrlPath(trustedCrlsDir, id);
  await removeIfExists(filePath);
};

export const listTrustedCrlFiles = async trustedCrlsDir => {
  if (!(await fileExists(trustedCrlsDir))) {
    return [];
  }
  const entries = await fs.readdir(trustedCrlsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.pem'))
    .map(e => e.name.replace(/\.pem$/u, ''));
};

export const trustedCrlFileExists = async (trustedCrlsDir, id) => {
  try {
    const filePath = sanitizeTrustedCrlPath(trustedCrlsDir, id);
    return await fileExists(filePath);
  } catch {
    return false;
  }
};
