import { promises as fs } from 'node:fs';
import { join as joinPath, resolve as resolvePath } from 'node:path';

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
    return { error: idError };
  }
  const filePath = resolvePath(joinPath(credentialsDir, `${id}.ini`));
  const expectedPrefix = resolvePath(credentialsDir);
  if (!filePath.startsWith(`${expectedPrefix}/`) && filePath !== expectedPrefix) {
    return { error: 'id resolves outside credentialsDir' };
  }
  return { path: filePath };
};

export const credentialPath = (credentialsDir, id) => {
  const result = sanitizeCredentialPath(credentialsDir, id);
  if (result.error) {
    throw new Error(result.error);
  }
  return result.path;
};

export const writeCredentials = async (credentialsDir, id, content) => {
  const result = sanitizeCredentialPath(credentialsDir, id);
  if (result.error) {
    throw new Error(result.error);
  }
  await ensureDir(credentialsDir, 0o700);
  await writeAtomic(result.path, content, { mode: 0o600 });
  return result.path;
};

export const readCredentials = (credentialsDir, id) => {
  const result = sanitizeCredentialPath(credentialsDir, id);
  if (result.error) {
    return Promise.reject(new Error(result.error));
  }
  return fs.readFile(result.path, 'utf8');
};

export const removeCredentials = async (credentialsDir, id) => {
  const result = sanitizeCredentialPath(credentialsDir, id);
  if (result.error) {
    throw new Error(result.error);
  }
  await removeIfExists(result.path);
};

export const credentialsExist = (credentialsDir, id) => {
  const result = sanitizeCredentialPath(credentialsDir, id);
  if (result.error) {
    return Promise.resolve(false);
  }
  return fileExists(result.path);
};
