import { promises as fs } from 'node:fs';

import { ValidationError } from './errors.js';
import { ensureDir, fileExists, removeIfExists, safePathUnder, writeAtomic } from './files.js';

// Disk side of the DNS-provider credential lifecycle. The TLSProviderSchema
// in state-schema.js carries only `credentialsRef` (a path string); the
// actual key material lives in `<credentialsDir>/<providerId>.ini`, mode
// 0600. This mirrors the trusted-cas.js pattern: state holds metadata,
// disk holds bytes, no secrets in state.json.
//
// Path traversal is doubly guarded — first by the id regex (matches the
// state-schema IdSchema), then by resolve-and-compare so a hypothetical
// loosened regex doesn't open an escape hatch.

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

// Returns null when id valid, otherwise `{ code, replacements }` so the
// caller can hand off straight to errorResponse / localizeMessage.
export const validateProviderIdForCredentials = id => {
  if (typeof id !== 'string' || !ID_REGEX.test(id)) {
    return { code: 'cert.provider.idInvalid', replacements: {} };
  }
  return null;
};

const sanitizeCredentialPath = (credentialsDir, id) => {
  const idError = validateProviderIdForCredentials(id);
  if (idError) {
    throw new ValidationError(idError.code, { replacements: idError.replacements });
  }
  return safePathUnder(credentialsDir, `${id}.ini`);
};

export const credentialPath = (credentialsDir, id) => sanitizeCredentialPath(credentialsDir, id);

export const writeCredentials = async (credentialsDir, id, content) => {
  const filePath = sanitizeCredentialPath(credentialsDir, id);
  await ensureDir(credentialsDir, 0o700);
  await writeAtomic(filePath, content, { mode: 0o600 });
  return filePath;
};

export const readCredentials = (credentialsDir, id) => {
  const filePath = sanitizeCredentialPath(credentialsDir, id);
  return fs.readFile(filePath, 'utf8');
};

export const removeCredentials = async (credentialsDir, id) => {
  const filePath = sanitizeCredentialPath(credentialsDir, id);
  await removeIfExists(filePath);
};

export const credentialsExist = async (credentialsDir, id) => {
  try {
    const filePath = sanitizeCredentialPath(credentialsDir, id);
    return await fileExists(filePath);
  } catch {
    return false;
  }
};
