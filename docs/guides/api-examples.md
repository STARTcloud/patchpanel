---
title: API Examples
parent: Guides
nav_order: 6
permalink: /docs/guides/api-examples/
---

<!-- markdownlint-disable MD013 MD033 MD060 -->

# API Examples

{: .no_toc }

A copy-pasteable curl reference for every patchpanel HTTP API endpoint. Examples assume
an operator with a freshly minted admin API token and a base URL of
`https://patchpanel.example.com:8099`. Adjust hostnames and IDs to match your deployment.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## Setup

Most examples authenticate with a Bearer API token stored in `PP_TOKEN`. Mint a token
through the UI (Settings > API Tokens) or via `POST /api/api-tokens`. The plaintext
wire form is shown **only once** at mint time — store it immediately.

```bash
export PP_TOKEN="pp_a1b2c3d4.0123456789abcdef0123456789abcdef"
```

The wire format is `pp_<8 hex>.<32 hex>`. The first segment is the public key id, the second is the secret. Both halves are required.

{: .warning }

> The full wire string is returned only at the moment of mint. The server stores a
> bcrypt hash and cannot reveal it again. Lose it and you must revoke and mint a new one.

## Conventions

- **Base URL**: every example uses `https://patchpanel.example.com:8099`. Replace with your host.
- **Silence**: `-s` suppresses the curl progress meter so you can pipe to `jq`.
- **JSON inspection**: pipe `-s` output through `jq` to pretty-print. Drop the pipe to see raw bytes.
- **Session cookies**: flows that depend on the `patchpanel.sid` cookie use `-c cookies.txt`
  to capture and `-b cookies.txt` to send. The cookie is `httpOnly` and `Secure` in production.
- **Peer-to-peer**: server-to-server calls under `/api/peer/*` (singular) use `$PEER_RAW_TOKEN`,
  which is the raw inbound token minted by the remote peer. It has **no** `pp_` prefix.
- **TLS**: production deployments terminate TLS via patchpanel itself. Self-signed certs may need `--cacert` or (for local testing only) `-k`.

## Authentication summary

Patchpanel accepts three credential sources. The middleware checks them in this order: session cookie, Bearer API token, ingress header.

| Source    | Header / cookie                             | Typical use                       | Public probe                                       |
| --------- | ------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| Session   | `Cookie: patchpanel.sid=...`                | Browser UI, interactive operators | `GET /api/auth/whoami` returns `source: "session"` |
| API token | `Authorization: Bearer pp_<keyId>.<secret>` | Automation, Swagger, scripts      | `source: "token"`                                  |
| Ingress   | `X-Ingress-Token` (set by HA supervisor)    | Home Assistant sidecar UI         | `source: "ingress"`                                |
| Anonymous | none                                        | Public endpoints only             | `source: "none"`                                   |

{: .warning }

> Cluster peer endpoints are different. `/api/peers/*` (plural) is the operator-facing
> CRUD and uses a normal `Bearer pp_<keyId>.<secret>` admin token. `/api/peer/*` (singular)
> is the peer-to-peer machine surface and uses the **RAW inbound token** as `Bearer <token>` —
> no `pp_` prefix, no key-id split. See section 7 for full detail.

**Public paths** (no auth required):

- `GET /health`
- `GET /openapi.json`
- `GET /api/setup/status`
- `POST /api/setup/complete`
- `POST /api/auth/login`
- `GET /api/auth/whoami`
- `POST /api/client-errors`

**Session-only paths** (return 403 if presented an API token):

- `POST /api/auth/logout`
- `PUT /api/auth/change-password`

**Admin-only paths** (require `role: "admin"`):

- `/api/api-tokens/*`
- `/api/config/*`

## Error envelope

Every error response uses a consistent JSON shape. Field presence depends on the failure mode.

| HTTP | Meaning                                           | Envelope shape                                  |
| ---- | ------------------------------------------------- | ----------------------------------------------- |
| 400  | Bad input shape (non-Zod), missing required field | `{error: "..."}`                                |
| 401  | No credentials, or credentials invalid            | `{error: "Unauthorized"}`                       |
| 403  | Authenticated but lacks role or wrong auth source | `{error: "Forbidden"}`                          |
| 404  | Resource not found                                | `{error: "Not found"}`                          |
| 409  | State not initialized, or precondition not met    | `{error: "..."}`                                |
| 422  | Zod schema validation failed                      | `{error: "Validation failed", issues: [...]}`   |
| 429  | Rate-limited                                      | `{error: "Too many requests"}`                  |
| 502  | `haproxy -c` rejected rendered config             | `{error: "...", output: "...", hints: ["..."]}` |
| 500  | Server fault (rare)                               | `{error: "..."}`                                |

The full shape is `{error, issues?, output?, hints?, ok?}`. `ok: false` is used by validators that return 200-with-failure (notably `POST /api/byo-certs/validate`).

**Example 422 (Zod validation):**

```json
{
  "error": "Validation failed",
  "issues": [
    {
      "path": ["frontendBlocks", 0, "bindPort"],
      "code": "too_small",
      "message": "Number must be greater than or equal to 1"
    }
  ]
}
```

**Example 502 (haproxy -c failure):**

```json
{
  "error": "haproxy configuration rejected",
  "output": "[ALERT] (1234) : Proxy 'fe_https': unknown backend 'be_missing'\n",
  "hints": ["A frontend references a backend that does not exist in state.backendBlocks."]
}
```

When a 502 fires during `PUT /api/state` or a snapshot restore, the on-disk state is **not** modified — the pipeline atomically rolls back.

---

## 1. Health and Documentation

### GET /health

Liveness probe. Public.

Auth: Public.

```bash
curl -s https://patchpanel.example.com:8099/health | jq
```

Response:

