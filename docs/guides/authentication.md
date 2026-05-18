---
title: Authentication
layout: default
parent: Guides
nav_order: 3
permalink: /docs/guides/authentication/
---

<!-- markdownlint-disable MD013 MD033 MD060 -->

# Authentication

{: .no_toc }

How patchpanel authenticates requests — the three auth strategies,
local passwords, API tokens, the first-run setup wizard, the JWT
lifecycle, and locked-admin recovery.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## Overview

Patchpanel has one auth gate (`server/src/middleware/auth.js`) with
three strategies, selected via `auth.strategy` in `config.yaml`:

| Strategy     | When to use                    | What gates a request                                                                       |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `local`      | Standalone Debian (default)    | Cookie session **OR** Bearer API token. Login page reachable at `/login`.                  |
| `ha-ingress` | Home Assistant add-on          | Source IP in `server.trustProxy` (HA supervisor) **OR** Bearer API token. No login screen. |
| `none`       | Dev only — never in production | Bypass entirely; every request authenticated as anonymous admin. Logs a startup warning.   |

Unknown / unset → fail-secure to `local`.

A separate concept, `mode` (`homeassistant` | `standalone`), is
deployment-context only. It drives default paths and the migrator's
templating — it does NOT gate auth.

## Local strategy (default)

### Username + password rules

- **Username** — `/^[a-z][a-z0-9._-]{1,31}$/` — starts with a letter,
  2–32 chars of lowercase letters/digits/dot/underscore/hyphen.
- **Password** — minimum 8 chars, maximum 256. No complexity rules at
  the schema level — pick something your password manager can store.
- **Single role** — every user is `admin`. patchpanel's surface is
  small enough that finer-grained roles aren't worth the cost.

### Session cookies

`POST /api/auth/login` issues a JWT in an httpOnly cookie (default name
`patchpanel.sid`):

```js
{
  sub: <user id>,
  username: <name>,
  role: 'admin',
  pwAt: <ISO timestamp of last password change>,
}
```

- **Algorithm:** HS256, signed with `security.jwtSecret`.
- **Issuer / audience:** `patchpanel` / `patchpanel-ui`.
- **Expiry:** `security.jwtExpiry` (default `24h`). Cookie `maxAge` parsed
  from the same string.
- **Cookie flags:** `httpOnly: true`, `secure: true` (HTTPS only),
  `sameSite: lax`, `path: /`.
- **JWT secret minimum length:** 32 characters. The postinst
  generates 32 hex bytes via `openssl rand`; the migrator does the
  same belt-and-suspenders on first start.

### Password-change invalidation

`PUT /api/auth/change-password` (session-only) verifies the current
password, hashes the new one, and **bumps `passwordChangedAt`**. Every
existing JWT for that user fails its next verify because the `pwAt`
claim no longer matches. The endpoint also re-mints a fresh JWT for
the active browser so you stay logged in on the device you used.

This is why API tokens don't have a `change-password` analog — the
JWT invalidation mechanic only applies to cookie sessions.

### Timing-attack mitigation

`lib/users.js` precomputes a single bcrypt hash (`'this-is-never-a-real-password'`)
and compares against it whenever a login attempt names an unknown
user. Both branches do equivalent bcrypt work, so an attacker can't
enumerate valid usernames via response timing.

### Login endpoints

| Endpoint                        | Auth                | What it does                                                                                                          |
| ------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login`          | public              | Verify password, mint JWT, set cookie. 401 on bad creds (audited).                                                    |
| `POST /api/auth/logout`         | cookie-session only | Clear the cookie. Idempotent. API-token callers get 403 — revoke tokens via `DELETE /api/api-tokens/{keyId}` instead. |
| `GET /api/auth/whoami`          | public probe        | Returns `{authenticated: false}` or `{authenticated: true, source, user}`. Never 401s.                                |
| `PUT /api/auth/change-password` | cookie-session only | Verify current, hash new, bump `pwAt`.                                                                                |

## API tokens (programmatic auth)

For scripts, CI pipelines, monitoring exporters, and any non-browser
caller.

### Wire format

```text
pp_<8-hex-keyId>.<32-hex-secret>
```

Examples: `pp_a1b2c3d4.0123456789abcdef0123456789abcdef`.

- **`pp_` prefix** — distinguishes patchpanel tokens from other Bearer
  tokens in the wild.
- **`<keyId>`** — 8 hex chars (4 random bytes), the public identifier.
  Allows O(1) lookup before bcrypt-compare.
- **`<secret>`** — 32 hex chars (16 random bytes). Hashed at rest with
  bcrypt; the plaintext is **never** stored.

### Mint, list, revoke

| Endpoint                         | Body                 | Returns                                                                                      |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `POST /api/api-tokens`           | `{name, expiresAt?}` | `{token, wire}` — **`wire` is returned exactly once**. Copy it now or mint a new one.        |
| `GET /api/api-tokens`            | —                    | `{tokens: [{keyId, name, createdAt, expiresAt, lastUsedAt, createdBy}]}` — no secrets, ever. |
| `DELETE /api/api-tokens/{keyId}` | —                    | `{ok: true}` — that token starts returning 401 immediately.                                  |

All admin-only (cookie session OR Bearer token whose role is admin —
which is every patchpanel token).

### Use

Send as a Bearer header on every API call:

```bash
curl -H "Authorization: Bearer pp_a1b2c3d4.0123456789abcdef0123456789abcdef" \
     https://patchpanel.example.com:8099/api/state
