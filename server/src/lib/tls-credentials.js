import { promises as fs } from 'node:fs';
import { join as joinPath, resolve as resolvePath, sep } from 'node:path';

import { ensureDir, fileExists, removeIfExists, writeAtomic } from './files.js';

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

export const validateProviderIdForCredentials = id => {
  if (typeof id !== 'string' || !ID_REGEX.test(id)) {
    return 'id must match a-z, 0-9, _, - (1-63 chars, letter-start)';
  }
  return null;
};

const sanitizeCredentialPath = (credentialsDir, id) => {
  const idError = validateProviderIdForCredentials(id);
  if (idError) {
    throw new Error(idError);
  }
  const filePath = resolvePath(joinPath(credentialsDir, `${id}.ini`));
  const expectedPrefix = resolvePath(credentialsDir);
  if (!filePath.startsWith(`${expectedPrefix}${sep}`) && filePath !== expectedPrefix) {
    throw new Error('id resolves outside credentialsDir');
  }
  return filePath;
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