```json
{
  "status": "ok",
  "service": "patchpanel",
  "frontendLogging": {
    "enabled": true,
    "level": "info",
    "categories": {
      "app": true,
      "auth": true,
      "api": true,
      "state": true,
      "haproxy": true,
      "cert": true,
      "peer": true,
      "error": true
    }
  }
}
```

The `frontendLogging` block tells the SPA which log categories to emit back over `POST /api/client-errors`.

#### GET /openapi.json

Full OpenAPI 3.1 spec. Public so Swagger UI can bootstrap before login.

Auth: Public.

```bash
curl -s https://patchpanel.example.com:8099/openapi.json | jq '.paths | keys | length'
```

Pipe through `jq '.paths | keys'` to list every documented route, or feed into `redocly`, `openapi-generator`, etc.

#### POST /api/client-errors

SPA log shipper. Rate-limited. Public so the login page can also report errors.

Auth: Public.

Caps: 200 entries per request, 4096 characters per message, 16 KB per metadata object.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/client-errors \
  -H "Content-Type: application/json" \
  -d '{
    "errors": [
      {
        "ts": 1715900000000,
        "level": "error",
        "category": "app",
        "message": "Uncaught TypeError: cannot read property foo of undefined",
        "metadata": {"route": "/state", "userAgent": "Mozilla/5.0 ..."}
      }
    ],
    "recent": []
  }'
```

`recent` carries the rolling breadcrumb buffer the SPA keeps for context.

---

## 2. Auth, Setup, API Tokens

### GET /api/setup/status

First-boot probe. Tells the SPA whether to render the bootstrap wizard.

Auth: Public.

```bash
curl -s https://patchpanel.example.com:8099/api/setup/status | jq
```

```json
{
  "needsSetup": true,
  "hasToken": false,
  "userCount": 0
}
```

#### POST /api/setup/complete

One-shot bootstrap: consumes the setup token printed to the server log, creates the first admin user, and issues a session cookie.

Auth: Public (token in body proves ownership of the running process).

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/setup/complete \
  -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "token": "setup-1a2b3c4d5e",
    "username": "admin",
    "password": "ChooseAStrongPassword!"
  }'
```

Returns `201 Created` and sets `patchpanel.sid`. Subsequent requests in the same session can use `-b cookies.txt`. The setup token is single-use — once consumed, `needsSetup` flips to `false`.

#### POST /api/auth/login

Local-strategy login. Other strategies (OIDC, Authelia, mTLS) sign in via their own flows.

Auth: Public.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/auth/login \
  -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "ChooseAStrongPassword!"}'
```

On success returns `{ok: true, user: {...}}` and writes the session cookie. On failure returns 401.

#### POST /api/auth/logout

Drops the session.

Auth: Session only. Returns 403 if presented an API token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/auth/logout \
  -b cookies.txt -c cookies.txt
```

Idempotent — calling it without a session still returns 200.

#### GET /api/auth/whoami

Universal probe — works with any credential type. Returns the resolved identity and credential source.

Auth: Public.

```bash
curl -s https://patchpanel.example.com:8099/api/auth/whoami \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "authenticated": true,
  "source": "token",
  "user": { "username": "admin", "role": "admin" }
}
```

`source` is one of `session`, `token`, `ingress`, or `none`.

#### PUT /api/auth/change-password

Rotate the local password. Bumps the user's `pwAt` timestamp, which invalidates every other outstanding JWT for that user.

Auth: Session only. 403 if API-token.

```bash
curl -s -X PUT https://patchpanel.example.com:8099/api/auth/change-password \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "ChooseAStrongPassword!",
    "newPassword": "EvenStronger-2026!"
  }'
```

{: .note }

> Other browser sessions remain valid because they sit on the same `pwAt`. JWTs minted before the change (e.g. for other apps) are invalidated.

#### GET /api/api-tokens

List token metadata. Secrets are bcrypt-hashed at rest and never returned here.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/api-tokens \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

Each entry includes `id`, `name`, `createdAt`, `expiresAt`, `lastUsedAt`, `lastUsedFromIp`, and a `tokenPreview` (first few chars of key id).

#### POST /api/api-tokens

Mint a new token.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/api-tokens \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-deploy-bot", "expiresAt": "2026-12-31T23:59:59Z"}'
```

Returns:

```json
{
  "token": { "id": "tk-a1b2c3d4e5f6", "name": "ci-deploy-bot", "createdAt": "..." },
  "wire": "pp_a1b2c3d4.0123456789abcdef0123456789abcdef"
}
```

{: .warning }

> The plaintext `wire` is shown **only once**. The server stores only a bcrypt hash.
> Capture it immediately into a secret store (HashiCorp Vault, 1Password, GitHub Actions secret, etc.).
> If you lose it, revoke and mint anew.

`expiresAt` is optional. Omit for non-expiring tokens.

#### GET /api/api-tokens/swagger-config

Configuration Swagger UI uses to decide whether it may auto-mint temporary keys for "Try it out".

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/api-tokens/swagger-config \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

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

`allowFullKeyRetrieval: false` is a hard invariant — patchpanel never resurrects a hashed token.

#### POST /api/api-tokens/temp

Mint a 1-hour throwaway token. Used by Swagger UI when an operator clicks "Authorize" without copying a long-lived key.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/api-tokens/temp \
  -H "Authorization: Bearer $PP_TOKEN"
```

```json
{
  "ok": true,
  "token": { "id": "tk-tmp-...", "createdAt": "...", "expiresAt": "..." },
  "wire": "pp_...",
  "expiresAt": "2026-05-17T16:00:00Z"
}
```

Same one-shot disclosure rule as the regular mint.

#### DELETE /api/api-tokens/{keyId}

Revoke a token. Any in-flight requests using it return 401 on next call.

