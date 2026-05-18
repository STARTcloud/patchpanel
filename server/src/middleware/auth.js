import * as audit from '../lib/audit.js';
import { errorResponse } from '../lib/api-response.js';
import { AuthError } from '../lib/errors.js';
import * as jwtLib from '../lib/jwt.js';
import { log } from '../lib/logger.js';
import { recordTokenUse, verifyToken } from '../lib/api-tokens.js';
import { getInternal as getUserInternal } from '../lib/users.js';

// Unified auth middleware. The primary gate is `auth.strategy`:
//
//   none       — bypass entirely. Anonymous admin user is synthesised.
//                Intended for development against a host that isn't behind
//                HA ingress and where you haven't run the setup wizard.
//                NEVER set this on a network-exposed deployment.
//
//   ha-ingress — trust the upstream HA supervisor proxy. The request is
//                accepted iff its source IP is in server.trustProxy
//                (typically `172.30.32.2/32`). Bearer API tokens still
//                work for out-of-ingress scripts. Cookie sessions are
//                unused — there's no login screen in this mode.
//
//   local      — local password (cookie session) + Bearer API tokens.
//                The standalone Debian default.
//
// `mode` (homeassistant | standalone) is *deployment context* — it drives
// path defaults (paths.options, paths.state, etc.) and informs configMigrator
// templating. It is NOT consulted here; the strategy alone gates auth.
//
// Public path whitelist: routes the SPA needs to reach unauthenticated
// (login form, whoami probe, first-run wizard). Everything else under
// /api/* requires successful auth.

const PUBLIC_PATHS = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/whoami',
  '/api/setup/status',
  '/api/setup/complete',
  // OpenAPI spec is public so the GH Pages static export + curl/automation
  // can read it without holding a session or token. The spec describes the
  // interface, not data — every endpoint it documents still enforces its own
  // auth. Mirrors armor/zoneweaver pattern.
  '/api/openapi.json',
  // Client-error reports must accept unauthenticated POSTs — errors on the
  // login page (or any pre-auth path) need to ship too. Volume is capped
  // client-side via debounce + queue limit, and the global rate limiter
  // provides abuse protection. See routes/client-errors.js.
  '/api/client-errors',
]);

const isPublicPath = path => {
  if (PUBLIC_PATHS.has(path)) {
    return true;
  }
  // Anything not under /api/* is the SPA bundle (HTML, JS, CSS, assets).
  // The SPA itself probes /api/auth/whoami at boot to find out whether
  // there's a session; if not, it routes to /login on the client.
  if (!path.startsWith('/api/')) {
    return true;
  }
  return false;
};

const matchesTrustedSource = (req, allow) => {
  if (!Array.isArray(allow) || allow.length === 0) {
    return false;
  }
  const addr = req.socket?.remoteAddress;
  if (!addr) {
    return false;
  }
  // Crude IP match against /32 (IPv4) or /128 (IPv6) entries. CIDR
  // ranges wider than /32 aren't supported here — Express's `trust proxy`
  // setting handles X-Forwarded-For unwinding for downstream req.ip,
  // but we read socket.remoteAddress directly to identify the TCP peer
  // (HA supervisor) regardless of any forwarded-for chain.
  return allow.some(entry => {
    const stripped = entry.replace(/\/32$/u, '').replace(/\/128$/u, '');
    return addr === stripped;
  });
};

const ingressUser = req => ({
  id: 'ingress',
  username: req.get('X-Remote-User-Name') ?? 'ingress',
  displayName: req.get('X-Remote-User-Display-Name') ?? null,
  role: 'admin',
  source: 'ingress',
});

const tryCookieJwt = async (req, config) => {
  const cookieName = config.security?.sessionCookieName ?? 'patchpanel.sid';
  const token = req.cookies?.[cookieName];
  if (!token) {
    return null;
  }
  let decoded;
  try {
    decoded = jwtLib.verify(token, config.security.jwtSecret);
  } catch (err) {
    if (err instanceof AuthError) {
      return null;
    }
    throw err;
  }
  const user = await getUserInternal(config.paths.users, decoded.sub);
  if (!user) {
    return null;
  }
  // Invalidate JWTs issued before the user's most recent password change.
  const issuedPwAt = decoded.pwAt;
  if (issuedPwAt !== user.passwordChangedAt) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    source: 'session',
  };
};

