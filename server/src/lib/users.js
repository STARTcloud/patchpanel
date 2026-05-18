import { randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { ValidationError } from './errors.js';
import { fileExists, readJson, writeJson } from './files.js';
import { withLock } from './lock.js';

// users.json schema:
//   { users: [ { id, username, passwordHash, role, createdAt,
//                lastLoginAt|null, passwordChangedAt } ] }
//
// Storage layout mirrors state.json — a single JSON file behind withLock,
// atomic writes via writeJson. No DB. The auth middleware does an O(n) scan
// over users on every cookie-JWT verify, which is fine for the expected
// cardinality (single-digit admins on a network appliance).

const USERNAME_RE = /^[a-z][a-z0-9._-]{1,31}$/u;
const VALID_ROLES = Object.freeze(['admin']);

// Dummy hash used by verifyPassword on the missing-user path so the
// "no such user" branch performs an equivalent bcrypt comparison rather
// than returning instantly. Without this, an attacker can enumerate
// valid usernames by measuring response time: matched username takes
// ~150ms (real bcrypt work), unknown takes <1ms. Precomputed once on
// first verify call; rounds match the standard config default so the
// branches have comparable cost even when config.security.bcryptRounds
// is non-default.
let dummyHashPromise = null;
const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('this-is-never-a-real-password', 12);
  }
  return dummyHashPromise;
};

const lockPathFor = usersPath => `${usersPath}.lock`;

const emptyDoc = () => ({ users: [] });

const newId = () => `u_${randomBytes(8).toString('hex')}`;

const validateUsername = name => {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) {
    throw new ValidationError('auth.user.usernameInvalid');
  }
};

const validatePassword = password => {
  if (typeof password !== 'string' || password.length < 8) {
    throw new ValidationError('auth.user.passwordTooShort');
  }
  if (password.length > 256) {
    throw new ValidationError('auth.user.passwordTooLong');
  }
};

const validateRole = role => {
  if (!VALID_ROLES.includes(role)) {
    throw new ValidationError('auth.user.roleInvalid', {
      replacements: { roles: VALID_ROLES.join(', ') },
    });
  }
};

const loadDoc = async usersPath => {
  if (!(await fileExists(usersPath))) {
    return emptyDoc();
  }
  const raw = await readJson(usersPath);
  if (!raw || !Array.isArray(raw.users)) {
    throw new ValidationError('auth.user.fileMalformed', { replacements: { path: usersPath } });
  }
  return raw;
};

const saveDoc = async (usersPath, doc) => {
  await writeJson(usersPath, doc, { mode: 0o600 });
};

// Public view of a user — never includes the password hash.
const publicView = user => ({
  id: user.id,
  username: user.username,
  role: user.role,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt ?? null,
});

export const countUsers = async usersPath => {
  const doc = await loadDoc(usersPath);
  return doc.users.length;
};

export const listUsers = async usersPath => {
  const doc = await loadDoc(usersPath);
  return doc.users.map(publicView);
};

export const findByUsername = async (usersPath, username) => {
  const doc = await loadDoc(usersPath);
  return doc.users.find(u => u.username === username) ?? null;
};

export const findById = async (usersPath, id) => {
  const doc = await loadDoc(usersPath);
  return doc.users.find(u => u.id === id) ?? null;
};

export const createUser = async (usersPath, { username, password, role }, opts = {}) => {
  validateUsername(username);
  validatePassword(password);
  validateRole(role);
  const rounds = opts.bcryptRounds ?? 12;
  const passwordHash = await bcrypt.hash(password, rounds);
  return withLock(lockPathFor(usersPath), async () => {
    const doc = await loadDoc(usersPath);
    if (doc.users.some(u => u.username === username)) {
      throw new ValidationError('auth.user.usernameExists', { replacements: { username } });
    }
    const now = new Date().toISOString();
    const user = {
      id: newId(),
      username,
      passwordHash,
      role,
      createdAt: now,
      lastLoginAt: null,
      passwordChangedAt: now,
    };
    doc.users.push(user);
    await saveDoc(usersPath, doc);
    return publicView(user);
  });
};

export const verifyPassword = async (usersPath, username, password) => {
  const user = await findByUsername(usersPath, username);
  // Always compare against a real bcrypt hash — either the user's real
  // hash, or a precomputed dummy. Both branches do equivalent work, so
  // an attacker can't enumerate valid usernames via response timing.
  const hashToCheck = user ? user.passwordHash : await getDummyHash();
  const ok = await bcrypt.compare(password, hashToCheck);
  return user && ok ? user : null;
};

export const recordLogin = (usersPath, userId) =>
  withLock(lockPathFor(usersPath), async () => {
    const doc = await loadDoc(usersPath);
    const idx = doc.users.findIndex(u => u.id === userId);
    if (idx === -1) {
      return;
    }
    doc.users[idx] = { ...doc.users[idx], lastLoginAt: new Date().toISOString() };
    await saveDoc(usersPath, doc);
  });

export const changePassword = (usersPath, userId, { currentPassword, newPassword }, opts = {}) => {
  validatePassword(newPassword);
  const rounds = opts.bcryptRounds ?? 12;
  return withLock(lockPathFor(usersPath), async () => {
    const doc = await loadDoc(usersPath);
    const idx = doc.users.findIndex(u => u.id === userId);
    if (idx === -1) {
      throw new ValidationError('auth.user.notFound');
    }
    const current = doc.users[idx];
    const currentOk = await bcrypt.compare(currentPassword, current.passwordHash);
    if (!currentOk) {
      throw new ValidationError('auth.user.currentPasswordIncorrect');
    }
    const passwordHash = await bcrypt.hash(newPassword, rounds);
    const now = new Date().toISOString();
    doc.users[idx] = { ...current, passwordHash, passwordChangedAt: now };
    await saveDoc(usersPath, doc);
    return publicView(doc.users[idx]);
  });
};

// Used by `patchpanel user-reset` CLI for admin recovery. Skips the
// currentPassword check on purpose — the operator must have shell access
// to invoke the CLI, which is already an out-of-band proof of authority.
export const forceResetPassword = async (usersPath, username, newPassword, opts = {}) => {
  validatePassword(newPassword);
  const rounds = opts.bcryptRounds ?? 12;
  const passwordHash = await bcrypt.hash(newPassword, rounds);
  return withLock(lockPathFor(usersPath), async () => {
    const doc = await loadDoc(usersPath);
    const idx = doc.users.findIndex(u => u.username === username);
    if (idx === -1) {
      throw new ValidationError('auth.user.notFoundByName', { replacements: { username } });
    }
    const now = new Date().toISOString();
    doc.users[idx] = { ...doc.users[idx], passwordHash, passwordChangedAt: now };
    await saveDoc(usersPath, doc);
    return publicView(doc.users[idx]);
  });
};

export const deleteUser = (usersPath, userId) =>
  withLock(lockPathFor(usersPath), async () => {
    const doc = await loadDoc(usersPath);
    const before = doc.users.length;
    doc.users = doc.users.filter(u => u.id !== userId);
    if (doc.users.length === before) {
      throw new ValidationError('auth.user.notFound');
    }
    await saveDoc(usersPath, doc);
  });

// Raw user (including passwordHash + passwordChangedAt) — used by the JWT
// middleware to reject tokens issued before the latest password change.
// Callers must not return this shape to clients.
export const getInternal = async (usersPath, userId) => {
  const doc = await loadDoc(usersPath);
  return doc.users.find(u => u.id === userId) ?? null;
};