Auth: Bearer admin token.

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/api-tokens/tk-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $PP_TOKEN"
```

---

## 3. State and Snapshots

### GET /api/state

Fetch the full `state.json`. If patchpanel was just installed, returns an empty-shell document with default sections.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/state \
  -H "Authorization: Bearer $PP_TOKEN" > state.json
```

#### PUT /api/state

Replace the entire state document. The most consequential endpoint in the system.

Auth: Bearer admin token.

Pipeline (atomic):

1. Zod-validate the body. Failure -> 422 with `issues[]`, no disk write.
2. Render `haproxy.cfg` to a temp file.
3. Run `haproxy -c` against the temp file. Failure -> 502 with `output` and `hints[]`, no disk write.
4. Atomically swap state.json and haproxy.cfg into place.
5. Reload haproxy via master socket (zero-downtime).
6. On any failure after swap, roll back files and restart from the prior config.
7. On success, write a snapshot and an audit entry.

```bash
curl -s -X PUT https://patchpanel.example.com:8099/api/state \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d @state.json
```

{: .warning }

> A `PUT /api/state` is a full replacement, not a merge. Always `GET` first, edit,
> then `PUT` back. Two operators editing in parallel will lose one of their changes.

#### GET /api/snapshots

List snapshots. Snapshots are taken automatically on every successful `PUT /api/state` and on manual operator action.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/snapshots \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "snapshots": [
    {
      "id": "snap-20260517T143012Z-a1b2",
      "snapshotAt": "...",
      "actor": "admin",
      "reason": "edit:state"
    }
  ]
}
```

#### GET /api/snapshots/{id}

Fetch one snapshot with its full state body.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/snapshots/snap-20260517T143012Z-a1b2 \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

Returns 400 for a malformed id, 404 if the snapshot file is missing.

#### POST /api/snapshots/{id}/restore

Re-apply a snapshot through the same pipeline as `PUT /api/state`. Same 422 / 502 rollback semantics. Audit reason is `restore:<id>`.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/snapshots/snap-20260517T143012Z-a1b2/restore \
  -H "Authorization: Bearer $PP_TOKEN"
```

---

## 4. Certificates

### GET /api/certificates

Joins the certificates declared in state against the on-disk Let's Encrypt lineage directories.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/certificates \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "certs": [
    {
      "id": "cert-prod-public",
      "certName": "prod-public",
      "domains": ["www.example.com", "api.example.com"],
      "providerId": "tls-letsencrypt",
      "providerType": "letsencrypt-dns",
      "isByo": false,
      "lineages": [{ "path": "/etc/letsencrypt/live/prod-public", "expiresAt": "..." }],
      "newest": "..."
    }
  ]
}
```

#### POST /api/certificates/renew

Bulk renew every Let's Encrypt cert. BYO certs are skipped.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/certificates/renew \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": false}'
```

`force: true` ignores the 30-day expiry threshold. Returns 409 if state is not initialized.

#### POST /api/certificates/{id}/renew

Single-cert renew. Same body shape.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/certificates/cert-prod-public/renew \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

#### GET /api/trusted-cas

List trusted CA bundles used by `verify required` frontends.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/trusted-cas \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "trustedCasDir": "/etc/patchpanel/ssl/trusted-cas",
  "files": [{ "id": "corp-root", "uploadedAt": "...", "sizeBytes": 1832 }]
}
```

#### GET /api/trusted-cas/{id}

Download the raw PEM.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/trusted-cas/corp-root \
  -H "Authorization: Bearer $PP_TOKEN" -o corp-root.pem
```

Content-Type: `application/x-pem-file`.

#### POST /api/trusted-cas/validate

Dry-run a PEM. No disk write.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/trusted-cas/validate \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -nR --rawfile pem corp-root.pem '{pem: $pem}')"
```

```json
{
  "ok": true,
  "errors": [],
  "warnings": [],
  "info": {
    "fingerprint": "SHA256:...",
    "subjectSummary": "CN=Corp Root CA, O=Acme",
    "certCount": 1
  }
}
```

#### POST /api/trusted-cas/upload

Write the PEM to `<trustedCasDir>/<id>.pem`.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/trusted-cas/upload \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -nR --rawfile pem corp-root.pem '{id: "corp-root", pem: $pem}')"
```

#### DELETE /api/trusted-cas/{id}

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/trusted-cas/corp-root \
  -H "Authorization: Bearer $PP_TOKEN"
```

### Trusted CRLs

`GET /api/trusted-crls`, `GET /api/trusted-crls/{id}`, `POST /api/trusted-crls/validate`, `POST /api/trusted-crls/upload`, `DELETE /api/trusted-crls/{id}` — identical pattern to trusted CAs. Used by mTLS frontends to reject revoked client certs.

```bash
curl -s https://patchpanel.example.com:8099/api/trusted-crls \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/byo-certs

List bring-your-own certs. Each entry reports whether both fullchain and privkey are present.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/byo-certs \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "byoCertsDir": "/etc/patchpanel/ssl/byo",
  "certs": [
    {
      "name": "wildcard-internal",
      "hasFullchain": true,
      "hasPrivkey": true,
      "complete": true,
      "uploadedAt": "..."
    }
  ]
}
```

#### POST /api/byo-certs/validate

Dry-run a fullchain+privkey pair. **No disk write.**

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/byo-certs/validate \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --rawfile fc fullchain.pem \
        --rawfile pk privkey.pem \
        '{fullchainPem: $fc, privkeyPem: $pk}')"
```

{: .warning }

> A failure here returns **HTTP 200** with `ok: false`. Always inspect the JSON body —
> do not key off the HTTP status. This trap exists because the endpoint is a validator,
> not a writer; "the input is invalid" is a successful validation result.

