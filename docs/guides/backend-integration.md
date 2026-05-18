---
title: Backend Integration
layout: default
parent: Guides
nav_order: 4
permalink: /docs/guides/backend-integration/
---

# Backend Integration

{: .no_toc }

How to drive patchpanel from CI/CD pipelines, infrastructure-as-code,
and monitoring stacks. The REST API is the same surface the in-app UI
uses — anything you can click, you can curl.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## The mental model

Patchpanel has one canonical data shape: `state.json`. The renderer
produces `haproxy.cfg` from it deterministically. Every change goes
through the apply pipeline:

```text
PUT /api/state
   ↓
Zod validate                  → 422 with `issues[]` on fail
   ↓
Render haproxy.cfg
   ↓
haproxy -c                    → 502 with `output` + `hints[]` on fail
   ↓
Atomic swap on disk
   ↓
Reload via master CLI socket  → rollback to .bak on fail
   ↓
Snapshot + audit entry
   ↓
200 OK with the persisted state
```

For automation, this means **one transactional pattern**: read the
state, modify it locally, push it back. Patchpanel does the rest. If
anything goes wrong, the daemon rolls back; you get a structured error
with enough detail to surface in your CI logs.

For ops that don't need a full apply (drain a server, set a weight,
clear a counter), there's a separate set of **runtime endpoints**
that hit HAProxy's admin socket directly — no reload, no snapshot,
in-memory only.

## Authentication

Mint a long-lived API token once, store the wire format in your
secret manager:

```bash
# As admin via cookie session first
TOKEN_RESP=$(curl -ksb cookies.txt \
  -X POST -H 'content-type: application/json' \
  -d '{"name":"ci-pipeline"}' \
  https://patchpanel.example.com:8099/api/api-tokens)

PP_TOKEN=$(echo "$TOKEN_RESP" | jq -r .wire)
# pp_a1b2c3d4.0123456789abcdef0123456789abcdef — store immediately
```

Wire format: `pp_<8-hex>.<32-hex>`. Send as Bearer on every call:

```bash
curl -H "Authorization: Bearer $PP_TOKEN" \
     https://patchpanel.example.com:8099/api/state
```

Tokens are bcrypt-hashed at rest — no recovery path. Lose the wire,
mint a new one + revoke the old via `DELETE /api/api-tokens/{keyId}`.
See [Authentication](authentication/) for the full token model.

## The state document pattern (the spine)

```bash
# 1. Pull the canonical state
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/state > state.json

# 2. Patch it locally — jq, yq, jsonnet, or whatever
jq '.acls[0].values += ["newhost.example.com"]' state.json > state.next.json

# 3. Push it back — pipeline runs render → validate → swap → reload → snapshot
curl -fs -X PUT -H "Authorization: Bearer $PP_TOKEN" \
     -H 'content-type: application/json' \
     -d @state.next.json \
     https://patchpanel.example.com:8099/api/state
```

Status codes you'll see on `PUT /api/state`:

| Code  | What it means                                                                           | Body shape                                                                                                        |
| ----- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `200` | Applied; HAProxy reloaded; snapshot + audit written                                     | The persisted state                                                                                               |
| `422` | Zod schema validation failed                                                            | `{error, issues: [...]}` with Zod's issue list                                                                    |
| `502` | `haproxy -c` rejected the rendered cfg, OR the master-socket reload failed; rolled back | `{error, output, hints: [...]}` — `output` is HAProxy's stderr, `hints` is patchpanel's parsed structured guesses |
| `409` | State not initialized (very rare — only on a corrupted-from-day-zero install)           | `{error}`                                                                                                         |

Idempotent: the state document is the full desired state. PUTting
the same document twice is a no-op (well, it still rerenders +
reloads, but the resulting cfg is identical).

## Certificate automation

### Let's Encrypt: trigger a renewal

```bash
# All certs
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"force":false}' \
  https://patchpanel.example.com:8099/api/certificates/renew

# One cert by id
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"force":false}' \
  https://patchpanel.example.com:8099/api/certificates/<certId>/renew
```

Pass `"force": true` for `--force-renewal` (ignores certbot's
not-yet-due check). The 200 response includes a `results[]` array
with per-cert outcome and a `reload: {ok, error}` block for the
post-renewal HAProxy reload.

