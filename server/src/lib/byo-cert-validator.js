import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

import { findCertificatePemBlocks } from './pem.js';

// v0.2.38 — Server-side validation for bring-your-own PEMs uploaded via the
// Certificates page. Returns { ok, errors[], info? } where `info` carries
// the parsed cert metadata so the UI can confirm the SAN list before save.
//
// Validation steps:
//   1. Fullchain PEM parses as at least one X.509 certificate
//   2. Private key PEM parses as a private key
//   3. The public key derived from the private key matches the leaf cert's
//      public key (i.e. the key actually goes with the cert)
//   4. The leaf cert is not expired
//   5. The leaf cert has at least one SAN (HAProxy needs SANs for SNI
//      matching; CN-only certs are technically valid but useless here)

const LINEAGE_NAME_REGEX = /^[a-zA-Z0-9._-]+$/u;

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

const extractCommonName = x509 => {
  const match = x509.subject?.match(/CN=(?<cn>[^,\r\n]+)/u);
  return match ? match.groups.cn.trim() : null;
};

const tryPublicKeysMatch = (privKeyPem, leafX509) => {
  let privateKey;
  let publicKeyFromPriv;
  let publicKeyFromCert;
  try {
    privateKey = createPrivateKey(privKeyPem);
    publicKeyFromPriv = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  } catch (err) {
    return {
      ok: false,
      error: { code: 'cert.byo.privKeyParseFailed', replacements: { reason: err.message } },
    };
  }
  try {
    publicKeyFromCert = createPublicKey(leafX509.publicKey).export({
      type: 'spki',
      format: 'der',
    });
  } catch (err) {
    return {
      ok: false,
      error: { code: 'cert.byo.certPubKeyExportFailed', replacements: { reason: err.message } },
    };
  }
  if (publicKeyFromPriv.equals(publicKeyFromCert)) {
    return { ok: true };
  }
  return { ok: false, error: { code: 'cert.byo.privKeyMismatch', replacements: {} } };
};

// Returns null when name valid, otherwise `{ code, replacements }`.
export const validateLineageName = name => {
  if (typeof name !== 'string' || !LINEAGE_NAME_REGEX.test(name)) {
    return { code: 'cert.byo.nameInvalidChars', replacements: {} };
  }
  if (name.length === 0 || name.length > 128) {
    return { code: 'cert.byo.nameInvalidLength', replacements: {} };
  }
  return null;
};

// `errors[]` carries `{ code, replacements }` objects.
export const validateByoBundle = ({ fullchainPem, privkeyPem }) => {
  const errors = [];
  if (typeof fullchainPem !== 'string' || fullchainPem.trim().length === 0) {
    errors.push({ code: 'cert.byo.fullchainRequired', replacements: {} });
  }
  if (typeof privkeyPem !== 'string' || privkeyPem.trim().length === 0) {
    errors.push({ code: 'cert.byo.privKeyRequired', replacements: {} });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const chainBlocks = findCertificatePemBlocks(fullchainPem);
  if (chainBlocks.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'cert.byo.fullchainNoCertBlocks', replacements: {} }],
    };
  }

  let leaf;
  try {
    leaf = new X509Certificate(chainBlocks[0].block);
  } catch (err) {
    return {
      ok: false,
      errors: [{ code: 'cert.byo.leafParseFailed', replacements: { reason: err.message } }],
    };
  }

  const sans = parseSansFromX509(leaf);
  const commonName = extractCommonName(leaf);

  const match = tryPublicKeysMatch(privkeyPem, leaf);
  if (!match.ok) {
    errors.push(match.error);
  }

  const now = Date.now();
  const notBefore = leaf.validFromDate;
  const notAfter = leaf.validToDate;
  if (notAfter && notAfter.getTime() < now) {
    errors.push({
      code: 'cert.byo.leafExpired',
      replacements: { notAfter: notAfter.toISOString() },
    });
  }
  if (notBefore && notBefore.getTime() > now) {
    errors.push({
      code: 'cert.byo.leafNotYetValid',
      replacements: { notBefore: notBefore.toISOString() },
    });
  }

  if (sans.length === 0) {
    errors.push({ code: 'cert.byo.leafNoSans', replacements: {} });
  }

  if (errors.length > 0) {
    return { ok: false, errors, info: { sans, commonName, notBefore, notAfter } };
  }

  return {
    ok: true,
    errors: [],
    info: {
      sans,
      commonName,
      notBefore: notBefore?.toISOString() ?? null,
      notAfter: notAfter?.toISOString() ?? null,
      chainLength: chainBlocks.length,
    },
  };
};