```json
{
  "ok": false,
  "errors": ["Private key does not match the leaf certificate"],
  "info": { "sans": ["*.internal.example.com"], "notBefore": "...", "notAfter": "..." }
}
```

#### POST /api/byo-certs/upload

Write both files. The `name` is used as the folder name **and** as the `certName` referenced from state. Files are written with mode `0600`.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/byo-certs/upload \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --rawfile fc fullchain.pem \
        --rawfile pk privkey.pem \
        '{name: "wildcard-internal", fullchainPem: $fc, privkeyPem: $pk}')"
```

#### GET /api/byo-certs/{name}/fullchain.pem

Download the fullchain. Not audit-logged — public certificate bytes.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/byo-certs/wildcard-internal/fullchain.pem \
  -H "Authorization: Bearer $PP_TOKEN" -o fullchain.pem
```

#### GET /api/byo-certs/{name}/privkey.pem

Download the private key.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/byo-certs/wildcard-internal/privkey.pem \
  -H "Authorization: Bearer $PP_TOKEN" -o privkey.pem
```

{: .warning }

> Every call to this endpoint emits an **audit entry** that records the calling actor, source IP, and target cert name. Treat downloads as security-relevant operations. If your monitoring sees a privkey download from an unexpected source, treat it as an incident until proven otherwise.

#### DELETE /api/byo-certs/{name}

Recursive folder removal.

Auth: Bearer admin token.

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/byo-certs/wildcard-internal \
  -H "Authorization: Bearer $PP_TOKEN"
```

---

## 5. HAProxy Runtime

### 5a. Config rendering and process control

#### GET /api/haproxy/cfg?source=disk|state

Return `haproxy.cfg` as plain text. `disk` (default) reads the file as deployed; `state` renders fresh from in-memory state without writing.

Auth: Bearer admin token.

```bash
curl -s "https://patchpanel.example.com:8099/api/haproxy/cfg?source=disk" \
  -H "Authorization: Bearer $PP_TOKEN"

curl -s "https://patchpanel.example.com:8099/api/haproxy/cfg?source=state" \
  -H "Authorization: Bearer $PP_TOKEN"
```

Diff the two outputs to see whether the running daemon is behind the current state.

#### POST /api/haproxy/reload

Zero-downtime reload via the master socket. Does **not** re-render the config — only reloads what is on disk.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/haproxy/reload \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### GET /api/haproxy/control-strategy

Tells you which init/runtime is driving haproxy.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/haproxy/control-strategy \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{ "strategy": "s6", "pidPath": "/var/run/haproxy.pid" }
```

`strategy` is one of `s6` (Home Assistant add-on), `systemctl` (Debian/RPM/Arch packages), or `direct` (fallback when no supervisor is available).

#### POST /api/haproxy/stop

Stop haproxy. **Drops all proxied connections.**

Auth: Bearer admin token.

{: .warning }

> The body `{"confirm": true}` is **required**. Without it, the server returns 400.
> This is deliberate friction — stopping haproxy is rarely what you want; reload usually is.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/haproxy/stop \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

#### POST /api/haproxy/start

Start a stopped haproxy. Returns 500 if `strategy=direct` (no supervisor to coordinate startup).

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/haproxy/start \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### GET /api/haproxy/ssl-capabilities

Probes `haproxy -vv` and the linked OpenSSL build for supported features.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/haproxy/ssl-capabilities \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

Returns version, build options, available ciphers, named curves, and signature algorithms. Use this to confirm a build supports TLS 1.3, post-quantum hybrids, etc., before you reference them in state.

### 5b. Runtime API (master socket)

These endpoints translate to HAProxy Runtime API commands. Changes survive a reload,
but do **not** survive a full restart unless persisted to state.

{: .note }

> Runtime mutations are inherently ephemeral. To make a change permanent, mirror it into state and `PUT /api/state`.

#### POST /api/haproxy/servers/{backend}/{server}/state

Set a server's runtime state. Maps to `set server <be>/<srv> state <new>`.

Auth: Bearer admin token.

```bash
curl -s -X POST "https://patchpanel.example.com:8099/api/haproxy/servers/be_app/srv1/state" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "drain"}'
```

`state` is one of `ready`, `drain`, or `maint`.

#### POST /api/haproxy/servers/{backend}/{server}/weight

Set runtime weight 0..256.

```bash
curl -s -X POST "https://patchpanel.example.com:8099/api/haproxy/servers/be_app/srv1/weight" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"weight": 32}'
```

#### GET /api/runtime/errors

Wraps `show errors` — captured request/response errors from the runtime ring buffer.

```bash
curl -s https://patchpanel.example.com:8099/api/runtime/errors \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/runtime/resolvers

Show DNS resolver status (`show resolvers`).

```bash
curl -s https://patchpanel.example.com:8099/api/runtime/resolvers \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/runtime/tables and GET /api/runtime/tables/{name}

List stick tables, or inspect one.

```bash
curl -s https://patchpanel.example.com:8099/api/runtime/tables \
  -H "Authorization: Bearer $PP_TOKEN" | jq

curl -s https://patchpanel.example.com:8099/api/runtime/tables/st_rate_limit \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### POST /api/runtime/tables/{name}/clear

Clear one key or the whole table. Body is optional.

```bash
# Clear one key
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/tables/st_rate_limit/clear \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "203.0.113.4"}'

# Clear entire table
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/tables/st_rate_limit/clear \
  -H "Authorization: Bearer $PP_TOKEN" \
  -d '{}'
```

#### GET /api/runtime/acls and entries

```bash
curl -s https://patchpanel.example.com:8099/api/runtime/acls \
  -H "Authorization: Bearer $PP_TOKEN" | jq

curl -s "https://patchpanel.example.com:8099/api/runtime/acls/0/entries" \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

`{ref}` is the numeric ACL id or `#<name>` from `show acl`.