```

Failed Bearer attempts get audited (`category: auth, action: bearer-fail`)
so brute-force is visible in the audit log.

### `lastUsedAt` tracking

Every successful token verify writes a `lastUsedAt` bump
fire-and-forget. The request doesn't wait for the disk write —
patchpanel just records the timestamp for the Profile UI's per-token
freshness column.

### Temp tokens (Swagger UI)

`POST /api/api-tokens/temp` mints a short-lived token (1 hour, auto-named
`swagger-temp-<8hex>`) for use in the **in-app** Swagger UI's
"Authorize" modal. Same wire format, same bcrypt-at-rest, same one-shot
reveal — just expires fast so you don't have a long-lived token from
casual API exploration.

The "Generate temp token" button in the Swagger UI calls this
endpoint and pastes the wire format directly into the bearer field.

### Capability flags

`GET /api/api-tokens/swagger-config` returns:

```json
{
  "tokens": [...],
  "swaggerConfig": {
    "allowFullKeyRetrieval": false,
    "allowTempKeyGeneration": true,
    "tempKeyExpirationHours": 1
  }
}
```

`allowFullKeyRetrieval` is **permanently false** in patchpanel.
Bcrypt at rest = no plaintext recovery path exists. If you lose a
token's wire format, mint a new one and revoke the old.

## ha-ingress strategy

For the Home Assistant addon. HA's supervisor proxies requests to the
addon; patchpanel trusts the proxy by source IP.

### Trust gate

```yaml
server:
  trustProxy:
    value: ['172.30.32.2/32'] # the HA supervisor's address
```

The auth middleware reads `req.socket.remoteAddress` (the TCP peer)
and checks for an exact match against entries in `trustProxy`. Only
`/32` (IPv4) or `/128` (IPv6) entries are matched — wider CIDR
ranges aren't supported for the ingress gate. The Express `trust proxy`
setting handles `X-Forwarded-For` unwinding for `req.ip` separately.

If the source IP matches, patchpanel synthesises a user from HA's
`X-Remote-User-*` headers:

```js
{
  id: 'ingress',
  username: req.get('X-Remote-User-Name') ?? 'ingress',
  displayName: req.get('X-Remote-User-Display-Name') ?? null,
  role: 'admin',
  source: 'ingress',
}
```

The username is informational only — HA already authenticated the user
upstream.

### Fallback to Bearer

If the source IP doesn't match (because you're hitting the addon from
outside the HA ingress proxy), Bearer tokens still work:

```bash
curl -H "Authorization: Bearer pp_xxx" \
     https://home-assistant.local:8099/api/state
```

This is how external automation gets to a patchpanel running inside
HA — mint a token via the in-app UI, then call it directly.

There's no cookie session in this mode. No login screen. No password
to forget.

### Frontend awareness

The React app probes `/api/auth/whoami` on mount and gets back
`{authenticated: true, source: 'ingress', ...}`. The user menu in the
nav hides itself when `source === 'ingress'` — there's nothing to log
out of, no password to change.

## "none" strategy

Dev only. Every request gets `req.user = {id: 'anonymous', role: 'admin', source: 'none'}`.

Boot-time warning:

```text
auth.strategy=none — authentication is DISABLED. Never use this on a network-exposed deployment.
```

Useful for hacking on patchpanel against a local HAProxy on a dev
machine. **Never** on anything reachable from the internet or a shared
network.

## First-run setup wizard

The wizard is gated by **both** conditions holding:

1. `setup.token` file exists on disk (postinst generates it on fresh
   install).
2. `users.json` has zero users.

Either alone is insufficient — prevents stale-token replay AND prevents
racing the wizard on an installed-but-never-opened deployment.

### Flow

```text
1. postinst → openssl rand -hex 32 > /etc/patchpanel/setup.token  (mode 0600)
2. Operator opens https://host:8099/setup-admin?token=<token>
3. SetupAdminPage probes GET /api/setup/status
   -> {needsSetup: true, hasToken: true, userCount: 0}