### BYO certs: upload PEMs

Two-step: upload the bytes, then add the state entry.

```bash
# Step 1: upload PEMs
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d @- https://patchpanel.example.com:8099/api/byo-certs/upload <<EOF
{
  "name": "internal-app",
  "fullchainPem": "$(awk '{printf "%s\\n", $0}' fullchain.pem)",
  "privkeyPem": "$(awk '{printf "%s\\n", $0}' privkey.pem)"
}
EOF

# Step 2: add the cert to state.tls.certs + state.tls.providers
# (read state.json, jq it, PUT back)
```

The `byo-certs/upload` endpoint validates the PEM pair (privkey
matches leaf, returns SANs + notAfter) and writes
`<byoCertsDir>/<name>/{fullchain,privkey,cert}.pem` mode 0600. The
state entry must be added separately via `PUT /api/state`.

Dry-run validation (no disk write):

```bash
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d @- https://patchpanel.example.com:8099/api/byo-certs/validate <<EOF
{
  "fullchainPem": "...",
  "privkeyPem": "..."
}
EOF
```

### Trusted CAs and CRLs

Same pattern — upload to `/api/trusted-cas/upload` (or `trusted-crls/upload`),
then add the state entry to `state.trustedCas[]` / `state.trustedCrls[]`
via PUT /state.

## Runtime HAProxy ops (no reload)

These hit HAProxy's admin socket directly. Mutations are in-memory
only — they survive a reload but not a process restart. Use them for
fast operational moves that don't need to round-trip through render +
validate + swap + reload.

### Drain a server

```bash
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"state":"drain"}' \
  https://patchpanel.example.com:8099/api/haproxy/servers/web-pool/web-1/state
```

`state` is one of `ready`, `drain`, `maint`. Drain stops new sessions
but keeps existing ones. Maint disables fully. Ready re-enables.

### Set weight 0–256

```bash
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"weight":0}' \
  https://patchpanel.example.com:8099/api/haproxy/servers/web-pool/web-1/weight
```

### Disable a frontend

```bash
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/runtime/frontends/fe-https/disable

# Re-enable
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/runtime/frontends/fe-https/enable
```

### maxconn

```bash
# Per-frontend
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"max":5000}' \
  https://patchpanel.example.com:8099/api/runtime/maxconn/frontend/fe-https

# Global
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"max":50000}' \
  https://patchpanel.example.com:8099/api/runtime/maxconn/global
```

### Counters / sessions / tables

```bash
# Reset every max/total counter (useful before a benchmark)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/runtime/counters/clear

# Kill one session by id (from `show sess`)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/runtime/sessions/0x7fabc/shutdown

# Clear a stick table (whole table or one key)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"1.2.3.4"}' \
  https://patchpanel.example.com:8099/api/runtime/tables/rate_per_ip/clear

# Add a runtime ACL entry (does NOT persist if ACL isn't file-backed)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"value":"1.2.3.4"}' \
  https://patchpanel.example.com:8099/api/runtime/acls/0/entries
```

## Observability scraping

### Snapshot stats

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/stats
# {"info": {...show info}, "stat": [...show stat rows]}
```

### Time-series (last hour, rolling)

```bash
LAST=$(date +%s000 --date '1 minute ago')   # epoch ms
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  "https://patchpanel.example.com:8099/api/stats/history?since=$LAST"
```

`since` is epoch ms. Without it, you get the full hour. Useful for
Prometheus / InfluxDB delta-pulls.

### Top-N slowest backends

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  "https://patchpanel.example.com:8099/api/stats/slowest-backends?limit=20"
```

### HTTP status code distribution

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/stats/http-codes
# {"totals": {"1xx": n, "2xx": n, "3xx": n, "4xx": n, "5xx": n, "other": n}}
```

### Sessions + geo

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/stats/sessions
```

When `state.geoip.enabled === true`, the top 20 clients are
geo-enriched (country, city, ASN). Useful for the dashboard origin
map; equally useful for piping into a security dashboard.

