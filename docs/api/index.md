---
title: API Reference
layout: default
nav_order: 2
has_children: true
permalink: /docs/api/
---

# API Reference

{: .no_toc }

PatchPanel's HTTP API. Used by the React UI, by external automation
(billing systems, monitoring exporters, CLI tools), and by Home Assistant
when PatchPanel runs as an add-on.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## Interactive documentation

The full Swagger UI lives at `/api-docs` on your PatchPanel server. The
OpenAPI spec is generated from JSDoc on the route handlers — see
`packaging/scripts/generate-docs.js`.

- **[Live Swagger UI](swagger-ui.html)** — interactive testing
- **[OpenAPI Specification](openapi.json)** — raw spec for codegen / tooling

## Authentication

PatchPanel supports two authentication methods depending on deployment.

### 1. API keys (programmatic / remote control)

Used by CI pipelines, billing systems, exporters, and CLI tools.

```bash
# Bearer token authentication
curl -k -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-host:8099/api/state
```

API keys are bcrypt-hashed at rest. Each key has a permission scope and
an optional expiration (max one year). The plaintext key is shown
**only once** at creation — store it in a vault.

### 2. Session cookies (browser admin UI)

The web UI signs in with username + password (created during the
first-run wizard) and receives a session cookie. This auth path is not
used by API clients.

### Home Assistant add-on mode

When PatchPanel is deployed as an HA add-on, **no local authentication
runs**. HA's ingress proxy gates access, and PatchPanel reads
`X-Remote-User-*` headers from the proxy for audit attribution. API
keys still work via the supervisor's URL.

## Endpoint summary

### State

The canonical HAProxy configuration document. Every change re-renders
`haproxy.cfg`, validates with `haproxy -c`, atomically swaps the file,
and reloads.

- `GET /api/state` — Read the current state document
- `PUT /api/state` — Replace the state document (full body, Zod-validated)

### HAProxy control

- `GET /api/haproxy/cfg` — Get the on-disk `haproxy.cfg` (or `?source=state` to render fresh)
- `POST /api/haproxy/reload` — Zero-downtime reload via the master CLI socket
- `POST /api/haproxy/start` — Start the HAProxy service (s6 / systemd / direct PID)
- `POST /api/haproxy/stop` — Stop the HAProxy service (requires `{"confirm": true}`)
- `GET /api/haproxy/control-strategy` — Detect how patchpanel will start/stop HAProxy
- `GET /api/haproxy/ssl-capabilities` — Probe HAProxy for supported ciphers / curves / sigalgs

### Certificates

- `GET /api/certificates` — Live cert status (loadable / expiring / expired)
- `POST /api/certificates/renew` — Renew all certs (`{"force": true}` ignores expiry)
- `POST /api/certificates/{certId}/renew` — Renew one cert

### BYO certificates (uploaded PEMs)

- `GET /api/byo-certs` — List uploaded cert directories
- `POST /api/byo-certs/validate` — Dry-run PEM validation
- `POST /api/byo-certs/upload` — Upload `{name, fullchainPem, privkeyPem}`
- `DELETE /api/byo-certs/{name}` — Remove cert folder

### Trusted CAs

CA bundles for mTLS client validation on binds + upstream verification
on backend servers.

- `GET /api/trusted-cas` — List on-disk CA files
- `POST /api/trusted-cas/validate` — Parse + fingerprint check
- `POST /api/trusted-cas/upload` — Upload `{id, pem}`
- `DELETE /api/trusted-cas/{id}` — Remove

### Trusted CRLs

Certificate revocation lists for binds doing mTLS.

- `GET /api/trusted-crls` — List
- `POST /api/trusted-crls/validate` — Parse + fingerprint
- `POST /api/trusted-crls/upload` — Upload `{id, pem}`
- `DELETE /api/trusted-crls/{id}` — Remove

### Live stats and observability

- `GET /api/stats` — Current HAProxy `show info` + `show stat`
- `GET /api/stats/history` — Rolling time-window of frontend/backend traffic
- `GET /api/stats/slowest-backends?limit=5` — Top N by `rtime`
- `GET /api/stats/http-codes` — Sampled 1h HTTP status code distribution
- `GET /api/stats/sessions` — Active sessions with GeoIP enrichment

### Runtime control (HAProxy admin socket)

Mutations that don't require a config reload.