4. Operator submits username + password
5. POST /api/setup/complete  body: {token, username, password}
6. Server:
   - timingSafeEqual against /etc/patchpanel/setup.token contents
   - Re-check userCount === 0
   - createUser({username, password, role: 'admin'})
   - fs.rm(setup.token, {force: true})
   - Sign JWT, set cookie
   - Return 201 {user}
7. Browser navigated to /
```

Endpoints involved:

| Endpoint                   | Auth   | Purpose                                                    |
| -------------------------- | ------ | ---------------------------------------------------------- |
| `GET /api/setup/status`    | public | `{needsSetup, hasToken, userCount}` — drives the wizard UI |
| `POST /api/setup/complete` | public | One-shot — consumes token, creates first admin             |

### Error responses

- **401 `invalid-token`** — token didn't match (audited).
- **401 `setup is not available`** — token file missing.
- **401 `setup has already been completed`** — `userCount > 0` (audited).
- **400 `ValidationError`** — missing/non-string fields.

After successful completion, **the token file is deleted**. Re-opening
`/setup-admin` gets you the "Setup already complete" message with a
pointer to the CLI for recovery.

## Role model and guards

Patchpanel has one role: `admin`. Three middleware guards apply role
gates:

| Middleware          | What it requires                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requireRole(role)` | `req.user.role === role` OR `req.user.role === 'admin'`. Admin passes any check.                                                                                                    |
| `requireAdmin`      | Shorthand for `requireRole('admin')`.                                                                                                                                               |
| `requireSession`    | Refuses API-token callers (`req.user.source === 'token'` → 403). Used on `/api/auth/logout` and `/api/auth/change-password` — operations that only make sense for browser sessions. |

API tokens can't logout (revoke via `DELETE /api/api-tokens/{keyId}`)
and can't change passwords (no concept of "the token's password").

## PUBLIC_PATHS whitelist

Routes that bypass the auth check entirely:

