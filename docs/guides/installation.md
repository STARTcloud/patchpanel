---
title: Installation
layout: default
parent: Guides
nav_order: 2
permalink: /docs/guides/installation/
---

# Installation

{: .no_toc }

Production-grade install reference for patchpanel — Debian package
from the STARTcloud apt repository, manual `.deb` builds from source,
the Home Assistant add-on, plus upgrades, uninstalls, monitoring, and
disaster recovery.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## Choose an install mode

| Mode                                     | When to use                                      | Where docs live                                                         |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| **Debian package** (STARTcloud apt repo) | Standalone host. Production default.             | This page.                                                              |
| **Manual `.deb` build**                  | Forks, custom patches, air-gapped builds.        | This page, [§ Manual `.deb` build](#manual-deb-build).                  |
| **Home Assistant add-on**                | HA users who want patchpanel as a managed addon. | [§ Home Assistant add-on](#home-assistant-add-on) + the HA add-on repo. |

The Debian package is the path of least surprise. The HA add-on bundles
the same patchpanel server inside the supervisor's container, with HA's
ingress handling auth + TLS.

## System requirements

| Requirement                                  | Why                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Debian 12 (bookworm) or 13 (trixie), amd64   | What the apt repo ships for                                                                                      |
| Node.js ≥ 22.0.0                             | `Depends` in the package; systemd unit calls `/usr/bin/node`                                                     |
| HAProxy ≥ 2.6                                | Master CLI socket reload requires master-worker mode                                                             |
| certbot                                      | Let's Encrypt issuance + renewal                                                                                 |
| openssl                                      | postinst uses `openssl rand -hex 32` for JWT secret + setup token                                                |
| `python3-certbot-dns-*` plugins (Recommends) | For DNS-01 issuance. Cloudflare / Route 53 / Google / DigitalOcean ship in the apt repo                          |
| RAM: 512 MiB                                 | systemd unit sets `MemoryMax=512M`                                                                               |
| Disk                                         | A few hundred MB for the install. `/var/lib/patchpanel/audit.sqlite` grows with use — default retention 365 days |
| Arch                                         | `amd64` only currently                                                                                           |

## Install via apt (standalone Debian)

```bash
# 1. Trust the STARTcloud apt repo GPG key
curl -fsSL https://packages.debian.startcloud.com/debian/startcloud.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/startcloud-archive-keyring.gpg

# 2. Add the repo (use 'bookworm', 'trixie', or 'stable')
echo "deb [signed-by=/usr/share/keyrings/startcloud-archive-keyring.gpg] \
  https://packages.debian.startcloud.com/debian stable main" \
  | sudo tee /etc/apt/sources.list.d/startcloud.list

# 3. Install
sudo apt update
sudo apt install patchpanel

# 4. Enable + start
sudo systemctl enable --now patchpanel
sudo journalctl -fu patchpanel       # watch the boot
```

The postinst:

1. Creates the `patchpanel` system user (group `patchpanel`, home
   `/opt/patchpanel`, shell `/usr/sbin/nologin`).
2. Adds `patchpanel` to the `haproxy` group so the daemon can rewrite
   `/etc/haproxy/haproxy.cfg`.
3. Creates directories: `/var/lib/patchpanel`, `/var/log/patchpanel`,
   `/etc/patchpanel`, `/etc/patchpanel/ssl` (mode 0700).
4. Copies `production-config.yaml` to `/etc/patchpanel/config.yaml`
   **only if it doesn't already exist** (preserves your config across
   reinstalls).
5. Generates `/etc/patchpanel/.jwt-secret` (32 hex bytes, mode 0600)
   and substitutes the placeholder in `config.yaml`.
6. Generates `/etc/patchpanel/setup.token` (mode 0600) — **fresh
   install only**, never overwritten on upgrade.
7. Prints a banner with the first-run URL:

```text
=================================================================
  PatchPanel installed.

  Config:    /etc/patchpanel/config.yaml
  Data:      /var/lib/patchpanel/
  Logs:      journalctl -fu patchpanel

  Start:     systemctl enable --now patchpanel

  First-run setup URL (one-time, consumed by the wizard):
    https://your-host:8099/setup-admin?token=...

  Or if you forget the URL, the token alone is in:
    /etc/patchpanel/setup.token

  Recovery (if locked out later):
    patchpanel user-add --username admin
    patchpanel user-reset --username admin
=================================================================
```

Open the URL and follow the [Getting Started guide](getting-started/)
to claim the admin account and run the onboarding wizard.

## Filesystem layout after install

| Path                                       | Owner                                      | Mode | Purpose                                                                                                                          |
| ------------------------------------------ | ------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/patchpanel/`                         | `patchpanel:patchpanel`                    | 755  | App code: hoisted `node_modules/`, `server/`, `web/dist/`, optional `web/dist-debug/`, `config-templates/production-config.yaml` |
| `/opt/patchpanel/bin/patchpanel`           | `root:root`                                | 755  | CLI dispatcher                                                                                                                   |
| `/usr/bin/patchpanel`                      | symlink → `/opt/patchpanel/bin/patchpanel` | —    | On `$PATH`                                                                                                                       |
| `/etc/systemd/system/patchpanel.service`   | `root:root`                                | 644  | systemd unit                                                                                                                     |
| `/etc/patchpanel/`                         | `patchpanel:patchpanel`                    | 755  | Bootstrap config dir                                                                                                             |
| `/etc/patchpanel/config.yaml`              | `patchpanel:patchpanel`                    | 640  | Bootstrap YAML                                                                                                                   |
| `/etc/patchpanel/.jwt-secret`              | `patchpanel:patchpanel`                    | 600  | JWT signing key                                                                                                                  |
| `/etc/patchpanel/setup.token`              | `patchpanel:patchpanel`                    | 600  | One-shot first-run gate (deleted after wizard consumes it)                                                                       |
| `/etc/patchpanel/ssl/`                     | `patchpanel:patchpanel`                    | 700  | Management UI TLS cert + key                                                                                                     |
| `/etc/patchpanel/node.yaml`                | `patchpanel:patchpanel`                    | 644  | Per-node identity (cluster mode — never syncs)                                                                                   |
| `/etc/patchpanel/peers.json`               | `patchpanel:patchpanel`                    | 600  | Paired peer URLs + outbound tokens                                                                                               |
| `/var/lib/patchpanel/`                     | `patchpanel:patchpanel`                    | 755  | Runtime data                                                                                                                     |
| `/var/lib/patchpanel/state.json`           | `patchpanel:patchpanel`                    | —    | Canonical HAProxy state document                                                                                                 |
| `/var/lib/patchpanel/audit.sqlite`         | `patchpanel:patchpanel`                    | —    | SQLite audit log                                                                                                                 |
| `/var/lib/patchpanel/snapshots/`           | `patchpanel:patchpanel`                    | —    | Time-machine snapshots                                                                                                           |
| `/var/lib/patchpanel/users.json`           | `patchpanel:patchpanel`                    | 600  | Local users (bcrypt-hashed)                                                                                                      |
| `/var/lib/patchpanel/api-tokens.json`      | `patchpanel:patchpanel`                    | 600  | API tokens (bcrypt-hashed)                                                                                                       |
| `/var/lib/patchpanel/trusted-cas/`         | `patchpanel:patchpanel`                    | —    | Uploaded CA bundles                                                                                                              |
| `/var/lib/patchpanel/trusted-crls/`        | `patchpanel:patchpanel`                    | —    | Uploaded CRLs                                                                                                                    |
| `/var/lib/patchpanel/certs/byo/`           | `patchpanel:patchpanel`                    | —    | BYO PEM uploads                                                                                                                  |
| `/var/lib/patchpanel/errors/`              | `patchpanel:patchpanel`                    | —    | Custom HTTP error pages                                                                                                          |
| `/var/lib/patchpanel/lua-plugins/`         | `patchpanel:patchpanel`                    | —    | Lua plugin upload root                                                                                                           |
| `/var/lib/patchpanel/credentials/`         | `patchpanel:patchpanel`                    | —    | ACME account keys + DNS provider creds                                                                                           |
| `/var/lib/patchpanel/geoip/`               | `patchpanel:patchpanel`                    | —    | MMDB store                                                                                                                       |
| `/var/log/patchpanel/`                     | `patchpanel:patchpanel`                    | 755  | File-rotated logs (journald is the primary sink)                                                                                 |
| `/etc/haproxy/haproxy.cfg`                 | `root:haproxy`, rw via group               | —    | Rendered cfg — managed, never hand-edit                                                                                          |
| `/etc/haproxy/certs.list`                  | `root:haproxy`, rw via group               | —    | crt-list referenced by `bind ssl`                                                                                                |
| `/etc/haproxy/certs/`                      | `root:haproxy`, rw via group               | —    | Cert files referenced from crt-list                                                                                              |
| `/etc/haproxy/maps/`                       | `root:haproxy`, rw via group               | —    | HAProxy map files (one per `state.maps[]`)                                                                                       |
| `/run/haproxy/master.sock`                 | (haproxy)                                  | —    | Master CLI socket — used to reload                                                                                               |
| `/run/haproxy/admin.sock`                  | (haproxy)                                  | —    | Runtime stats socket                                                                                                             |
| `/etc/letsencrypt/`                        | `root:root`                                | —    | certbot account + cert store (standard)                                                                                          |
| `/usr/share/man/man8/patchpanel.8.gz`      | `root:root`                                | 644  | CLI manpage                                                                                                                      |
| `/usr/share/man/man5/patchpanel.yaml.5.gz` | `root:root`                                | 644  | Config-file manpage                                                                                                              |

## systemd unit

The unit lives at `/etc/systemd/system/patchpanel.service`:

```ini
[Unit]
Description=PatchPanel - State-driven HAProxy management UI
Documentation=https://patchpanel.startcloud.com/
After=network.target
Wants=network.target

[Service]
Type=simple
User=patchpanel
Group=patchpanel
Environment=NODE_ENV=production
Environment=CONFIG_PATH=/etc/patchpanel/config.yaml
Environment=NODE_OPTIONS=--use-openssl-ca
WorkingDirectory=/opt/patchpanel
ExecStart=/usr/bin/node server/src/server.js
Restart=on-failure
RestartSec=10

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/patchpanel /var/log/patchpanel /etc/patchpanel /etc/haproxy /run/haproxy
PrivateTmp=yes

# Bind privileged ports (80/443) without root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=patchpanel

# Resource limits — config manager, not heavy
MemoryMax=512M
TasksMax=100

[Install]
WantedBy=multi-user.target
```

Notable hardening:

- **`User=patchpanel`** — unprivileged service account. Membership in
  `haproxy` group is what lets it rewrite `/etc/haproxy/haproxy.cfg`.
- **`ProtectSystem=strict`** — root filesystem is read-only for the
  service. `ReadWritePaths` enumerates the only writable spots.
- **`NoNewPrivileges=yes`** — process can't gain new privs via setuid.
- **`AmbientCapabilities=CAP_NET_BIND_SERVICE`** — bind ports <1024
  without root (patchpanel itself defaults to `:8099` so this is
  defensive; matters more if you change `server.port` to 443).
- **`NODE_OPTIONS=--use-openssl-ca`** — Node trusts the system CA
  store, not the bundled Mozilla list. Required for corporate CAs.
- **`MemoryMax=512M`** — generous ceiling. patchpanel is a config
  manager, not a hot path.

If you customise the unit, drop your overrides in
`/etc/systemd/system/patchpanel.service.d/override.conf` rather than
editing the shipped file. Run `sudo systemctl daemon-reload` after.

## TLS for the management UI

Three options:

### Self-signed (default)

Generated on first run if `/etc/patchpanel/ssl/cert.pem` is missing.
Browsers will show a warning. Acceptable for private networks.

```yaml
ssl:
  enabled:
    value: true
  generate:
    value: true # auto-gen on first boot
  certPath:
    value: /etc/patchpanel/ssl/cert.pem
  keyPath:
    value: /etc/patchpanel/ssl/key.pem
```

### Bring-your-own PEM

Drop PEMs at `/etc/patchpanel/ssl/cert.pem` + `key.pem` (chown
`patchpanel:patchpanel`, mode 0640 + 0600). Set `ssl.generate: false`
so the daemon doesn't overwrite. Restart.

### Use a Let's Encrypt cert patchpanel issued for HAProxy

Point `ssl.certPath` and `ssl.keyPath` at the certbot live symlinks:

```yaml
ssl:
  generate:
    value: false
  certPath:
    value: /etc/letsencrypt/live/your-host/fullchain.pem
  keyPath:
    value: /etc/letsencrypt/live/your-host/privkey.pem
```

The `patchpanel` user needs read access to those paths. Either symlink
them somewhere the user can read, or apply an ACL:

```bash
sudo setfacl -R -m u:patchpanel:rX /etc/letsencrypt/{archive,live}
sudo setfacl -dR -m u:patchpanel:rX /etc/letsencrypt/{archive,live}
```

Restart patchpanel. After every renewal you may need to re-run the
ACL command unless you add a certbot deploy hook.

## Reverse-proxy posture (optional)

patchpanel terminates its own TLS by default — no reverse proxy
required. If you want to put nginx or caddy in front:

1. Set `server.host` to `127.0.0.1` so patchpanel only listens
   locally.
2. Add the proxy's IP to `server.trustProxy` so `X-Forwarded-*`
   headers are honoured.
3. Set `ssl.enabled: false` if the proxy is terminating TLS.
4. Forward the original Host + protocol headers.

nginx example:

```nginx
server {
    listen 443 ssl;
    server_name patchpanel.example.com;

    ssl_certificate /etc/letsencrypt/live/patchpanel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/patchpanel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE endpoints (live logs / events)
        proxy_buffering off;
        proxy_read_timeout 24h;
    }
}
```

Then in `config.yaml`:

```yaml
server:
  host:
    value: 127.0.0.1
  trustProxy:
    value: ['127.0.0.1/32']
