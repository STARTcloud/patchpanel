# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in PatchPanel, please report it
through a private channel:

### Preferred Method: Security Advisory

1. Go to the [GitHub Security Advisory page](https://github.com/STARTcloud/patchpanel/security/advisories)
2. Click "Report a vulnerability"
3. Fill out the advisory form with detailed information
4. Submit the advisory

### What to include

- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** of the vulnerability
- **Affected versions** (if known)
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up questions

## Response Process

Maintained as a side-project with limited resources. Realistic timeline:

- **Initial response**: 48–72 hours
- **Assessment**: within 1 week
- **Resolution**: typically 1–4 weeks depending on severity
- **Disclosure**: coordinated, after a fix is available

### Severity levels

- **Critical**: RCE, privilege escalation. Immediate attention.
- **High**: authentication bypass, key disclosure, data exfiltration. Days.
- **Medium**: DoS, information disclosure. Standard timeline.
- **Low**: minor information leaks. Lower priority.

## High-risk surface areas

PatchPanel renders configuration for HAProxy — a TLS-terminating reverse
proxy that frequently sits on a public IP — and reloads it via HAProxy's
master control socket. The blast radius of a PatchPanel vulnerability is
the same as HAProxy's blast radius. Special attention to:

- **HAProxy config injection** — any path that lets unprivileged input land
  in the rendered `haproxy.cfg` without escaping (ACL values, header names,
  regex bodies, hostnames, server addresses)
- **Master CLI socket access** — unauthorized reloads, server-state
  changes, or stick-table mutations via `/run/haproxy-master.sock`
- **Certificate / key handling** — path traversal in BYO cert / trusted CA /
  CRL uploads; private key disclosure via the cfg-render endpoint or
  audit log
- **API key authentication** — bcrypt-bypass, expired-key acceptance,
  permission-scope confusion
- **ACME challenge endpoints** — path traversal in `/.well-known/`,
  spoofed validation responses
- **Command execution** — PatchPanel shells out to `certbot`, `haproxy -c`,
  `openssl`, and the OS toolchain. Argument-injection surface lives there
- **State document validation** — Zod-schema bypass that lets a malformed
  state through validation but crashes `haproxy -c`

## Security posture by deployment surface

PatchPanel runs in two modes. The threat model differs.

### Home Assistant add-on mode

The PatchPanel HTTP server speaks **plain HTTP** on a Docker-internal port
and is reached only through the supervisor's ingress proxy. TLS, public
exposure, authentication, and access control are HA's responsibility. The
add-on:

- Trusts the supervisor proxy IP via `app.set('trust proxy', ...)`
- Reads `X-Ingress-Path` for asset URL prefixing
- Reads `X-Remote-User-*` for audit-log attribution
- Runs **no local authentication**, **no session cookies**, **no CSRF
  middleware**, **no first-run wizard**

Misconfiguring `trust proxy` or exposing the add-on's internal port outside
the supervisor breaks the security model.

### Standalone Debian package mode

PatchPanel terminates its own TLS and runs its own auth. The intended
hardening (some implemented today, some on the roadmap):

| Area               | Implementation                                                                        | Status      |
| :----------------- | :------------------------------------------------------------------------------------ | :---------- |
| TLS bootstrap      | Self-signed cert generated via `openssl req -x509 -nodes -days 365 -newkey rsa:2048`  | Planned     |
| TLS hardening      | `minVersion: TLSv1.2`, `maxVersion: TLSv1.3`, ECDHE-only ciphers, `honorCipherOrder`  | Planned     |
| HSTS / CSP / frame | `helmet` with CSP, HSTS (max-age + includeSubDomains + preload), X-Frame-Options DENY | Planned     |
| Session auth       | `express-session` + `better-sqlite3` store, httpOnly + Secure + SameSite=Lax cookie   | Planned     |
| API key auth       | `bcrypt` cost 12, per-key permission scopes, optional ≤1-year expiry, 8-char preview  | Planned     |
| Retrievable keys   | Optional AES-256-CBC encrypted full-key column (off by default)                       | Planned     |
| Password hashing   | `bcrypt` cost 12 for the local admin                                                  | Planned     |
| CSRF               | `lusca.csrf()` gated to cookie-authenticated routes (skipped for Bearer + GET + SSE)  | Planned     |
| CORS               | `cors` package with whitelist origin array, `credentials: true`                       | Planned     |
| Rate limiting      | `express-rate-limit` tiered: auth-strict, write, read-permissive                      | Planned     |
| Input validation   | `zod` schemas at every API entry point + state-document schema                        | Partial     |
| First-run gate     | Setup-only mode until `/etc/patchpanel/setup.token` is consumed; timing-safe compare  | Planned     |
| Audit log          | Every state mutation persisted to `audit.sqlite` with actor + outcome                 | Implemented |
| HAProxy validation | `haproxy -c` against rendered cfg before atomic swap                                  | Implemented |
| Path traversal     | All cert / CA / CRL paths resolved + bounded to dedicated directories                 | Implemented |

"Partial" for input validation = the HAProxy state document is fully
Zod-validated today; the rest of the API surface validates ad-hoc.

The "Planned" rows correspond to roadmap items tracked in
[GitHub Issues](https://github.com/STARTcloud/patchpanel/issues) under
the `security` label. Until they land, **run standalone PatchPanel behind
a trusted network** or another reverse proxy that does TLS / auth for you.

## Hardening recommendations for operators

- Keep PatchPanel updated. Subscribe to releases.
- Run on the latest LTS Node.js — current target is Node 22+.
- Use a real (Let's Encrypt) cert for the management UI itself, not the
  self-signed bootstrap.
- Restrict network access to the management port. Even with auth, the
  smaller the exposure the better.
- Rotate API keys at least annually; set the shortest practical expiry.
- Grant the narrowest permissions an integration needs. A read-only key
  is harmless if leaked; a `haproxy-control` key is not.
- Watch the audit log for unexpected key usage.

## Hall of fame

Contributors who responsibly report security vulnerabilities will be
acknowledged here (with their permission):

- No vulnerabilities reported yet.

## Updates to this policy

This security policy may be updated as the project evolves. Check back
periodically.