### Audit log

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  "https://patchpanel.example.com:8099/api/audit?limit=200&category=auth"
```

Filter by `category` (e.g. `state`, `cert`, `haproxy`, `auth`,
`api-token`, `cluster`, `client-error`, `snapshot`, `lua-plugin`,
`tls-credentials`, `trusted-ca`, `trusted-crl`) and `actor`. Default
limit 100, max 1000.

Ship this somewhere durable — patchpanel auto-vacuums after
`logging.auditRetentionDays` (default 365).

## Snapshots + rollback

Every successful `PUT /api/state` writes a snapshot. List:

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/snapshots
# {"snapshots": [{"id": "2026-05-17T12-34-56Z-abc1234", "snapshotAt": "...", "actor": "...", "reason": null}, ...]}
```

Read one:

```bash
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/snapshots/2026-05-17T12-34-56Z-abc1234
# Full {id, snapshotAt, actor, reason, state}
```

Restore (runs the full apply pipeline; audit `reason: restore:<id>`):

```bash
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/snapshots/2026-05-17T12-34-56Z-abc1234/restore
```

Snapshot IDs are ISO-timestamp + 7-char hash. Sortable by ID.

## Webhooks / notifications

Notification channels live in `state.notifications.channels[]`. CRUD
them through `PUT /api/state`. Then:

```bash
# Channel-type schemas (drive the channel-create UI)
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/notifications/channel-types

# Send a test notification to one configured channel
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"channelId":"ch-abc"}' \
  https://patchpanel.example.com:8099/api/notifications/test

# Manual dispatch (diagnostic; real events come from server-side hooks)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"category":"cert","level":"warning","message":"test"}' \
  https://patchpanel.example.com:8099/api/notifications/dispatch
```

## Cluster sync (multi-node patchpanel)

Patchpanel supports an operator-paste pairing model for multi-node
deployments. There's no handshake — you mint an inbound token on one
node and paste it into the other's "Add peer" form. Run the flow
twice (once on each node) for bidirectional sync.

Two distinct API surfaces:

### Operator surface (`/api/peers/*`) — Bearer + Cookie auth

```bash
# List configured peers (outbound tokens redacted)
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/peers

# Mint an inbound token (the raw value is returned ONCE)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"label":"node-a-pairing"}' \
  https://patchpanel.example.com:8099/api/peers/inbound-tokens

# Add a peer (using a token THEY minted, pasted here)
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://node-b.example.com:8099","name":"node-b","token":"<raw inbound token from node-b>"}' \
  https://patchpanel.example.com:8099/api/peers

# Drift report — checksum diff vs each peer
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/peers/drift

# Push current state to all peers immediately
curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
  https://patchpanel.example.com:8099/api/peers/peer-a1b2c3d4e5f6/sync-now
```

### Server-to-server surface (`/api/peer/*`) — RAW inbound token

These endpoints take the RAW inbound token (not a `pp_<keyId>.<secret>`
API token) as the Bearer value. Peer nodes call them; you typically
don't.

```bash
# Clock skew probe
curl -fs -H "Authorization: Bearer <raw-inbound-token>" \
  https://patchpanel.example.com:8099/api/peer/clock

# State checksum (compare against drift report)
curl -fs -H "Authorization: Bearer <raw-inbound-token>" \
  https://patchpanel.example.com:8099/api/peer/state-checksum

# Push state (full apply pipeline)
curl -fs -X POST -H "Authorization: Bearer <raw-inbound-token>" \
  -H 'content-type: application/json' \
  -d @state.json \
  https://patchpanel.example.com:8099/api/peer/state
```

> **Important:** `/api/peers/*` (plural — list/CRUD/management)
> takes a normal `pp_<keyId>.<secret>` token. `/api/peer/*` (singular
> — server-to-server) takes a raw inbound token. Don't mix them.

## CI/CD recipes

### GitHub Actions — nightly cert renewal

```yaml
name: patchpanel cert renew
on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

jobs:
  renew:
    runs-on: ubuntu-latest
    steps:
      - name: Force-renew patchpanel certs
        env:
          PP_HOST: https://patchpanel.example.com:8099
          PP_TOKEN: ${{ secrets.PATCHPANEL_TOKEN }}
        run: |
          curl -fsSL \
            -X POST \
            -H "Authorization: Bearer $PP_TOKEN" \
            -H 'content-type: application/json' \
            -d '{"force":false}' \
            $PP_HOST/api/certificates/renew \
            | jq .
```