- `POST /api/haproxy/servers/{backend}/{server}/state` — `{"state": "ready"|"drain"|"maint"}`
- `POST /api/haproxy/servers/{backend}/{server}/weight` — `{"weight": 0-256}`
- `POST /api/runtime/frontends/{name}/enable`
- `POST /api/runtime/frontends/{name}/disable`
- `POST /api/runtime/maxconn/frontend/{name}` — `{"max": int}`
- `POST /api/runtime/maxconn/global` — `{"max": int}`
- `POST /api/runtime/counters/clear` — Reset all max/total counters
- `GET /api/runtime/{acls|maps|tables|resolvers|errors}` — Inspect runtime state
- `POST /api/runtime/sessions/{id}/shutdown` — Kill a session

### Audit log

- `GET /api/audit?limit=100&category=cert` — Recent state changes

### Snapshots

- `GET /api/snapshots` — List time-machine state snapshots

### Logs

- `GET /api/logs` — Server-sent-events stream of HAProxy + patchpanel logs

### GeoIP

- `GET /api/geoip/status` — DB state, fallback provider, last update

### Health

- `GET /health` — Liveness probe (always public, no auth)

## Examples

### Get the current state

```bash
curl -k -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-host:8099/api/state | jq .
```

### Replace state and trigger render + reload

```bash
# Read, modify, write back. Use jq to add a hostname to an existing ACL.
STATE=$(curl -ks -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-host:8099/api/state)

NEXT=$(echo "$STATE" | jq '.acls[0].values += ["newhost.example.com"]')

curl -k -X PUT -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$NEXT" \
  https://your-host:8099/api/state
```

If the resulting `haproxy.cfg` fails `haproxy -c`, the PUT returns 502
with `{"output": "<stderr>", "hints": [...]}` and no state change.

### Force-renew a single certificate

```bash
curl -k -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"force": true}' \
  https://your-host:8099/api/certificates/home-mydomain-net/renew
```

### Upload a trusted CA bundle

```bash
curl -k -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"id\":\"corp-root\",\"pem\":\"$(cat corp-root-ca.pem | jq -Rs .)\"}" \
  https://your-host:8099/api/trusted-cas/upload
```

### Drain a backend server before maintenance

```bash
curl -k -X POST -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state": "drain"}' \
  https://your-host:8099/api/haproxy/servers/home_media/media-01-https/state
```

### Stream live logs

```bash
# SSE — keep this curl open
curl -kN -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-host:8099/api/logs
```

## Response shape

### Success

Most endpoints return `application/json` with the body as the result
directly (no `{success: true, data: ...}` envelope). Mutating endpoints
typically return `{ok: true, ...}` and an action-specific payload.

### Error

```json
{
  "error": "HaproxyError",
  "message": "haproxy -c failed: code 1",
  "output": "[ALERT] (123) : config : parsing [/tmp/...:42] : ...",
  "hints": [
    {
      "severity": "ALERT",
      "line": 42,
      "message": "no such ACL : 'host_typo'",
      "entity": { "kind": "acl", "name": "host_typo" },
      "ref": null
    }
  ]
}
```

`output` contains HAProxy's literal stderr; `hints` are parsed for the
UI's inline error display.

## HTTP status codes

- `200` — OK
- `204` — No content (idempotent delete)
- `400` — Bad request (schema or payload)
- `401` — Unauthorized (missing / invalid token)
- `403` — Forbidden (token lacks the required permission)
- `404` — Not found
- `409` — Conflict (state not initialized; stale read; concurrent update)
- `422` — Zod schema validation failed (response includes `issues`)
- `502` — HAProxy validation or reload failed (response includes `output` + `hints`)
- `503` — Service unavailable (HAProxy reload mid-flight, retry)
- `500` — Internal error

## Rate limiting

Auth endpoints and write endpoints are rate-limited. Limits are
configurable in `/etc/patchpanel/config.yaml > rate_limiting`. Response
headers:

- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

## API key permissions

API keys carry an array of permission strings:

- `read` — `GET` access to all endpoints
- `state-write` — `PUT /api/state` + write endpoints
- `cert-renew` — Trigger certificate renewals
- `runtime-control` — Drain servers, set weights, clear counters
- `haproxy-control` — Start / stop / reload HAProxy

A key without any write permissions can still read everything.

## Best practices

- **Always use HTTPS.** The default cert is self-signed; use the
  configured Let's Encrypt cert for the management UI itself if you can.
- **Store API keys in a secrets manager.** Never commit them.
- **Least privilege.** Only grant the permissions an integration needs.
- **Expire keys.** Set an expiration up to 365 days. Rotate before they
  expire.
- **Monitor the audit log.** Every state mutation is recorded with the
  acting key id.

---

## Related documentation

- **[Architecture](../architecture/)** — Components and data flow
- **[Releases](../releases/)** — Versioning + download

---

Need help? See [Support](../support/) or [open an issue](https://github.com/STARTcloud/patchpanel/issues).