ssl:
  enabled:
    value: false
```

## Upgrades

```bash
sudo apt update
sudo apt upgrade patchpanel
```

What happens:

1. **`preinst`** runs (logs `Upgrading PatchPanel...`, no destructive
   action).
2. **Files unpacked** into `/opt/patchpanel/`.
3. **`postinst configure`** runs but skips the config-copy step
   because `/etc/patchpanel/config.yaml` exists. JWT secret and setup
   token are preserved.
4. **`systemctl daemon-reload`** (if running on systemd).
5. **Next daemon start** — `configMigrator` checks the version stamp.
   If `package.json.version !== config.yaml.version`, it merges any
   new template keys into your config (preserving your `.value`
   edits) and writes a timestamped backup at
   `/etc/patchpanel/config.yaml.backup.<ISO-timestamp>`.
6. **The daemon restarts itself** if you triggered the upgrade via
   the UI's restart button; otherwise:

   ```bash
   sudo systemctl restart patchpanel
   ```

If the migration fails for any reason, the migrator restores the
backup automatically.

The state document (`/var/lib/patchpanel/state.json`) is **not**
touched by the migrator — its Zod schema is versionless. If a schema
change breaks your existing state, the daemon boots in safe-mode (see
[§ Disaster recovery](#disaster-recovery)) and you fix it via the
**Raw State** UI tab.

## Uninstall

### Keep data — `apt remove`

```bash
sudo apt remove patchpanel
```

- Stops + disables the service.
- Removes `/opt/patchpanel/`, the systemd unit, the symlink, the
  manpages.
- **Keeps** `/etc/patchpanel/`, `/var/lib/patchpanel/`,
  `/var/log/patchpanel/`, the `patchpanel` system user. Reinstall
  later picks up where you left off.

### Wipe everything — `apt purge`

```bash
sudo apt purge patchpanel
```

- Everything `apt remove` does, plus
- `rm -rf /var/lib/patchpanel /var/log/patchpanel /etc/patchpanel`
- `deluser patchpanel`

**Irreversible.** Back up `/var/lib/patchpanel/state.json` and
`audit.sqlite` first if there's any chance you'll reinstall.

`apt purge` does NOT touch `/etc/haproxy/haproxy.cfg` or
`/etc/letsencrypt/`. Those belong to other packages.

## Backup recipes

What to back up:

| Path                                                              | Why                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/var/lib/patchpanel/state.json`                                  | The canonical config. Replace this and patchpanel re-renders haproxy.cfg from scratch. |
| `/var/lib/patchpanel/audit.sqlite`                                | History — useful for compliance + post-incident review.                                |
| `/var/lib/patchpanel/snapshots/`                                  | Point-in-time rollback.                                                                |
| `/var/lib/patchpanel/users.json`                                  | Local user accounts (bcrypt-hashed).                                                   |
| `/var/lib/patchpanel/api-tokens.json`                             | API tokens.                                                                            |
| `/var/lib/patchpanel/trusted-cas/`, `trusted-crls/`, `certs/byo/` | Uploaded PEMs (not derivable).                                                         |
| `/etc/patchpanel/config.yaml`                                     | Bootstrap config.                                                                      |
| `/etc/patchpanel/.jwt-secret`                                     | JWT signing key. Restore this and existing browser sessions keep working.              |
| `/etc/letsencrypt/`                                               | certbot account + LE certs.                                                            |