const tryBearerToken = async (req, config) => {
  const header = req.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const wire = header.slice(7).trim();
  const row = await verifyToken(config.paths.apiTokens, wire);
  if (!row) {
    // Audit the failed attempt — symmetric with failed-login auditing.
    audit.record({
      actor: null,
      category: 'auth',
      action: 'bearer-fail',
      outcome: 'fail',
      details: { ip: req.ip },
    });
    return null;
  }
  // Fire-and-forget — don't block the request on the lastUsedAt write.
  recordTokenUse(config.paths.apiTokens, row.keyId).catch(err =>
    log.auth.warn('recordTokenUse failed', { keyId: row.keyId, error: err.message })
  );
  return {
    id: row.keyId,
    username: row.name,
    role: 'admin',
    source: 'token',
    tokenId: row.keyId,
  };
};

const denyOrLogin = (req, res, ingressPath) => {
  const accept = req.get('accept') ?? '';
  if (accept.includes('text/event-stream')) {
    res.set('content-type', 'text/event-stream');
    res.status(401).end('authentication required\n');
    return;
  }
  if (accept.includes('text/html')) {
    const ret = encodeURIComponent(req.originalUrl);
    const loginUrl = `${ingressPath || ''}/login?return=${ret}`;
    res.redirect(302, loginUrl);
    return;
  }
  res.set('www-authenticate', 'Bearer realm="patchpanel"');
  res.status(401).json(errorResponse(req, 'auth.required'));
};

const resolveStrategy = config => {
  const s = config.auth?.strategy;
  if (s === 'none' || s === 'ha-ingress' || s === 'local') {
    return s;
  }
  // Unknown / unset → fail-secure: require login.
  return 'local';
};

export const authMiddleware = config => {
  if (config.auth?.strategy === 'none') {
    log.auth.warn(
      'auth.strategy=none — authentication is DISABLED. Never use this on a network-exposed deployment.'
    );
  }

  return async (req, res, next) => {
    const ingressPathHeader = config.server?.ingressPathHeader;
    req.ingressPath = ingressPathHeader ? (req.get(ingressPathHeader) ?? '') : '';

    try {
      const strategy = resolveStrategy(config);

      // ── 'none' ─────────────────────────────────────────────────────────
      if (strategy === 'none') {
        req.user = {
          id: 'anonymous',
          username: 'anonymous',
          role: 'admin',
          source: 'none',
        };
        next();
        return;
      }

      // ── 'ha-ingress' ────────────────────────────────────────────────────
      // Trusted source IP wins. Bearer tokens still work for external
      // automation that doesn't go through the HA supervisor proxy.
      // No cookie path — there's no login screen in this mode.
      if (strategy === 'ha-ingress') {
        if (matchesTrustedSource(req, config.server?.trustProxy ?? [])) {
          req.user = ingressUser(req);
          next();
          return;
        }
        const tokenUser = await tryBearerToken(req, config);
        if (tokenUser) {
          req.user = tokenUser;
          next();
          return;
        }
        if (isPublicPath(req.path)) {
          req.user = null;
          next();
          return;
        }
        denyOrLogin(req, res, req.ingressPath);
        return;
      }

      // ── 'local' ─────────────────────────────────────────────────────────
      // Cookie session OR Bearer token. Login page reachable at /login.
      const sessionUser = await tryCookieJwt(req, config);
      if (sessionUser) {
        req.user = sessionUser;
        next();
        return;
      }
      const tokenUser = await tryBearerToken(req, config);
      if (tokenUser) {
        req.user = tokenUser;
        next();
        return;
      }
      if (isPublicPath(req.path)) {
        req.user = null;
        next();
        return;
      }
      denyOrLogin(req, res, req.ingressPath);
    } catch (err) {
      next(err);
    }
  };
};

// Role guard. Apply on routes that need elevated permission beyond
// "authenticated". v1 only has `admin`, but the shape supports more.
export const requireRole = role => (req, res, next) => {
  if (!req.user) {
    next(new AuthError('auth.required'));
    return;
  }
  if (req.user.role !== role && req.user.role !== 'admin') {
    res.status(403).json(errorResponse(req, 'auth.roleRequired', { role }));
    return;
  }
  next();
};

export const requireAdmin = requireRole('admin');

// Forbid API-token-authenticated requests on a specific endpoint. Used for
// session-management routes that don't make sense for non-browser callers
// (logout, change-password). Tokens are revoked via DELETE /api/api-tokens/:id.
export const requireSession = (req, res, next) => {
  if (!req.user) {
    next(new AuthError('auth.required'));
    return;
  }
  if (req.user.source === 'token') {
    res.status(403).json(errorResponse(req, 'auth.forbidden.sessionOnly'));
    return;
  }
  next();
};
