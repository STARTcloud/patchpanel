---
title: Configuration
layout: default
nav_order: 4
permalink: /docs/configuration/
---

<!-- markdownlint-disable MD013 MD033 MD060 -->

# Configuration

{: .no_toc }

The patchpanel daemon's bootstrap configuration — what it is, where it
lives, how to edit it, and what every key does.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## What configuration patchpanel keeps where

Patchpanel has **two** persistent data surfaces. Don't confuse them.

| File                             | Purpose                                                                                            | How to edit                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `/etc/patchpanel/config.yaml`    | Bootstrap: paths, ports, TLS, auth strategy, log levels, GeoIP feature flag. Read once at startup. | Settings page in the UI, or hand-edit + restart.               |
| `/var/lib/patchpanel/state.json` | HAProxy data model: frontends, backends, routes, ACLs, certs, providers, peers.                    | Every other page in the UI, or `PUT /api/state` from a script. |

This doc covers `config.yaml`. For state.json see the [Architecture](../architecture/) page and the API reference.

## File location and lookup order

`configLoader` resolves the config file in this order ([server/src/config/configLoader.js:84](https://github.com/STARTcloud/patchpanel/blob/main/server/src/config/configLoader.js)):

1. `--config <path>` CLI flag passed to `patchpanel server`
2. `CONFIG_PATH` environment variable
3. `<install-root>/dev.config.yaml` (developer override — only present in source checkouts)
4. `/etc/patchpanel/config.yaml` (the Debian package default)

The first readable candidate wins. The systemd unit sets `CONFIG_PATH=/etc/patchpanel/config.yaml`
explicitly, so on a stock install path #2 is what loads.

Inside the Home Assistant addon the convention is `/config/config.yaml` on the addon's persistent volume — set via `CONFIG_PATH` in the addon's `run.sh`.

## File format

Patchpanel uses **metadata-wrapped YAML**: every leaf value is an object with `type`, `value`, and rendering metadata. This single schema drives both the runtime config and the Settings UI's auto-rendered form.

```yaml
server:
  port:
    type: integer
    value: 8099
    description: TCP port for the management UI and API.
    section: Server
    subsection: Bind
    order: 2
    required: true
    validation:
      min: 1
      max: 65535
```

`configLoader` walks the tree and produces two views:

- **`getConfig()`** — flat, values-only. Every leaf's `.value` hoisted in place. Application code reads this (`config.server.port` returns `8099`, not the metadata wrapper).
- **`getRawConfig()`** — original metadata tree. The Settings UI and `GET /api/config` consume this view so the form can render field types, options, validation, and conditional visibility.

A leaf is recognised by having both `type: <string>` and a `value` key. Anything missing one of those is treated as a non-leaf and walked deeper.

The top-level `_sections` block declares Settings-UI section icons + order. It's skipped during flattening.

## Editing the config

### Through the Settings UI (recommended)

Open the patchpanel UI, click **Settings**. Each top-level section becomes a card with subsection blocks inside. Edits are draft-only until you click **Save**. Most fields require a process restart to take effect — click the **Restart now** button next to Save. The UI polls `/health` for up to 60 seconds and auto-reloads when the server comes back.

Under the hood: the UI POSTs a flat `{path: value, ...}` patch to `PUT /api/config`. Each value is validated against the leaf's schema metadata (`type`, `options`, `validation.min/max`) before disk write. The first UI-driven save against a hand-written `config.yaml` preserves the original verbatim at `<configPath>.preserved-<iso>` so any operator-added comments or formatting survive.

### Hand-editing the YAML

You can edit `/etc/patchpanel/config.yaml` directly. Three caveats:

1. **The migrator may add new keys on the next start-up.** It's careful with your `value`
   edits but will inject any fields the template adds.
2. **The first save through the Settings UI strips your comments.** The UI round-trips the
   YAML through `js-yaml`'s dump; comments don't survive. A copy of the pre-save file is
   preserved at `<path>.preserved-<iso>` if the file isn't watermarked yet.
3. **Restart the process** to pick up changes — the daemon caches the config at boot.

```bash
sudo nano /etc/patchpanel/config.yaml
sudo systemctl restart patchpanel
```

### Restart endpoint

`POST /api/config/restart` sends `SIGTERM` to the running process. The systemd unit
(`Restart=on-failure`, `RestartSec=10`) or HA addon supervisor brings it back. Use this from
automation when applying a config patch via the API.

## Reference: every section

The remainder of this page is a reference. Every section in `production-config.yaml` is reproduced below with what each key does and which subsystem reads it.

### `version`

Schema marker — set by the migrator to match `package.json.version`. Don't edit this manually; the migrator overwrites it on every upgrade.

### `mode`

| Field  | Type   | Default      | What it does                                                                        |
| ------ | ------ | ------------ | ----------------------------------------------------------------------------------- |
| `mode` | select | `standalone` | Deployment surface — `standalone` (Debian baremetal) or `homeassistant` (HA addon). |

`mode` is **informational and drives path defaults**. It does NOT gate auth — `auth.strategy` does that independently. The Settings UI shows or hides the `ingressPathHeader` / `supervisorTokenEnv` fields based on `mode`.

### `server.*`

The HTTP server's bind, TLS, and graceful-shutdown behaviour.

| Field                          | Type                  | Default            | What it does                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.host`                  | host                  | `0.0.0.0`          | Bind interface. `127.0.0.1` to bind localhost only.                                                                                                                                                                                                                                                                                               |
| `server.port`                  | integer (1–65535)     | `8099`             | TCP port.                                                                                                                                                                                                                                                                                                                                         |
| `server.trustProxy`            | array of CIDR strings | `[]`               | Trusted upstream proxies for `X-Forwarded-*` and HA ingress headers. The auth middleware uses this for the `ha-ingress` strategy's source-IP gate. Only `/32` and `/128` entries are matched exactly; wider CIDR ranges aren't supported for the ingress gate (Express's own `trust proxy` setting handles forwarded-for unwinding for `req.ip`). |
| `server.shutdownGracePeriodMs` | integer (0–60000)     | `10000`            | Time to drain in-flight requests on SIGTERM before forced exit.                                                                                                                                                                                                                                                                                   |
| `server.ingressPathHeader`     | string                | `X-Ingress-Path`   | Header carrying the HA ingress URL prefix. Only used when `mode=homeassistant`.                                                                                                                                                                                                                                                                   |
| `server.supervisorTokenEnv`    | string                | `SUPERVISOR_TOKEN` | Env var name holding the HA supervisor token. Used for HA API callbacks.                                                                                                                                                                                                                                                                          |

### `ssl.*`

TLS termination for the **management UI itself**. Independent of HAProxy's own TLS — HAProxy reads its own crt-list, set up via the Certificates page.

| Field                  | Type     | Default                        | What it does                                                         |
| ---------------------- | -------- | ------------------------------ | -------------------------------------------------------------------- |
| `ssl.enabled`          | bool     | `true`                         | Serve the management UI over HTTPS.                                  |
| `ssl.generate`         | bool     | `true`                         | Generate a self-signed cert on first run if `certPath` is missing.   |
| `ssl.certPath`         | string   | `/etc/patchpanel/ssl/cert.pem` | TLS certificate (PEM).                                               |
| `ssl.keyPath`          | string   | `/etc/patchpanel/ssl/key.pem`  | TLS private key (PEM, mode 0600).                                    |
| `ssl.minVersion`       | select   | `TLSv1.2`                      | Minimum protocol version.                                            |
| `ssl.maxVersion`       | select   | `TLSv1.3`                      | Maximum protocol version.                                            |
| `ssl.ciphers`          | textarea | ECDHE list                     | OpenSSL cipher list.                                                 |
| `ssl.honorCipherOrder` | bool     | `true`                         | Server picks cipher from its own preference order, not the client's. |

To run the management UI behind a Let's Encrypt cert that patchpanel itself issues for
HAProxy, point `certPath` / `keyPath` at the `/etc/letsencrypt/live/<host>/` symlinks and
set `ssl.generate: false` so the daemon doesn't overwrite them.

### `paths.*`

Every filesystem path the daemon reads or writes. Group by subsection.

#### Data (`/var/lib/patchpanel/`)

| Field                | Default                               | Notes                                                                           |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `paths.state`        | `/var/lib/patchpanel/state.json`      | Canonical HAProxy state document — what the renderer consumes.                  |
| `paths.audit`        | `/var/lib/patchpanel/audit.sqlite`    | SQLite audit log of every state mutation.                                       |
| `paths.snapshotsDir` | `/var/lib/patchpanel/snapshots`       | Time-machine snapshots of the state document.                                   |
| `paths.geoipDir`     | `/var/lib/patchpanel/geoip`           | MaxMind / DB-IP MMDB store.                                                     |
| `paths.credentials`  | `/var/lib/patchpanel/credentials`     | ACME account keys + DNS provider credential files.                              |
| `paths.options`      | `null`                                | HA addon `options.json` path. Null in standalone.                               |
| `paths.users`        | `/var/lib/patchpanel/users.json`      | Local user accounts (bcrypt-hashed passwords). Mode 0600.                       |
| `paths.apiTokens`    | `/var/lib/patchpanel/api-tokens.json` | API tokens (bcrypt-hashed secrets). Mode 0600.                                  |
| `paths.setupToken`   | `/etc/patchpanel/setup.token`         | One-time first-run wizard token. Postinst generates; wizard consumes + deletes. |

#### HAProxy (`/etc/haproxy/`, `/run/haproxy/`)

| Field                        | Default                      | Notes                                                          |
| ---------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `paths.haproxyConfig`        | `/etc/haproxy/haproxy.cfg`   | Where the rendered cfg is atomically swapped.                  |
| `paths.haproxyCertsList`     | `/etc/haproxy/certs.list`    | crt-list file referenced from `bind ssl`.                      |
| `paths.haproxyCertsDir`      | `/etc/haproxy/certs`         | Cert directory referenced from crt-list.                       |
| `paths.haproxyMasterSocket`  | `/run/haproxy/master.sock`   | Master CLI socket — used to reload zero-downtime.              |
| `paths.haproxyStatsSocket`   | `/run/haproxy/admin.sock`    | Runtime stats / admin socket — per-server state, weights, etc. |
| `paths.haproxyPidFile`       | `/run/haproxy.pid`           | Used by the `systemctl` control strategy.                      |
| `paths.haproxyBin`           | `/usr/sbin/haproxy`          | Binary used for `haproxy -c` validation.                       |
| `paths.haproxyErrorPagesDir` | `/var/lib/patchpanel/errors` | Custom HTTP error pages.                                       |
| `paths.haproxyMapsDir`       | `/etc/haproxy/maps`          | HAProxy map files (one per `state.maps[]`).                    |

#### Keepalived (`/etc/keepalived/`, `/run/`)

| Field                     | Default                           | Notes                       |
| ------------------------- | --------------------------------- | --------------------------- |
| `paths.keepalivedConfig`  | `/etc/keepalived/keepalived.conf` | Rendered keepalived config. |
| `paths.keepalivedPidFile` | `/run/keepalived.pid`             | PID file.                   |
| `paths.keepalivedBin`     | `/usr/sbin/keepalived`            | Binary.                     |

#### Cluster (`/etc/patchpanel/`)

| Field              | Default                      | Notes                                                                                   |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| `paths.nodeConfig` | `/etc/patchpanel/node.yaml`  | Per-node identity (nodeId, VRRP priority overrides). NEVER syncs between cluster peers. |
| `paths.peersStore` | `/etc/patchpanel/peers.json` | Paired peer URLs + tokens. Mode 0600.                                                   |

#### Certificates

| Field                  | Default                                | Notes                                                             |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `paths.trustedCasDir`  | `/var/lib/patchpanel/trusted-cas`      | Uploaded CA bundles for mTLS validation + upstream verify.        |
| `paths.trustedCrlsDir` | `/var/lib/patchpanel/trusted-crls`     | Uploaded CRLs.                                                    |
| `paths.byoCertsDir`    | `/var/lib/patchpanel/certs/byo`        | Bring-your-own PEM uploads (renewed externally).                  |
| `paths.letsencryptDir` | `/etc/letsencrypt`                     | Certbot's account + cert store (unchanged from certbot defaults). |
| `paths.letsencryptLog` | `/var/log/letsencrypt/letsencrypt.log` | Tailed by the live-logs SSE endpoint.                             |
| `paths.certbotBin`     | `/usr/bin/certbot`                     | Certbot binary.                                                   |

#### Lua plugins

| Field                  | Default                             | Notes                                                                       |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `paths.luaPluginsDirs` | `[/var/lib/patchpanel/lua-plugins]` | Whitelist of allowed upload roots. Plugins outside these dirs are rejected. |

#### Internal

| Field                | Default                           | Notes                                                                                          |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `paths.templatesDir` | `/usr/share/patchpanel/templates` | Rendering templates (read-only, shipped with the package).                                     |
| `paths.webDir`       | `/opt/patchpanel/web/dist`        | Built React frontend.                                                                          |
| `paths.webDirDebug`  | `/opt/patchpanel/web/dist-debug`  | Development bundle. Served when `PATCHPANEL_DEBUG_UI=1`;<br>falls back to `webDir` if missing. |

### `haproxy.reload.*`

How patchpanel reloads HAProxy after a config swap.

| Field                                 | Type   | Default         | What it does                                                          |
| ------------------------------------- | ------ | --------------- | --------------------------------------------------------------------- |
| `haproxy.reload.method`               | select | `master-socket` | One of `master-socket` (zero-downtime), `systemctl`, `child-process`. |
| `haproxy.reload.hardStopAfter`        | string | `30s`           | Old worker drain deadline before forced termination.                  |
| `haproxy.reload.validateBeforeReload` | bool   | `true`          | Run `haproxy -c` against the rendered cfg before swapping.            |
| `haproxy.reload.rollbackOnFailure`    | bool   | `true`          | Restore previous cfg + reload if the new cfg fails validation.        |

### `renewal.*`

Let's Encrypt renewal scheduler defaults.

| Field                               | Type             | Default       | What it does                                                                      |
| ----------------------------------- | ---------------- | ------------- | --------------------------------------------------------------------------------- |
| `renewal.schedule`                  | string           | `5 8 * * 1,4` | Cron expression — Monday/Thursday 08:05 by default.                               |
| `renewal.defaultPropagationSeconds` | integer (0–3600) | `120`         | DNS-01 propagation wait. Cloudflare's 10s default is too short for ≥20 SAN certs. |

### `auth.strategy`

| Field           | Type   | Default | What it does                            |
| --------------- | ------ | ------- | --------------------------------------- |
| `auth.strategy` | select | `local` | One of `none` / `ha-ingress` / `local`. |

- `local` — cookie session (JWT) + Bearer API tokens. Default for Debian baremetal.
- `ha-ingress` — trust the HA supervisor proxy IP (listed in `server.trustProxy`). Users authenticate to Home Assistant upstream; requests through ingress are treated as admin.
- `none` — no auth. Dev only — never on a network-exposed deployment. Logs a startup warning.

See the [Authentication guide](guides/authentication/) for the full model.

### `security.*`

Cookie/JWT secret + session defaults + bcrypt cost + HTTPS hardening.

| Field                            | Type            | Default                                             | What it does                                                                                                                                                                                                                                          |
| -------------------------------- | --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `security.jwtSecret`             | password        | `__JWT_SECRET_FROM_FILE__` (substituted at install) | Session/JWT signing key. The postinst generates 32 random bytes via `openssl rand -hex 32`, writes them to `/etc/patchpanel/.jwt-secret` (mode 0600), and substitutes the placeholder. The migrator does the same belt-and-suspenders on first start. |
| `security.jwtExpiry`             | string          | `24h`                                               | JWT lifetime — `1h`, `24h`, `7d`, `30m`, etc.                                                                                                                                                                                                         |
| `security.sessionCookieName`     | string          | `patchpanel.sid`                                    | Browser session cookie name.                                                                                                                                                                                                                          |
| `security.sessionSecure`         | bool            | `true`                                              | Send the cookie only over HTTPS.                                                                                                                                                                                                                      |
| `security.sessionSameSite`       | select          | `lax`                                               | SameSite policy.                                                                                                                                                                                                                                      |
| `security.bcryptRounds`          | integer (10–15) | `12`                                                | Cost factor for passwords and API tokens.                                                                                                                                                                                                             |
| `security.apiKeyEncryptEnabled`  | bool            | `false`                                             | Reserved — patchpanel's tokens are bcrypt-hashed only; no plaintext-recovery path exists regardless of this flag.                                                                                                                                     |
| `security.csrfEnabled`           | bool            | `true`                                              | Lusca CSRF on cookie-authenticated routes. `/api/*` bypasses CSRF (JSON bodies + Bearer auth model).                                                                                                                                                  |
| `security.helmetEnabled`         | bool            | `true`                                              | Helmet middleware (CSP, HSTS, XFO, noSniff, referrerPolicy).                                                                                                                                                                                          |
| `security.hstsEnabled`           | bool            | `true`                                              | Strict-Transport-Security header.                                                                                                                                                                                                                     |
| `security.hstsMaxAge`            | integer         | `31536000`                                          | HSTS max-age in seconds (1 year).                                                                                                                                                                                                                     |
| `security.hstsIncludeSubdomains` | bool            | `true`                                              | Apply HSTS to all subdomains.                                                                                                                                                                                                                         |
| `security.hstsPreload`           | bool            | `false`                                             | Include the preload directive — only enable after submission to <hstspreload.org>.                                                                                                                                                                    |

### `cors.*`

| Field              | Type  | Default | What it does                                                       |
| ------------------ | ----- | ------- | ------------------------------------------------------------------ |
| `cors.enabled`     | bool  | `true`  | Enable CORS middleware.                                            |
| `cors.whitelist`   | array | `[]`    | Allowed origin URLs (exact match). Empty = same-origin only.       |
| `cors.credentials` | bool  | `true`  | Send `Access-Control-Allow-Credentials`. Required for cookie auth. |

### `rateLimit.*`

Tiered rate limits — separate buckets for auth, write, and read traffic.

| Field                     | Type    | Default  | What it does                       |
| ------------------------- | ------- | -------- | ---------------------------------- |
| `rateLimit.authWindowMs`  | integer | `900000` | Window for the auth tier (15 min). |
| `rateLimit.authMax`       | integer | `25`     | Max auth requests per window.      |
| `rateLimit.writeWindowMs` | integer | `60000`  | Window for write endpoints.        |
| `rateLimit.writeMax`      | integer | `60`     | Max writes per window.             |
| `rateLimit.readWindowMs`  | integer | `60000`  | Window for read endpoints.         |
| `rateLimit.readMax`       | integer | `1000`   | Max reads per window.              |

### `logging.*`

Backend log level + destination.

| Field                        | Type              | Default               | What it does                                                           |
| ---------------------------- | ----------------- | --------------------- | ---------------------------------------------------------------------- |
| `logging.level`              | select            | `info`                | Minimum level — `error`/`warn`/`info`/`debug`/`trace`.                 |
| `logging.format`             | select            | `pretty`              | `pretty` for the HA log viewer / journald; `json` for log aggregators. |
| `logging.directory`          | string            | `/var/log/patchpanel` | File-rotated log directory. journald is the primary sink.              |
| `logging.auditRetentionDays` | integer (30–3650) | `365`                 | Days of audit-log history to retain before vacuuming.                  |

### `frontendLogging.*`

Browser-side logger config. Returned in the `/health` response and consumed by the React UI's `Logger.js` on first call. Edit these to crank verbosity in production browsers without rebuilding the frontend.

| Field                                | Type   | Default | What it does                                                                                                                                                                                                                                               |
| ------------------------------------ | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontendLogging.enabled`            | bool   | `true`  | Master switch. When off, the SPA silences every category<br>and stops shipping unhandled errors to `/api/client-errors`.                                                                                                                                   |
| `frontendLogging.level`              | select | `info`  | Default level for every category that has no explicit override below.<br>Errors are always captured at error level via the ErrorBoundary + window listeners<br>and shipped to `/api/client-errors` regardless of this setting (unless `enabled` is false). |
| `frontendLogging.categories.app`     | select | `info`  | Generic UI plumbing (Layout, theme, routing).                                                                                                                                                                                                              |
| `frontendLogging.categories.auth`    | select | `info`  | Login, logout, session probe, token CRUD, setup wizard.                                                                                                                                                                                                    |
| `frontendLogging.categories.api`     | select | `info`  | API client wrappers, OpenAPI viewer, /api-docs page.                                                                                                                                                                                                       |
| `frontendLogging.categories.state`   | select | `info`  | State document reads/writes, snapshots, raw state.                                                                                                                                                                                                         |
| `frontendLogging.categories.haproxy` | select | `info`  | Runtime control, stats sockets, server states.                                                                                                                                                                                                             |
| `frontendLogging.categories.cert`    | select | `info`  | Let's Encrypt, BYO certs, trusted CAs, CRLs.                                                                                                                                                                                                               |
| `frontendLogging.categories.peer`    | select | `info`  | Cluster sync, peer pairing, keepalived/VRRP.                                                                                                                                                                                                               |
| `frontendLogging.categories.error`   | select | `info`  | ErrorBoundary + `window.onerror` + `unhandledrejection` capture. Raising above `error` disables error capture — leave at `info` or lower.                                                                                                                  |

### `geoip.*`

GeoIP enrichment for the dashboard origin panels.

| Field                    | Type   | Default                                        | What it does                                                        |
| ------------------------ | ------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| `geoip.enabled`          | bool   | `false`                                        | Master switch.                                                      |
| `geoip.dbPath`           | string | `/var/lib/patchpanel/geoip/GeoLite2-City.mmdb` | MaxMind / DB-IP MMDB path.                                          |
| `geoip.fallbackProvider` | select | `none`                                         | HTTP fallback when MMDB lookup misses — `none`, `ip-api`, `ipinfo`. |
| `geoip.updateSchedule`   | string | `0 4 * * 0`                                    | Cron expression for MMDB auto-update. Default weekly Sun 04:00.     |

## Special fields: lifecycle behaviours

### The JWT secret (`security.jwtSecret`)

Generated and substituted **twice** for belt-and-suspenders:

1. **postinst** writes `/etc/patchpanel/.jwt-secret` via `openssl rand -hex 32`
   (mode 0600, owner `patchpanel:patchpanel`). Then `sed -i` substitutes `__JWT_SECRET_FROM_FILE__`
   placeholder in the freshly-copied `/etc/patchpanel/config.yaml` with the secret.
2. **configMigrator** at first daemon start does the same check — if `security.jwtSecret.value`
   is empty / the placeholder / contains `change-this` / contains `example`, it generates a new secret and rewrites the file.

The sidecar file `.jwt-secret` exists so external scripts (systemd reload helpers, monitoring) can read the secret without parsing YAML.

### The setup token (`paths.setupToken`)

Generated by postinst on **fresh install only** (`openssl rand -hex 32 > /etc/patchpanel/setup.token`, mode 0600).
Consumed by `POST /api/setup/complete` after the operator creates the first admin user.
The file is deleted on successful consumption — the setup wizard is single-shot.

The wizard requires **both** the token file present AND `users.json` empty. Either alone won't open
the setup flow — prevents stale-token replay and prevents racing the wizard on an installed-but-never-opened deployment.

Recovery if locked out after the token's been consumed:

```bash
sudo patchpanel user-add --username admin2     # create a new admin
sudo patchpanel user-reset --username admin    # reset existing admin's password
```

### Watermark and preservation (`config-write.js`)

Every save through `PUT /api/config` prepends a watermark header to the file:

```yaml
# patchpanel-managed config — written by /api/config
# UI-driven saves rewrite this file; comments do not survive the round-trip.
```

On the **first** save, if the existing file does NOT carry the watermark, `writeRawConfig` copies it
verbatim to `<configPath>.preserved-<iso>` first. Operators who hand-edited a config and then used
the UI find their original at `/etc/patchpanel/config.yaml.preserved-2026-05-17T12-34-56Z`. Subsequent saves don't re-preserve.

The migrator emits its own watermark header on fresh installs and version upgrades — so the first UI
save against a migrator-written config doesn't create a redundant `.preserved-*` sidecar.

### Migration on version upgrade

`configMigrator` runs at every daemon start ([server/src/config/configMigrator.js](https://github.com/STARTcloud/patchpanel/blob/main/server/src/config/configMigrator.js)). It diffs `config.version` against `package.json.version` and:

- **`up_to_date`** — versions match, no-op.
- **`fresh_install`** — no existing config; writes the template, JWT secret, version stamp.
- **`version_mismatch`** — runs `jsonMerger.mergeFiles([template, userConfig])` so new template
  keys appear and your `.value` edits survive. Pre-merge, a timestamped backup is written to `<configPath>.backup.<ISO-timestamp>`.

The migrator is **not a data migrator** — it doesn't transform your values across versions. New
template fields simply appear with their defaults; removed template fields linger in the user config until manually cleaned.

If a dev override exists (`<repo>/dev.config.yaml`), the migrator becomes a no-op (you're presumed
to be hacking on patchpanel and don't want background rewrites).

## Environment variables

The daemon respects:

| Var                             | Set by                         | Purpose                                                                                      |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                   | systemd unit, HA addon run.sh  | Override the config-file lookup.                                                             |
| `NODE_ENV`                      | systemd unit (`production`)    | Conventional Node lib gate.                                                                  |
| `NODE_OPTIONS=--use-openssl-ca` | systemd unit                   | Trust the system CA store for outbound HTTPS (corporate CAs, etc.).                          |
| `PATCHPANEL_DEBUG_UI`           | HA addon when `debug_ui: true` | Serve the development React bundle (`paths.webDirDebug`)<br>instead of the production build. |
| `SUPERVISOR_TOKEN`              | HA supervisor                  | HA API token for callbacks. Name configurable via `server.supervisorTokenEnv`.               |

## Troubleshooting

### "Cannot read config"

`configLoader` throws if none of the candidate paths exist. Check:

```bash
sudo ls -l /etc/patchpanel/config.yaml
sudo journalctl -u patchpanel -n 50
```

If the file is missing, reinstall the package (`sudo apt install --reinstall patchpanel`) —
the postinst re-seeds from the template only when the file is absent.

### "haproxy -c failed: ..."

Your state document rendered an invalid HAProxy config. The state apply pipeline catches this
and rolls back automatically — no half-applied state. Check the HAProxy stderr in the API error response, the audit log (`GET /api/audit?category=state`), or `journalctl -u patchpanel`.

### Setup token regeneration

If you lost the setup token but the wizard hasn't run yet (no users):

```bash
openssl rand -hex 32 | sudo tee /etc/patchpanel/setup.token
sudo chown patchpanel:patchpanel /etc/patchpanel/setup.token
sudo chmod 600 /etc/patchpanel/setup.token
```

Open `https://<host>:8099/setup-admin?token=$(sudo cat /etc/patchpanel/setup.token)`.

### Reverting an unwanted config change

Backups live at `/etc/patchpanel/config.yaml.backup.<ISO-timestamp>` (migrator) or `/etc/patchpanel/config.yaml.preserved-<iso>` (first-save UI). Copy one back and `systemctl restart patchpanel`.

## See also

- [Installation guide](guides/installation/) — apt install + first-run setup
- [Authentication guide](guides/authentication/) — `auth.strategy` deep-dive
- [Architecture](architecture/) — how config feeds into the state-driven render pipeline
- `patchpanel(8)` and `patchpanel.yaml(5)` manpages (installed by the package)