The patchpanel CLI ships `backup-pre` and `backup-post` hooks for
your backup tool — they quiesce + resume state so you can rsync /
restic / borg `/var/lib/patchpanel` while patchpanel is running:

```bash
# Example pre-snapshot hook
sudo -u patchpanel patchpanel backup-pre

rsync -a /var/lib/patchpanel/ /backup/patchpanel/

sudo -u patchpanel patchpanel backup-post
```

For the audit DB specifically, prefer the SQLite `.backup` or
`VACUUM INTO` flow over raw `cp` to avoid WAL-mode hot-page races.

## Disaster recovery

### Locked out (no admin password)

```bash
sudo patchpanel user-reset --username admin
```

Or add a second admin:

```bash
sudo patchpanel user-add --username admin2
```

Both prompt for a password on stderr; pipe with `--stdin-password` for
automation.

### Corrupted `state.json`

The daemon detects this at boot — boots into safe-mode with a minimal
`haproxy.cfg` that returns 503 on `:80`. HAProxy stays up; patchpanel
stays up; you fix via the **Raw State** UI tab.

Or replace the bad file with a known-good snapshot:

```bash
ls -lt /var/lib/patchpanel/snapshots/
sudo -u patchpanel cp /var/lib/patchpanel/snapshots/<id>.json \
    /var/lib/patchpanel/state.json
sudo systemctl restart patchpanel
```

