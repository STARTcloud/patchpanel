import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { AuthError, ValidationError } from '../lib/errors.js';
import * as jwtLib from '../lib/jwt.js';
import { log } from '../lib/logger.js';
import { changePassword, getInternal, recordLogin, verifyPassword } from '../lib/users.js';

import { requireSession } from '../middleware/auth.js';

// /api/auth/* — session login/logout, whoami probe, password change.
// API-token CRUD lives in routes/api-tokens.js; first-run wizard in routes/setup.js.

const cookieOptions = config => ({
  httpOnly: true,
  secure: Boolean(config.security?.sessionSecure ?? true),
  sameSite: config.security?.sessionSameSite ?? 'lax',
  path: '/',
});

const COOKIE_NAME = config => config.security?.sessionCookieName ?? 'patchpanel.sid';

// Best-effort: convert the configured expiry string ("24h", "7d", "30m")
// into ms for the cookie's maxAge. JWT verification still uses the original
// string via jsonwebtoken's own parser; this is just the cookie surface.
const expiryToMs = expiry => {
  if (typeof expiry !== 'string') {
    return 24 * 60 * 60 * 1000;
  }
  const match = expiry.match(/^(?<n>\d+)\s*(?<unit>[smhd])$/u);
  if (!match) {
    return 24 * 60 * 60 * 1000;
  }
  const { unit } = match.groups;
  const n = Number.parseInt(match.groups.n, 10);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
};

export const authRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Log in with username and password
   *     description: Verifies the password against the local users file, mints a JWT, and sets it in an httpOnly session cookie. Public — only available in `local` auth strategy. Fails 401 on invalid credentials (audit logged).
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username: { type: string, example: admin }
   *               password: { type: string, format: password, example: hunter2 }
   *     responses:
   *       200:
   *         description: Login succeeded; session cookie set
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
   *                     source: { type: string, enum: [session] }
   *       400:
   *         description: Missing / non-string username or password
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   *       401:
   *         description: Invalid credentials
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   */
  router.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') {
        throw new ValidationError('auth.login.fieldsRequired');
      }
      const user = await verifyPassword(config.paths.users, username, password);
      if (!user) {
        audit.record({
          actor: null,
          category: 'auth',
          action: 'login',
          target: username,
          outcome: 'fail',
          details: { reason: 'invalid-credentials', ip: req.ip },
        });
        throw new AuthError('auth.invalidCredentials');
      }
      const token = jwtLib.sign({
        secret: config.security.jwtSecret,
        expiresIn: config.security.jwtExpiry,
        claims: {
          userId: user.id,
          username: user.username,
          role: user.role,
          passwordChangedAt: user.passwordChangedAt,
        },
      });
      res.cookie(COOKIE_NAME(config), token, {
        ...cookieOptions(config),
        maxAge: expiryToMs(config.security.jwtExpiry),
      });
      await recordLogin(config.paths.users, user.id);
      audit.record({
        actor: user.id,
        category: 'auth',
        action: 'login',
        target: user.username,
        outcome: 'ok',
        details: { ip: req.ip },
      });
      log.auth.info('login ok', { username: user.username, ip: req.ip });
      res.json({
        user: { id: user.id, username: user.username, role: user.role, source: 'session' },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/auth/logout:
   *   post:
   *     summary: Log out the current session
   *     description: Clears the session cookie. Idempotent — returns 200 even when no cookie was set. Forbidden for API-token-authenticated requests; tokens are revoked via `DELETE /api/api-tokens/{keyId}` instead.
   *     tags: [Auth]
   *     security:
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Logout succeeded
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } }
   *       403:
   *         description: Endpoint is browser-session only; not available to API tokens
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   */
  router.post('/auth/logout', requireSession, (req, res) => {
    res.clearCookie(COOKIE_NAME(config), { ...cookieOptions(config), maxAge: undefined });
    if (req.user) {
      audit.record({
        actor: req.user.id,
        category: 'auth',
        action: 'logout',
        target: req.user.username,
        outcome: 'ok',
      });
    }
    res.json({ ok: true });
  });

  /**
   * @swagger
   * /api/auth/whoami:
   *   get:
   *     summary: Probe current auth state
   *     description: Returns the current authentication context without 401-ing on no-auth. The SPA calls this on mount to decide between rendering the app vs. redirecting to /login.
   *     tags: [Auth]
   *     security: []
   *     responses:
   *       200:
   *         description: Authentication probe result
   *         content:
   *           application/json:
   *             schema:
   *               oneOf:
   *                 - type: object
   *                   required: [authenticated]
   *                   properties:
   *                     authenticated: { type: boolean, enum: [false] }
   *                 - type: object
   *                   required: [authenticated, source, user]
   *                   properties:
   *                     authenticated: { type: boolean, enum: [true] }
   *                     source:
   *                       type: string
   *                       enum: [session, token, ingress, none]
   *                       description: How this request was authenticated
   *                     user:
   *                       type: object
   *                       properties:
   *                         id: { type: string }
   *                         username: { type: string }
   *                         role: { type: string }
   *                         displayName: { type: string, nullable: true }
   */
  router.get('/auth/whoami', (req, res) => {
    if (!req.user) {
      res.json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      source: req.user.source,
      user: {
        id: req.user.id,
        username: req.user.username,
        role: req.user.role,
        displayName: req.user.displayName ?? null,
      },
    });
  });

  /**
   * @swagger
   * /api/auth/change-password:
   *   put:
   *     summary: Change the current user's password
   *     description: Verifies the current password, hashes the new one, and bumps `passwordChangedAt` (invalidating every other existing JWT). Returns a fresh session cookie so the active browser stays logged in. Session-only — API tokens cannot change passwords.
   *     tags: [Auth]
   *     security:
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [currentPassword, newPassword]
   *             properties:
   *               currentPassword: { type: string, format: password }
   *               newPassword: { type: string, format: password }
   *     responses:
   *       200:
   *         description: Password changed; new session cookie issued
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 user:
   *                   type: object
   *                   properties:
   *                     id: { type: string }
   *                     username: { type: string }
   *                     role: { type: string }
   *       400:
   *         description: Missing fields or new password fails policy
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   *       401:
   *         description: Current password incorrect
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   *       403:
   *         description: Not a browser session (API tokens forbidden)
   *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
   */
  router.put('/auth/change-password', requireSession, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        throw new ValidationError('auth.changePassword.fieldsRequired');
      }
      const updated = await changePassword(
        config.paths.users,
        req.user.id,
        { currentPassword, newPassword },
        { bcryptRounds: config.security?.bcryptRounds ?? 12 }
      );
      // Re-mint the JWT so the active session keeps working post-change.
      // Read the full record to pull the fresh passwordChangedAt.
      const fresh = await getInternal(config.paths.users, req.user.id);
      const token = jwtLib.sign({
        secret: config.security.jwtSecret,
        expiresIn: config.security.jwtExpiry,
        claims: {
          userId: fresh.id,
          username: fresh.username,
          role: fresh.role,
          passwordChangedAt: fresh.passwordChangedAt,
        },
      });
      res.cookie(COOKIE_NAME(config), token, {
        ...cookieOptions(config),
        maxAge: expiryToMs(config.security.jwtExpiry),
      });
      audit.record({
        actor: req.user.id,
        category: 'auth',
        action: 'change-password',
        target: req.user.username,
        outcome: 'ok',
      });
      res.json({ ok: true, user: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