### Terraform-style state management

Treat patchpanel's state.json the way Terraform treats its plan/apply.
Use the snapshot endpoint as your "last known good":

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PP_HOST:?}" "${PP_TOKEN:?}"

# 1. Snapshot-before
ROLLBACK_ID=$(curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  $PP_HOST/api/snapshots | jq -r '.snapshots[0].id')

# 2. Pull
curl -fs -H "Authorization: Bearer $PP_TOKEN" \
  $PP_HOST/api/state > state.json

# 3. Patch (replace with your editor of choice)
jq '
  .haproxy.backends[] |= (
    if .id == "web-pool" then
      .servers += [{name:"web-3", address:"10.0.0.13:443", weight:100}]
    else . end
  )
' state.json > state.next.json

# 4. Push
HTTP_CODE=$(curl -s -o response.json -w '%{http_code}' \
  -X PUT -H "Authorization: Bearer $PP_TOKEN" \
  -H 'content-type: application/json' \
  -d @state.next.json \
  $PP_HOST/api/state)

if [ "$HTTP_CODE" != "200" ]; then
  echo "Apply failed (HTTP $HTTP_CODE):" >&2
  cat response.json >&2
  echo "" >&2
  echo "Rolling back to snapshot $ROLLBACK_ID..." >&2
  curl -fs -X POST -H "Authorization: Bearer $PP_TOKEN" \
    "$PP_HOST/api/snapshots/$ROLLBACK_ID/restore"
  exit 1
fi
```

Auto-rollback on reload failure already happens server-side (the
daemon's `.bak` restore). The script-level rollback above is for the
case where the apply succeeds but the change is operationally wrong
(e.g. you added a bad backend).

### Ansible — graceful drain before deploy

```bash
VAR=lookup('env', 'PATCHPANEL_TOKEN')
```

```yaml
- name: Drain backend server before deploy
  hosts: localhost
  vars:
    pp_host: https://patchpanel.example.com:8099
    pp_token: "{{ VAR }}"
    backend: web-pool
    server: web-1
  tasks:
    - name: Drain
      uri:
        url: '{{ pp_host }}/api/haproxy/servers/{{ backend }}/{{ server }}/state'
        method: POST
        headers:
          Authorization: 'Bearer {{ pp_token }}'
        body_format: json
        body: { state: 'drain' }
        status_code: 200

    - name: Wait for in-flight requests to clear
      pause:
        seconds: 30

    - name: Set weight 0 (belt-and-suspenders)
      uri:
        url: '{{ pp_host }}/api/haproxy/servers/{{ backend }}/{{ server }}/weight'
        method: POST
        headers:
          Authorization: 'Bearer {{ pp_token }}'
        body_format: json
        body: { weight: 0 }

    - name: Deploy your app here
      # ...

    - name: Re-enable after deploy
      uri:
        url: '{{ pp_host }}/api/haproxy/servers/{{ backend }}/{{ server }}/state'
        method: POST
        headers:
          Authorization: 'Bearer {{ pp_token }}'
        body_format: json
        body: { state: 'ready' }
```

### Prometheus scrape

Patchpanel doesn't expose a Prometheus endpoint directly — but
`GET /api/stats` returns parseable JSON. A small exporter:

```python
# patchpanel_exporter.py — sketch
import os, requests
from prometheus_client import start_http_server, Gauge

PP_HOST = os.environ["PP_HOST"]
PP_TOKEN = os.environ["PP_TOKEN"]
HEADERS = {"Authorization": f"Bearer {PP_TOKEN}"}

backend_rtime = Gauge("haproxy_backend_rtime_ms", "Average response time", ["backend"])
backend_qcur = Gauge("haproxy_backend_qcur", "Queued requests", ["backend"])