### Bad config save

Backups live at `/etc/patchpanel/config.yaml.backup.<ISO-timestamp>`
(migrator) or `/etc/patchpanel/config.yaml.preserved-<iso>` (first
UI save against a hand-written config):

```bash
sudo cp /etc/patchpanel/config.yaml.backup.2026-05-17T12-34-56Z \
    /etc/patchpanel/config.yaml
sudo systemctl restart patchpanel
```

## Health checks + monitoring

`/health` is unauthenticated and always 200 when the daemon is
serving HTTP. Use it as a liveness probe for Kubernetes, the HA addon
watchdog, or any external uptime monitor.

```bash
curl -k https://your-host:8099/health
# {"status":"ok","service":"patchpanel","frontendLogging":{...}}
```

For deeper monitoring:

- `journalctl -u patchpanel` — runtime logs.
- `GET /api/stats` — HAProxy stats snapshot (`show info` + `show stat`).
- `GET /api/audit` — recent state mutations.
- `GET /api/peers/drift` (cluster mode) — checksum diff vs each peer.

## Troubleshooting

```bash
# Logs
sudo journalctl -fu patchpanel

# Service state
sudo systemctl status patchpanel

# Effective config (as the patchpanel user)
sudo -u patchpanel cat /etc/patchpanel/config.yaml

# Permission spot-check — patchpanel must rw /etc/haproxy/
sudo -u patchpanel ls -la /etc/haproxy/
sudo -u patchpanel test -w /etc/haproxy/haproxy.cfg && echo OK

# Validate the rendered cfg manually
sudo -u patchpanel haproxy -c -f /etc/haproxy/haproxy.cfg

# Restart cleanly
sudo systemctl restart patchpanel

# Force-render the cfg from state without applying
sudo -u patchpanel patchpanel render

# Pre-flight check without applying
sudo -u patchpanel patchpanel validate
```