| Path                  | Reason                                                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/health`             | Liveness probe for HA addon watchdog, k8s, uptime monitors                                                                                                                                                           |
| `/api/auth/login`     | The login form posts here — no session yet                                                                                                                                                                           |
| `/api/auth/whoami`    | SPA probes this on mount; must answer without 401                                                                                                                                                                    |
| `/api/setup/status`   | First-run wizard / LoginPage need to check on boot                                                                                                                                                                   |
| `/api/setup/complete` | First-run wizard consumes the token — no session yet                                                                                                                                                                 |
| `/api/openapi.json`   | OpenAPI spec is public so the GH Pages static export + curl/automation can read it without holding a session or token. Spec describes interface, not data — every endpoint it documents still enforces its own auth. |
| `/api/client-errors`  | Client-side error reports need to ship from pre-auth paths too (login page, ingress probe failures). Volume capped client-side via debounce + queue limit; global rate limiter handles abuse.                        |

Anything not under `/api/*` is also implicitly public (the SPA bundle:
HTML, JS, CSS, images, the swagger-ui dist). The SPA itself does
client-side routing to `/login` when `/api/auth/whoami` returns
`authenticated: false`.

## Frontend auth lifecycle

```text
1. App mount → AuthProvider initializes
2. AuthProvider effect → GET /api/auth/whoami
3. Result:
   - {authenticated: false}  → state = unauthenticated
   - {authenticated: true, source: 'session', user}    → cookie session
   - {authenticated: true, source: 'token', user}      → Bearer (rare in SPA)
   - {authenticated: true, source: 'ingress', user}    → HA ingress
4. ProtectedRoute checks auth state:
   - loading           → spinner
   - !authenticated    → <Navigate to=`/login?return=${pathname}` replace />
   - authenticated     → render children
5. On 401 response from any apiGet/apiPost:
   - If path is in NO_REDIRECT_PATHS (whoami, login, setup) — surface error
   - Else — window.location.replace(`/login?return=<encoded>`)
```

The `source` field drives small UI variations: the user menu hides
itself entirely in `ingress` mode; `token` source is rare for SPA
mounts but handled gracefully.

`LoginPage` first checks `/api/setup/status`; if `needsSetup: true` it
redirects to `/setup-admin` — operators landing on `/login` for a
fresh install get bounced to the right place automatically.

## CLI recovery flows

The `patchpanel` CLI bypasses the HTTP auth chain entirely — shell
access on the host is itself proof of authority.

### Lost admin password

```bash
sudo patchpanel user-reset --username admin
```

Prompts for the new password on stderr. Or pipe-friendly:

```bash
echo -n 'NewPass!23' | sudo patchpanel user-reset --username admin --stdin-password
```

Skips the current-password check. Bumps `passwordChangedAt` —
**every other JWT for that user invalidates on the next request**.
Stderr output:

```text
Password reset. All existing sessions for this user are now invalid.
```

### Need a second admin

```bash
sudo patchpanel user-add --username admin2
```

Same prompt-on-stderr UX. Creates a `role: admin` user. Bypasses the
setup-token gate entirely — no HTTP, just a direct write to
`users.json`.

### Token housekeeping

API tokens don't have a CLI yet. Mint, list, and revoke via:

- `POST /api/api-tokens` — from the Profile page UI, or curl
- `GET /api/api-tokens` — Profile page UI shows the list
- `DELETE /api/api-tokens/{keyId}` — Profile page revoke button

If your admin is locked out AND you need to delete tokens, recover
admin access first via `user-reset`, then revoke through the UI.

## Security model

| Surface                   | What protects it                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Browser session cookie    | `httpOnly` (no JS access), `sameSite: lax` (most CSRF blocked), `secure: true` (HTTPS only), JWT signature, `pwAt` claim freshness       |
| API tokens                | Bcrypt-hashed at rest, one-shot wire reveal, mandatory `requireAdmin` gate, audit log on every use                                       |
| Failed-auth visibility    | Every failed login + failed Bearer + failed setup-token attempt records to the audit log                                                 |
| Brute-force rate-limiting | `rateLimit.authMax` / `rateLimit.authWindowMs` (default 25 req / 15 min) on auth endpoints                                               |
| Username enumeration      | Dummy bcrypt hash on missing-user path equalises response time                                                                           |
| CSRF on cookie routes     | Lusca CSRF on cookie-authenticated mutations; bypassed for `/api/*` (JSON bodies + Bearer auth model)                                    |
| TLS for the UI            | `ssl.minVersion: TLSv1.2`, `ssl.maxVersion: TLSv1.3`, ECDHE-only ciphers, HSTS enabled                                                   |
| At-rest secrets           | `users.json` + `api-tokens.json` + `.jwt-secret` + `setup.token` all mode 0600                                                           |
| Denied request shape      | Content-negotiated: SSE → 401 streaming, HTML → 302 to `/login?return=`, else → 401 JSON + `WWW-Authenticate: Bearer realm="patchpanel"` |

## Configuration reference

The auth-related keys in `config.yaml`:

```yaml
auth:
  strategy:
    value: local # 'none' | 'ha-ingress' | 'local'

server:
  trustProxy:
    value: ['172.30.32.2/32'] # ha-ingress trust gate
  ingressPathHeader:
    value: X-Ingress-Path # HA ingress URL prefix header

security:
  jwtSecret:
    value: __JWT_SECRET_FROM_FILE__ # auto-generated by postinst + migrator
  jwtExpiry:
    value: 24h
  sessionCookieName:
    value: patchpanel.sid
  sessionSecure:
    value: true
  sessionSameSite:
    value: lax
  bcryptRounds:
    value: 12

paths:
  users:
    value: /var/lib/patchpanel/users.json
  apiTokens:
    value: /var/lib/patchpanel/api-tokens.json
  setupToken:
    value: /etc/patchpanel/setup.token

rateLimit:
  authWindowMs:
    value: 900000 # 15 minutes
  authMax:
    value: 25
```

See [Configuration](../configuration/) for the full reference.

## See also

- [Getting Started](getting-started/) — first-run admin walkthrough
- [Backend Integration](backend-integration/) — minting + using tokens from scripts
- [API examples](api-examples/) — curl recipes for every auth endpoint
- [Configuration](../configuration/) — every key in `config.yaml`