def collect():
    r = requests.get(f"{PP_HOST}/api/stats", headers=HEADERS, verify=False)
    r.raise_for_status()
    for row in r.json()["stat"]:
        if row.get("type") == "backend":
            backend_rtime.labels(backend=row["pxname"]).set(row.get("rtime", 0))
            backend_qcur.labels(backend=row["pxname"]).set(row.get("qcur", 0))

# Schedule collect() every 15s, expose on :9913
```

For more comprehensive Prometheus coverage, point Prometheus directly
at HAProxy's stats endpoint (patchpanel renders a stats listener for
you if you configure one in state).

## Error envelope reference

| Code  | Envelope                                                   | When                                                                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` | `{error}` or `{ok: false, error}`                          | Bad input — missing field, invalid id pattern, wrong enum value, malformed body                                                                                                                                                                                                                               |
| `401` | `{error: "AuthError", message: "authentication required"}` | Missing/invalid auth. SSE endpoints get streaming 401; HTML clients get 302 to `/login?return=`; everyone else gets JSON.                                                                                                                                                                                     |
| `403` | `{error: "ForbiddenError", message}`                       | Authenticated but lacking the required role / session type                                                                                                                                                                                                                                                    |
| `404` | `{error}` or `{ok: false, error}`                          | Resource not found                                                                                                                                                                                                                                                                                            |
| `409` | `{error}`                                                  | State not initialized; resource in conflicting state                                                                                                                                                                                                                                                          |
| `422` | `{error, issues: [...]}`                                   | Zod schema validation failed on `PUT /api/state` or `POST /api/peer/state`. `issues[]` is verbatim Zod issue objects.                                                                                                                                                                                         |
| `500` | `{error, message}`                                         | Internal — see audit log + journalctl                                                                                                                                                                                                                                                                         |
| `502` | `{error, output, hints: [...]}`                            | `haproxy -c` rejected the rendered cfg, OR master-socket reload failed. `output` = HAProxy stderr verbatim; `hints[]` = patchpanel's parsed structured guesses with `severity`, `line`, `message`, and resolved `entity` (e.g. `{kind: 'acl', name: 'host_typo'}`) where possible. Rolled back automatically. |
| `503` | `{error}`                                                  | Background service (e.g. stats sampler) not running. Retry.                                                                                                                                                                                                                                                   |

The `apiGet/apiPost/apiPut/apiDelete/apiPatch` helpers in `web/src/api/client.js`
throw `Error` with `.status` and `.payload` on non-2xx — the React UI
unwraps `.payload.message` for the toast.

## Rate limits

Three tiered buckets (configurable in `config.yaml`):

| Tier                                             | Default          | Applies to                                                            |
| ------------------------------------------------ | ---------------- | --------------------------------------------------------------------- |
| `rateLimit.authMax` / `rateLimit.authWindowMs`   | 25 req / 15 min  | `/api/auth/login`, `/api/auth/change-password`, `/api/setup/complete` |
| `rateLimit.writeMax` / `rateLimit.writeWindowMs` | 60 req / 1 min   | Every mutating endpoint (POST, PUT, PATCH, DELETE)                    |
| `rateLimit.readMax` / `rateLimit.readWindowMs`   | 1000 req / 1 min | Every read endpoint                                                   |

Response headers per request (draft-ietf-httpapi-ratelimit-headers):

```http
RateLimit-Limit: 60
RateLimit-Remaining: 47
RateLimit-Reset: 23
```

When you hit the limit you get `429 Too Many Requests` with the
`Retry-After` header. CI tooling should respect the headers — back
off rather than retry-storm.

## Backup hooks

Patchpanel ships `backup-pre` and `backup-post` CLI hooks for the
host backup tool (restic, borg, rsync, snapshots):

```bash
sudo -u patchpanel patchpanel backup-pre
# rsync / restic / borg the /var/lib/patchpanel tree
sudo -u patchpanel patchpanel backup-post
```

`backup-pre` quiesces in-flight writes; `backup-post` resumes. This
matters most for `audit.sqlite` (WAL-mode SQLite races with raw
`cp`).

## See also

- [API examples](api-examples/) — curl recipes for every endpoint
- [Authentication](authentication/) — token model deep-dive
- [Configuration](../configuration/) — rate-limit, log-format, paths config
- [Architecture](../architecture/) — the apply pipeline + state machine
