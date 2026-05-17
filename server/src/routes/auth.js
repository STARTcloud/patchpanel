import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { AuthError, ValidationError } from '../lib/errors.js';
import * as jwtLib from '../lib/jwt.js';
import * as logger from '../lib/logger.js';
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

  // POST /api/auth/login
  // Public (whitelisted in auth middleware). Verifies password, mints JWT,
  // sets the session cookie. Body: { username, password }.
  router.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') {
        throw new ValidationError('username and password are required');
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
        throw new AuthError('invalid credentials');
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
      logger.info('login ok', { username: user.username, ip: req.ip });
      res.json({
        user: { id: user.id, username: user.username, role: user.role, source: 'session' },
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/logout
  // Clears the session cookie. Idempotent — returns 200 even if no cookie was set.
  // Forbidden for API tokens (those revoke via DELETE /api/api-tokens/:id).
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

  // GET /api/auth/whoami
  // Public probe — returns the current auth state without 401-ing on no-auth.
  // The SPA uses this on mount to decide between rendering the app vs.
  // redirecting to /login. Three shapes:
  //   { authenticated: false }                     — no session, no token
  //   { authenticated: true, user: {...}, source } — session, token, or ingress
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

  // PUT /api/auth/change-password
  // Session-only (admins use the UI). Body: { currentPassword, newPassword }.
  // Note: changing the password bumps passwordChangedAt, which invalidates
  // every existing JWT on the next request. The current request's response
  // sets a fresh cookie so the active browser stays logged in.
  router.put('/auth/change-password', requireSession, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        throw new ValidationError('currentPassword and newPassword are required');
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
