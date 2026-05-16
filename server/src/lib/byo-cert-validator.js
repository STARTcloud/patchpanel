import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';

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

const splitPemChain = pemText => {
  const matches = pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu);
  return matches ?? [];
};

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
    return { ok: false, error: `private key parse failed: ${err.message}` };
  }
  try {
    publicKeyFromCert = createPublicKey(leafX509.publicKey).export({
      type: 'spki',
      format: 'der',
    });
  } catch (err) {
    return { ok: false, error: `cert public key export failed: ${err.message}` };
  }
  if (publicKeyFromPriv.equals(publicKeyFromCert)) {
    return { ok: true };
  }
  return { ok: false, error: 'private key does not match the leaf certificate' };
};

export const validateLineageName = name => {
  if (typeof name !== 'string' || !LINEAGE_NAME_REGEX.test(name)) {
    return 'lineageName must contain only letters, digits, dot, dash, underscore';
  }
  if (name.length === 0 || name.length > 128) {
    return 'lineageName must be 1-128 characters';
  }
  return null;
};

export const validateByoBundle = ({ fullchainPem, privkeyPem }) => {
  const errors = [];
  if (typeof fullchainPem !== 'string' || fullchainPem.trim().length === 0) {
    errors.push('fullchainPem is required');
  }
  if (typeof privkeyPem !== 'string' || privkeyPem.trim().length === 0) {
    errors.push('privkeyPem is required');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const chainBlocks = splitPemChain(fullchainPem);
  if (chainBlocks.length === 0) {
    return { ok: false, errors: ['fullchainPem contains no CERTIFICATE blocks'] };
  }

  let leaf;
  try {
    leaf = new X509Certificate(chainBlocks[0]);
  } catch (err) {
    return { ok: false, errors: [`leaf certificate parse failed: ${err.message}`] };
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
    errors.push(`leaf cert already expired (notAfter ${notAfter.toISOString()})`);
  }
  if (notBefore && notBefore.getTime() > now) {
    errors.push(`leaf cert not yet valid (notBefore ${notBefore.toISOString()})`);
  }

  if (sans.length === 0) {
    errors.push('leaf cert has no Subject Alternative Names — HAProxy needs SANs for SNI matching');
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