#### POST /api/runtime/acls/{ref}/entries

Add an entry. Runtime-only — does not persist unless the ACL is file-backed.

```bash
curl -s -X POST "https://patchpanel.example.com:8099/api/runtime/acls/0/entries" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "203.0.113.4"}'
```

#### DELETE /api/runtime/acls/{ref}/entries

{: .note }

> The value is a **query parameter**, not a body. Express 5 makes DELETE-with-body
> awkward, so this endpoint reads from the URL.

```bash
curl -s -X DELETE "https://patchpanel.example.com:8099/api/runtime/acls/0/entries?value=203.0.113.4" \
  -H "Authorization: Bearer $PP_TOKEN"
```

URL-encode the value if it contains special characters.

#### GET/POST/DELETE /api/runtime/maps

Mirror of the ACL endpoints, but for maps. Maps store key/value pairs.

```bash
curl -s https://patchpanel.example.com:8099/api/runtime/maps \
  -H "Authorization: Bearer $PP_TOKEN" | jq

curl -s "https://patchpanel.example.com:8099/api/runtime/maps/0/entries" \
  -H "Authorization: Bearer $PP_TOKEN" | jq

curl -s -X POST "https://patchpanel.example.com:8099/api/runtime/maps/0/entries" \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "/admin", "value": "deny"}'

curl -s -X DELETE "https://patchpanel.example.com:8099/api/runtime/maps/0/entries?key=%2Fadmin" \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/runtime/frontends/{name}/enable and /disable

Toggle a frontend at runtime. Useful for blue/green or planned outages without editing state.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/frontends/fe_https/disable \
  -H "Authorization: Bearer $PP_TOKEN"

curl -s -X POST https://patchpanel.example.com:8099/api/runtime/frontends/fe_https/enable \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/runtime/sessions/{id}/shutdown

Kill one client session by id (from `show sess`).

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/sessions/0x7f8a1c0/shutdown \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/runtime/maxconn/frontend/{name} and /global

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/maxconn/frontend/fe_https \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max": 10000}'

curl -s -X POST https://patchpanel.example.com:8099/api/runtime/maxconn/global \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max": 50000}'
```

`max` is a non-negative integer.

#### POST /api/runtime/counters/clear

Reset max/total counters on all proxies (`clear counters all`).

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/runtime/counters/clear \
  -H "Authorization: Bearer $PP_TOKEN"
```

### 5c. Lua plugins

#### GET /api/lua-plugins/dirs

Operator-approved whitelist of directories from which Lua may be loaded. Anything
outside this list is rejected.

```bash
curl -s https://patchpanel.example.com:8099/api/lua-plugins/dirs \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/lua-plugins

List every Lua file under the whitelisted dirs.

```bash
curl -s https://patchpanel.example.com:8099/api/lua-plugins \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "dirs": ["/etc/patchpanel/lua"],
  "grouped": [
    {
      "dir": "/etc/patchpanel/lua",
      "files": [{ "id": "auth-request", "path": "...", "uploadedAt": "...", "sizeBytes": 4823 }]
    }
  ]
}
```

#### GET /api/lua-plugins/file?dir=...&name=

Download one file as `text/x-lua`. `dir` must appear in the whitelist.

```bash
curl -s "https://patchpanel.example.com:8099/api/lua-plugins/file?dir=/etc/patchpanel/lua&name=auth-request.lua" \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/lua-plugins/upload

Write a file. `dir` must be whitelisted.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/lua-plugins/upload \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile src ./auth-request.lua \
        '{dir: "/etc/patchpanel/lua", name: "auth-request.lua", source: $src}')"
```

#### POST /api/lua-plugins/delete

{: .note }

> `POST` not `DELETE`. Express 5's handling of `DELETE` with a JSON body is awkward,
> so this endpoint uses POST.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/lua-plugins/delete \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dir": "/etc/patchpanel/lua", "name": "auth-request.lua"}'
```

### 5d. Error pages

#### GET /api/error-pages

List the built-in error page templates (4xx/5xx). Per-block overrides live in
`state.defaultsBlocks[].errorPageContents` — edit those via `PUT /api/state`.

```bash
curl -s https://patchpanel.example.com:8099/api/error-pages \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/error-pages/{code}

Fetch one template. Returns 400 for codes patchpanel does not ship a template for.

```bash
curl -s https://patchpanel.example.com:8099/api/error-pages/503 \
  -H "Authorization: Bearer $PP_TOKEN"
```

---

## 6. Observability

### GET /api/stats

Live combined output of `show info` + `show stat` from the runtime socket.

```bash
curl -s https://patchpanel.example.com:8099/api/stats \
  -H "Authorization: Bearer $PP_TOKEN" | jq '.stat | length'
```

Returns 502 if the runtime socket is unavailable (haproxy stopped, socket path wrong).

### GET /api/stats/history?since={epochMs}

1-hour in-process rolling sampler. Returns samples newer than `since`.

```bash
SINCE=$(($(date +%s%3N) - 600000)) # last 10 minutes
curl -s "https://patchpanel.example.com:8099/api/stats/history?since=$SINCE" \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

{: .note }

> Returns 503 if the sampler has not started yet (cold boot) or has stopped. Buffer is in-process — restarting patchpanel resets history.

### GET /api/stats/slowest-backends?limit=<1..50>

Top N backends by response time (`rtime`). Default `limit=10`.

```bash
curl -s "https://patchpanel.example.com:8099/api/stats/slowest-backends?limit=5" \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

### GET /api/stats/http-codes

Aggregated 1xx-5xx counts across all frontends/backends.

```bash
curl -s https://patchpanel.example.com:8099/api/stats/http-codes \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

### GET /api/stats/sessions

Live `show sess all` distilled into top clients/frontends/backends. If `state.geoip.enabled` is true, the top 20 client IPs are geo-enriched.

```bash
curl -s https://patchpanel.example.com:8099/api/stats/sessions \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