Common failure modes:

- **`Cannot read config`** — none of the candidate paths exist. Reinstall:
  `sudo apt install --reinstall patchpanel`.
- **`haproxy -c failed`** — see the error in the journal. Most often
  a missing referenced file (cert, map, lua plugin).
- **`Permission denied writing /etc/haproxy/haproxy.cfg`** — the
  `patchpanel` user wasn't added to the `haproxy` group. The postinst
  does this, but if HAProxy was installed AFTER patchpanel, rerun:
  `sudo usermod -aG haproxy patchpanel && sudo systemctl restart patchpanel`.
- **Setup token consumed but no admin** — see [§ Disaster recovery](#disaster-recovery).

## Manual `.deb` build

If you fork patchpanel or build from source. Full build instructions
live at [`packaging/DEBIAN/README.md`](https://github.com/STARTcloud/patchpanel/blob/main/packaging/DEBIAN/README.md);
the short version:

```bash
# Prereqs
sudo apt install nodejs npm dpkg-dev rsync gnupg
node --version    # >= 22

# Build workspace
git clone https://github.com/STARTcloud/patchpanel
cd patchpanel
npm ci
npm run build                 # Vite -> web/dist/
npm run sync-versions         # Propagate root version everywhere
rm -rf node_modules server/node_modules web/node_modules
npm ci --omit=dev --workspaces --include-workspace-root

# Compose the package tree, copy app + systemd unit + maintainer scripts
# + man pages, generate DEBIAN/control, set perms, then:
dpkg-deb --build patchpanel_${VERSION}_amd64 patchpanel_${VERSION}_amd64.deb

# Install
sudo apt install ./patchpanel_${VERSION}_amd64.deb
```

The full step-by-step (with the DEBIAN/control heredoc and permission
fix-ups) is in the `packaging/DEBIAN/README.md` linked above. The CI
pipeline at `.github/workflows/prod-build.yml` is the authoritative
recipe.

## Home Assistant add-on

The HA add-on lives in a separate repository — patchpanel is bundled
inside an addon container that handles the supervisor's ingress,
options.json, and persistent storage volume.

Quick install:

1. In Home Assistant, **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add the patchpanel addon repository URL.
3. Install **PatchPanel** from the new repository.
4. Start the addon. The supervisor mounts the addon's config at
   `/config/config.yaml` and patchpanel boots in `homeassistant` mode
   (auth strategy `ha-ingress` — users authenticate to HA upstream,
   patchpanel trusts the supervisor proxy IP).
5. Click **Open Web UI** in the addon panel. No setup token — HA
   authenticates you directly.

HA-specific knobs (debug bundle toggle, `paths.options` integration,
supervisor token environment) live in the addon repo's `DOCS.md`.

## See also

- [Getting Started](getting-started/) — first-login walkthrough
- [Authentication](authentication/) — `auth.strategy` deep-dive
- [Configuration](../configuration/) — every YAML key
- [API examples](api-examples/) — automating patchpanel via curl
