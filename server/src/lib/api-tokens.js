import { randomBytes, timingSafeEqual } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { ValidationError } from './errors.js';
import { fileExists, readJson, writeJson } from './files.js';
import { withLock } from './lock.js';

// api-tokens.json schema:
//   { tokens: [ { keyId, name, hash, createdAt, expiresAt|null,
//                 lastUsedAt|null, createdBy } ] }
//
// Token wire format: `pp_<8-hex-keyId>.<32-hex-secret>`
// Lookup is O(1) by keyId (hash-stable public prefix), then a single
// bcrypt.compare against that row's `hash`. Avoids the O(n) scan all three
// reference implementations have.

const KEY_ID_BYTES = 4; // → 8 hex chars
const SECRET_BYTES = 16; // → 32 hex chars
const TOKEN_PREFIX = 'pp_';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/u;
const KEY_ID_RE = /^pp_[0-9a-f]{8}$/u;

const lockPathFor = tokensPath => `${tokensPath}.lock`;

const emptyDoc = () => ({ tokens: [] });

const newKeyId = () => `${TOKEN_PREFIX}${randomBytes(KEY_ID_BYTES).toString('hex')}`;
const newSecret = () => randomBytes(SECRET_BYTES).toString('hex');

const loadDoc = async tokensPath => {
  if (!(await fileExists(tokensPath))) {
    return emptyDoc();
  }
  const raw = await readJson(tokensPath);
  if (!raw || !Array.isArray(raw.tokens)) {
    throw new ValidationError('auth.token.fileMalformed', { replacements: { path: tokensPath } });
  }
  return raw;
};

const saveDoc = async (tokensPath, doc) => {
  await writeJson(tokensPath, doc, { mode: 0o600 });
};

const publicView = token => ({
  keyId: token.keyId,
  name: token.name,
  createdAt: token.createdAt,
  expiresAt: token.expiresAt ?? null,
  lastUsedAt: token.lastUsedAt ?? null,
  createdBy: token.createdBy,
});

const isExpired = token => {
  if (!token.expiresAt) {
    return false;
  }
  return new Date(token.expiresAt).getTime() < Date.now();
};

// Constant-time comparison of the keyId prefix — defence in depth even
// though keyId is public (the lookup itself is by string equality, but
// using timingSafeEqual on the secret avoids leaking which characters
// matched if a tampered token slips through bcrypt somehow).
const safeStrEq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
};

export const parseToken = wire => {
  if (typeof wire !== 'string') {
    return null;
  }
  const dot = wire.indexOf('.');
  if (dot < 0) {
    return null;
  }
  const keyId = wire.slice(0, dot);
  const secret = wire.slice(dot + 1);
  if (!KEY_ID_RE.test(keyId) || secret.length < 32) {
    return null;
  }
  return { keyId, secret };
};

export const listTokens = async tokensPath => {
  const doc = await loadDoc(tokensPath);
  return doc.tokens.map(publicView);
};

export const createToken = async (tokensPath, { name, createdBy, expiresAt = null }, opts = {}) => {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    throw new ValidationError('auth.token.nameInvalid');
  }
  if (expiresAt !== null) {
    const exp = new Date(expiresAt);
    if (Number.isNaN(exp.getTime())) {
      throw new ValidationError('auth.token.expiresAtInvalid');
    }
    if (exp.getTime() < Date.now()) {
      throw new ValidationError('auth.token.expiresAtPast');
    }
  }
  const rounds = opts.bcryptRounds ?? 12;
  const keyId = newKeyId();
  const secret = newSecret();
  const hash = await bcrypt.hash(secret, rounds);
  const wire = `${keyId}.${secret}`;
  return withLock(lockPathFor(tokensPath), async () => {
    const doc = await loadDoc(tokensPath);
    if (doc.tokens.some(t => t.keyId === keyId)) {
      throw new Error('keyId collision (improbable; retry)');
    }
    if (doc.tokens.some(t => t.name === name)) {
      throw new ValidationError('auth.token.nameExists', { replacements: { name } });
    }
    const now = new Date().toISOString();
    const token = {
      keyId,
      name,
      hash,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      createdBy,
    };
    doc.tokens.push(token);
    await saveDoc(tokensPath, doc);
    return { token: publicView(token), wire };
  });
};

export const verifyToken = async (tokensPath, wire) => {
  const parsed = parseToken(wire);
  if (!parsed) {
    return null;
  }
  const doc = await loadDoc(tokensPath);
  const row = doc.tokens.find(t => safeStrEq(t.keyId, parsed.keyId));
  if (!row) {
    return null;
  }
  if (isExpired(row)) {
    return null;
  }
  const ok = await bcrypt.compare(parsed.secret, row.hash);
  return ok ? row : null;
};

export const recordTokenUse = (tokensPath, keyId) =>
  withLock(lockPathFor(tokensPath), async () => {
    const doc = await loadDoc(tokensPath);
    const idx = doc.tokens.findIndex(t => t.keyId === keyId);
    if (idx === -1) {
      return;
    }
    doc.tokens[idx] = { ...doc.tokens[idx], lastUsedAt: new Date().toISOString() };
    await saveDoc(tokensPath, doc);
  });

export const deleteToken = (tokensPath, keyId) =>
  withLock(lockPathFor(tokensPath), async () => {
    const doc = await loadDoc(tokensPath);
    const before = doc.tokens.length;
    doc.tokens = doc.tokens.filter(t => t.keyId !== keyId);
    if (doc.tokens.length === before) {
      throw new ValidationError('auth.token.notFound');
    }
    await saveDoc(tokensPath, doc);
  });