### GET /api/audit

Audit log, newest first. Default `limit=100`, max 1000.

```bash
curl -s "https://patchpanel.example.com:8099/api/audit?limit=50&category=cert&actor=admin" \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

Categories: `state`, `cert`, `haproxy`, `auth`, `cluster`, `api-token`, `config`, `keepalived`, `geoip`, `lua-plugin`, `trusted-ca`, `trusted-crl`, `tls-credentials`, `client-error`, `snapshot`. Outcome: `ok | error | fail`.

### GET /api/logs

Tail haproxy and patchpanel logs as plain text.

{: .warning }

> Returns **501** outside the Home Assistant add-on. The Debian/RPM/Arch packages use
> systemd journal — query that directly with `journalctl -u patchpanel`.

```bash
curl -s https://patchpanel.example.com:8099/api/logs \
  -H "Authorization: Bearer $PP_TOKEN"
```

### GET /api/logs/stream

Server-Sent Events stream. Events: `ready` on connect, `lines` for each batch, `ping` every 30 s. HA-only.

```bash
curl -N -s https://patchpanel.example.com:8099/api/logs/stream \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Accept: text/event-stream"
```

`-N` disables curl's output buffering so events render in real time.

### GET /api/notifications/channel-types

Lists supported notification channel types and their config schemas.

```bash
curl -s https://patchpanel.example.com:8099/api/notifications/channel-types \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

### POST /api/notifications/test

Dispatch a synthetic event through one configured channel.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/notifications/test \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channelId": "ntfy-ops"}'
```

### POST /api/notifications/dispatch

Diagnostic: send a raw event payload through the full dispatch pipeline.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/notifications/dispatch \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category": "cert", "level": "warn", "title": "Test", "message": "Synthetic"}'
```

### GET /api/geoip/status

```bash
curl -s https://patchpanel.example.com:8099/api/geoip/status \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "enabled": true,
  "localDbSource": "dbip",
  "freshness": { "updatedAt": "...", "ageHours": 36 }
}
```

`localDbSource` is one of `maxmind`, `dbip`, or `none`.

### GET /api/geoip/lookup/{ip}

```bash
curl -s https://patchpanel.example.com:8099/api/geoip/lookup/8.8.8.8 \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

400 for malformed IP, 404 for no data, 409 if GeoIP is disabled.

### POST /api/geoip/lookup

Batch.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/geoip/lookup \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ips": ["8.8.8.8", "1.1.1.1"]}'
```

Returns `{results: {"8.8.8.8": {...}, "1.1.1.1": {...}}}`.

### POST /api/geoip/download

Force-refresh the MMDB.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/geoip/download \
  -H "Authorization: Bearer $PP_TOKEN"
