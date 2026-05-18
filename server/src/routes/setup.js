import { promises as fs } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { AuthError, ValidationError } from '../lib/errors.js';
import { fileExists } from '../lib/files.js';
import * as jwtLib from '../lib/jwt.js';
import { log } from '../lib/logger.js';
import { countUsers, createUser, getInternal } from '../lib/users.js';

// /api/setup/* — first-run wizard. Only operates while:
//   1. /etc/patchpanel/setup.token exists (postinst writes it; the wizard
//      consumes + deletes it), AND
//   2. users.json has zero users.
//
// Both conditions must hold. The token alone isn't enough (prevents a
// reused stale token from creating a parallel admin), and zero-users alone
// isn't enough (prevents anyone from racing the wizard on a freshly
// installed but never-opened deployment).

const COOKIE_NAME = config => config.security?.sessionCookieName ?? 'patchpanel.sid';

const cookieOptions = config => ({
  httpOnly: true,
  secure: Boolean(config.security?.sessionSecure ?? true),
  sameSite: config.security?.sessionSameSite ?? 'lax',
  path: '/',
});

const expiryToMs = expiry => {
  if (typeof expiry !== 'string') {
    return 24 * 60 * 60 * 1000;
  }
  const match = expiry.match(/^(?<n>\d+)\s*(?<unit>[smhd])$/u);
  if (!match) {
    return 24 * 60 * 60 * 1000;
  }
  const n = Number.parseInt(match.groups.n, 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match.groups.unit];
  return n * mult;
};

const readSetupToken = async setupTokenPath => {
  if (!setupTokenPath) {
    return null;
  }
  if (!(await fileExists(setupTokenPath))) {
    return null;
  }
  return (await fs.readFile(setupTokenPath, 'utf8')).trim();
};

const safeEq = (a, b) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
};

export const setupRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/setup/status:
   *   get:
   *     summary: First-run wizard status probe
   *     description: Public probe the SPA calls on boot. Setup is available when (1) `users.json` has zero users AND (2) the postinst-written `setup.token` file is still on disk. HA-ingress mode skips this entirely (the SPA never asks because `/api/auth/whoami` returns `source: ingress`).
   *     tags: [Auth]
   *     security: []
   *     responses:
   *       200:
   *         description: Setup status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 needsSetup: { type: boolean }
   *                 hasToken: { type: boolean }
   *                 userCount: { type: integer }
   */
  router.get('/setup/status', async (req, res, next) => {
    log.auth.debug('GET /setup/status', { ip: req.ip });
    try {
      const userCount = await countUsers(config.paths.users);
      const tokenPresent = Boolean(await readSetupToken(config.paths.setupToken));
      // Setup is available when no users exist AND the postinst's one-time
      // token file is still on disk. HA-ingress mode skips this entirely
      // (the SPA never asks because /auth/whoami returns source=ingress).
      res.json({
        needsSetup: userCount === 0 && tokenPresent,
        hasToken: tokenPresent,
        userCount,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/setup/complete:
   *   post:
   *     summary: Consume the setup token and create the first admin
   *     description: |
   *       One-shot endpoint: verifies the token against `setup.token` (timing-safe), confirms users.json is still empty, creates the bootstrap admin, deletes the token file, and signs the new user in by issuing a session cookie. Subsequent attempts return 401.
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [token, username, password]
   *             properties:
   *               token: { type: string, description: 'Contents of /etc/patchpanel/setup.token' }
   *               username: { type: string }
   *               password: { type: string, format: password }
   *     responses:
   *       201:
   *         description: First admin created; session cookie set
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user:
   *                   type: object
   *                   properties:
   *                     id: { type: string }
   *                     username: { type: string }
   *                     role: { type: string, enum: [admin] }
   *       400: { description: 'Missing fields', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Bad token, already set up, or token consumed', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/setup/complete', async (req, res, next) => {
    try {
      const { token, username, password } = req.body ?? {};
      if (
        typeof token !== 'string' ||
        typeof username !== 'string' ||
        typeof password !== 'string'
      ) {
        throw new ValidationError('auth.setup.fieldsRequired');
      }
      const expected = await readSetupToken(config.paths.setupToken);
      if (!expected) {
        throw new AuthError('auth.setup.notAvailable');
      }
      if (!safeEq(token, expected)) {
        audit.record({
          actor: null,
          category: 'auth',
          action: 'setup-complete',
          outcome: 'fail',
          details: { reason: 'invalid-token', ip: req.ip },
        });
        throw new AuthError('auth.setup.tokenInvalid');
      }
      const userCount = await countUsers(config.paths.users);
      if (userCount > 0) {
        audit.record({
          actor: null,
          category: 'auth',
          action: 'setup-complete',
          outcome: 'fail',
          details: { reason: 'users-already-exist', ip: req.ip },
        });
        throw new AuthError('auth.setup.alreadyCompleted');
      }

      const user = await createUser(
        config.paths.users,
        { username, password, role: 'admin' },
        { bcryptRounds: config.security?.bcryptRounds ?? 12 }
      );

      // Consume the token — delete the file so it can't be replayed.
      await fs.rm(config.paths.setupToken, { force: true });

      // Sign them in immediately so they don't hit the login page right after.
      // Re-fetch internal record for passwordChangedAt.
      const internal = await getInternal(config.paths.users, user.id);
      const jwtToken = jwtLib.sign({
        secret: config.security.jwtSecret,
        expiresIn: config.security.jwtExpiry,
        claims: {
          userId: internal.id,
          username: internal.username,
          role: internal.role,
          passwordChangedAt: internal.passwordChangedAt,
        },
      });
      res.cookie(COOKIE_NAME(config), jwtToken, {
        ...cookieOptions(config),
        maxAge: expiryToMs(config.security.jwtExpiry),
      });
      audit.record({
        actor: user.id,
        category: 'auth',
        action: 'setup-complete',
        target: user.username,
        outcome: 'ok',
        details: { ip: req.ip },
      });
      log.auth.info('first admin created via setup wizard', { username: user.username });
      res.status(201).json({ user });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