```

Returns 409 if `localDbSource=none`, or if `localDbSource=maxmind` without a license key configured.

---

## 7. Cluster and per-node

{: .warning }

> Two different surfaces, two different token formats. Do not mix them up.
>
> - **`/api/peers/*` (plural)** — operator-facing CRUD that you call from your own scripts.
>   Uses the normal admin Bearer token: `Authorization: Bearer pp_<keyId>.<secret>`. Same auth as every other admin endpoint in this document.
> - **`/api/peer/*` (singular)** — peer-to-peer machine endpoints called by _other patchpanel nodes_, not by humans. Uses the **raw inbound token** minted by `POST /api/peers/inbound-tokens` — the literal value, with **no `pp_` prefix** and no key-id split: `Authorization: Bearer <RAW_INBOUND_TOKEN>`. Pair it with `X-Patchpanel-Node-Name: <node>` for audit attribution.
>
> Example header values, side by side:
>
> - Admin token (plural routes): `Authorization: Bearer pp_a1b2c3d4.0123456789abcdef0123456789abcdef`
> - Raw inbound token (singular routes): `Authorization: Bearer 9e44a2c5f3b7d1...` (64+ hex chars, no `pp_`)

### 7a. Operator-facing cluster CRUD

#### GET /api/peers

List outbound peers (other nodes this one syncs _to_). Tokens are redacted.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/peers \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### POST /api/peers

Add a peer. The `token` field is the **raw inbound token** the _remote_ peer minted for you to use. Paste-pairing — there is no handshake.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/peers \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://patchpanel-2.example.com:8099",
    "name": "node-2",
    "token": "9e44a2c5f3b7d10a8c7e2b1f4d6a9b3c..."
  }'
```

#### DELETE /api/peers/{id}

The id matches `^peer-[a-f0-9]{12}$`.

Auth: Bearer admin token.

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/peers/peer-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/peers/{id}/sync-now

Push current local state to _all_ peers (the id in the URL is informational only — the action is broadcast). 409 if local state is not initialized.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/peers/peer-a1b2c3d4e5f6/sync-now \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### GET /api/peers/drift

Fetch `/api/peer/state-checksum` from every peer and compare to local. Returns a per-peer drift verdict.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/peers/drift \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/peers/inbound-tokens

List the tokens _this_ node accepts from other peers. The raw value is never returned — only metadata and a short preview.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/peers/inbound-tokens \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
[
  {
    "id": "tk-a1b2c3d4e5f6",
    "label": "node-2 pairing",
    "mintedAt": "...",
    "lastUsedAt": "...",
    "lastUsedBy": "node-2",
    "tokenPreview": "9e44a2c5..."
  }
]
```

#### POST /api/peers/inbound-tokens

Mint a new inbound token. Optionally label it.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/peers/inbound-tokens \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "node-2 pairing"}'
```

{: .warning }

> The plaintext `token` field in the response is shown **only once**. Paste it
> immediately into the peer's "Add peer" modal (or `POST /api/peers` body) on the
> _other_ node. The server keeps only a bcrypt hash. Lose it and you must revoke and mint a new one.

```json
{
  "id": "tk-a1b2c3d4e5f6",
  "token": "9e44a2c5f3b7d10a8c7e2b1f4d6a9b3c...",
  "label": "node-2 pairing",
  "mintedAt": "..."
}
```

#### PATCH /api/peers/inbound-tokens/{id}

Rename only — the secret itself is immutable. Id matches `^tk-[a-f0-9]{12}$`.

Auth: Bearer admin token.

```bash
curl -s -X PATCH https://patchpanel.example.com:8099/api/peers/inbound-tokens/tk-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label": "node-2 (relabeled)"}'
```

#### DELETE /api/peers/inbound-tokens/{id}

Revoke. Any peer holding this token will get 401 on its next sync attempt.

Auth: Bearer admin token.

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/peers/inbound-tokens/tk-a1b2c3d4e5f6 \
  -H "Authorization: Bearer $PP_TOKEN"
```

### 7b. Server-to-server (RAW inbound token)

{: .note }

> Endpoints in this subsection use `Authorization: Bearer $PEER_RAW_TOKEN`, where
> `$PEER_RAW_TOKEN` is the raw value minted by `POST /api/peers/inbound-tokens` —
> **no `pp_` prefix**, no key-id segment, just the literal token. Add `X-Patchpanel-Node-Name` so the audit log records which node called.

Set the variables for the rest of the section:

```bash
export PEER_RAW_TOKEN="9e44a2c5f3b7d10a8c7e2b1f4d6a9b3c..."
export NODE_NAME="node-1"
```

#### GET /api/peer/clock

Wall and monotonic clocks. Used by drift detection.

```bash
curl -s https://patchpanel.example.com:8099/api/peer/clock \
  -H "Authorization: Bearer $PEER_RAW_TOKEN" \
  -H "X-Patchpanel-Node-Name: $NODE_NAME" | jq
```

```json
{ "time": "2026-05-17T14:30:12.345Z", "monotonic": 12345678 }
```

#### GET /api/peer/state-checksum

Stable checksum of the local state document. Returns `{checksum: null}` if state is uninitialized.

```bash
curl -s https://patchpanel.example.com:8099/api/peer/state-checksum \
  -H "Authorization: Bearer $PEER_RAW_TOKEN" \
  -H "X-Patchpanel-Node-Name: $NODE_NAME" | jq
```

#### POST /api/peer/state

Apply a state document from a peer. Goes through the same atomic pipeline as `PUT /api/state`
(Zod -> render -> `haproxy -c` -> swap -> reload -> rollback on failure). The audit entry records `editor: peer:<token-label>` and `reason: peer-sync`.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/peer/state \
  -H "Authorization: Bearer $PEER_RAW_TOKEN" \
  -H "X-Patchpanel-Node-Name: $NODE_NAME" \
  -H "Content-Type: application/json" \
  -d @state.json
```

Optional body field `checksum` lets the caller assert what they expect to apply. 422 / 502 semantics match `PUT /api/state`.

#### GET /api/peer/blob/{kind}/{id}

Fetch a peer-replicated blob. `kind` is one of `trusted-ca`, `trusted-crl`, `credential`,
`lua-plugin`. `id` matches `^[a-zA-Z0-9._-]{1,128}$`. Returns `text/plain`.

```bash
curl -s "https://patchpanel.example.com:8099/api/peer/blob/trusted-ca/corp-root" \
  -H "Authorization: Bearer $PEER_RAW_TOKEN" \
  -H "X-Patchpanel-Node-Name: $NODE_NAME"
```

#### POST /api/peer/blob/{kind}/{id}

Write a peer-replicated blob. Credentials are written mode `0600`;
everything else `0644`.

```bash
curl -s -X POST "https://patchpanel.example.com:8099/api/peer/blob/trusted-ca/corp-root" \
  -H "Authorization: Bearer $PEER_RAW_TOKEN" \
  -H "X-Patchpanel-Node-Name: $NODE_NAME" \
  -H "Content-Type: application/json" \
  -d "$(jq -nR --rawfile body corp-root.pem '{body: $body}')"
```

### 7c. Per-node identity

#### GET /api/node-config

Per-node identity (`node.yaml`). **Never** synced between peers — this is the local node's name, VRRP priority, interface bindings, etc.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/node-config \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### PUT /api/node-config

Validated by `NodeConfigSchema`. On schema failure returns 400 with `errors[]`. On
success fires a **non-fatal** keepalived reload (failures are logged but do not block the response).

Auth: Bearer admin token.

```bash
curl -s -X PUT https://patchpanel.example.com:8099/api/node-config \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "node-1",
    "vrrpPriority": 100,
    "interfaces": ["eth0"]
  }'
```

---

## 8. Misc (Providers, System, Keepalived, Config)

### 8a. TLS providers

#### GET /api/tls-providers/credential-template/{type}

Schema for the credentials form of a DNS-01 provider type (cloudflare, route53, digitalocean, etc.). 404 returns `supportedTypes[]`.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/tls-providers/credential-template/cloudflare \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### GET /api/tls-providers/{id}/credentials

Read credentials. Secret fields come back as `"***"`.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/tls-providers/tls-cloudflare/credentials \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### PUT /api/tls-providers/{id}/credentials

Update credentials.

{: .warning }

> Sending `"***"` as a field value **preserves the on-disk secret** rather than
> overwriting with the literal three asterisks. This makes the GET-edit-PUT cycle roundtrip-safe:
> an operator can edit one field in the UI without re-typing every API key. Conversely, sending an empty string overwrites with empty — be deliberate.

Auth: Bearer admin token.

```bash
curl -s -X PUT https://patchpanel.example.com:8099/api/tls-providers/tls-cloudflare/credentials \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "dns_cloudflare_api_token": "new-token-here",
      "dns_cloudflare_email": "***"
    }
  }'
```

#### DELETE /api/tls-providers/{id}/credentials

```bash
curl -s -X DELETE https://patchpanel.example.com:8099/api/tls-providers/tls-cloudflare/credentials \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/tls-providers/{id}/test

Validates the credentials file and runs `certbot certificates` against the provider account.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/tls-providers/tls-cloudflare/test \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "id": "tls-cloudflare",
  "type": "letsencrypt-dns-cloudflare",
  "ok": true,
  "credentialsRef": "tls-cloudflare",
  "credentialsFile": "/etc/patchpanel/credentials/tls-cloudflare.ini",
  "certbotLineages": ["prod-public"],
  "certbotError": null
}
```

### 8b. Auth providers

#### POST /api/auth-providers/{id}/test

Probe an upstream IdP. Behavior depends on provider type:

- `authelia`: hits `/api/configuration`, `/api/health`, `/api/state`.
- `basic`: stats the configured password hash files.
- `oidc` and `entra`: fetches `.well-known/openid-configuration`.
- `ldap`, `saml`, `jwt-verify`: probes the sidecar and the IdP metadata endpoint.
- `mtls-auth`, `header-trust`, `lua-auth`: static config check (no upstream call).

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/auth-providers/auth-keycloak/test \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

### 8c. System

#### GET /api/system/interfaces

List network interfaces visible to patchpanel. `showFiltered=1` includes loopback, docker bridges, etc.

Auth: Bearer admin token.

```bash
curl -s "https://patchpanel.example.com:8099/api/system/interfaces?showFiltered=0" \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{"interfaces": [{"name": "eth0", "addresses": [...]}], "version": "..."}
```

### 8d. Keepalived

#### GET /api/keepalived/cfg?source=disk|state

Mirrors `GET /api/haproxy/cfg`. `disk` reads the deployed file, `state` renders without writing.

Auth: Bearer admin token.

```bash
curl -s "https://patchpanel.example.com:8099/api/keepalived/cfg?source=disk" \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### GET /api/keepalived/control-strategy

```bash
curl -s https://patchpanel.example.com:8099/api/keepalived/control-strategy \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### POST /api/keepalived/reload

SIGHUP. VRRP state is preserved across the reload — no failover.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/keepalived/reload \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/keepalived/stop

Requires `{"confirm": true}`. Stopping keepalived **drops the VIPs** held by this node, triggering failover to whichever peer has the next-highest priority.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/keepalived/stop \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

#### POST /api/keepalived/start

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/keepalived/start \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### GET /api/keepalived/state

```bash
curl -s https://patchpanel.example.com:8099/api/keepalived/state \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

```json
{
  "alive": true,
  "strategy": "systemctl",
  "instances": [
    { "id": "vi_external", "name": "external", "vip": "192.0.2.10", "state": null, "holding": null }
  ]
}
```

{: .note }

> Per-instance `state` (MASTER/BACKUP) and `holding` are currently always `null`.
> Live VRRP state inspection requires keepalived's `SIGUSR2`/DBus interface, which is not yet wired in. The `alive` flag (process up/down) is reliable today.

### 8e. Server config

#### GET /api/config

Returns the metadata-wrapped `/etc/patchpanel/config.yaml`. Every leaf is
`{type, value, description, section, subsection, validation, ...}`. Top-level `_sections` is a map of section descriptors.

Auth: Bearer admin token.

```bash
curl -s https://patchpanel.example.com:8099/api/config \
  -H "Authorization: Bearer $PP_TOKEN" | jq
```

#### PUT /api/config

Apply a partial patch. The body uses dotted paths and is validated against
the per-leaf metadata.

Auth: Bearer admin token.

```bash
curl -s -X PUT https://patchpanel.example.com:8099/api/config \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "patch": {
      "server.port": 8099,
      "logging.level": "debug"
    }
  }'
```

```json
{
  "ok": true,
  "requiresRestart": true,
  "preservedPath": "/etc/patchpanel/config.yaml.preserved-2026-05-17T14:30:12Z"
}
```

The first save against a hand-written file copies the original verbatim to
`<configPath>.preserved-<iso>` so operator comments are never lost.

#### POST /api/config/restart

Sends `SIGTERM` to the patchpanel process. Whichever supervisor is in charge (s6,
systemd, etc.) brings it back up. The Settings UI polls `/health` for up to 60 seconds to confirm restart.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/config/restart \
  -H "Authorization: Bearer $PP_TOKEN"
```

#### POST /api/config/upload-file

Upload a file by `targetPath`. Only the **basename** is honored; only paths under `/etc/patchpanel/ssl/` are accepted; the filename must match `[a-zA-Z0-9._-]+\.(pem|crt|key|ca-bundle)`. Files are written mode `0600`.

Auth: Bearer admin token.

```bash
curl -s -X POST https://patchpanel.example.com:8099/api/config/upload-file \
  -H "Authorization: Bearer $PP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --rawfile content ./extra-ca.pem \
        '{targetPath: "/etc/patchpanel/ssl/extra-ca.pem", content: $content}')"
```

---

## See also

- [Backend integration]({{ '/docs/guides/backend-integration/' | relative_url }}) — patterns for wiring application backends into patchpanel.
- [Authentication]({{ '/docs/guides/authentication/' | relative_url }}) — sessions, API tokens, IdPs, and ingress in depth.
- [Configuration]({{ '/docs/configuration/' | relative_url }}) — `config.yaml`, leaf metadata, restart semantics.
- [API reference]({{ '/docs/api/' | relative_url }}) — Swagger UI generated from `/openapi.json`.
