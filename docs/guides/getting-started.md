---
title: Getting Started
layout: default
parent: Guides
nav_order: 1
permalink: /docs/guides/getting-started/
---

# Getting Started

{: .no_toc }

From `apt install` to a running HAProxy with a covering Let's Encrypt
certificate, in under fifteen minutes.

## Table of contents

{: .no_toc .text-delta }

1. TOC
   {:toc}

---

## Prerequisites

A Debian or Ubuntu host (amd64) you have `sudo` on, with HAProxy ≥ 2.6
and Node.js ≥ 22 available. The standard apt install pulls both
automatically. The host needs a DNS record pointing at it if you want
Let's Encrypt to issue real certs.

If you're running Home Assistant, install patchpanel via the addon
repo instead — see [Installation → Home Assistant](installation/#home-assistant-add-on).

## Install

```bash
# 1. Trust the STARTcloud apt repo key
curl -fsSL https://packages.debian.startcloud.com/debian/startcloud.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/startcloud-archive-keyring.gpg

# 2. Add the repo
echo "deb [signed-by=/usr/share/keyrings/startcloud-archive-keyring.gpg] \
  https://packages.debian.startcloud.com/debian stable main" \
  | sudo tee /etc/apt/sources.list.d/startcloud.list

# 3. Install + enable
sudo apt update
sudo apt install patchpanel
sudo systemctl enable --now patchpanel
```

The postinst prints a banner with a one-time setup URL:

```text
=================================================================
  PatchPanel installed.

  Config:    /etc/patchpanel/config.yaml
  Data:      /var/lib/patchpanel/
  Logs:      journalctl -fu patchpanel

  Start:     systemctl enable --now patchpanel

  First-run setup URL (one-time, consumed by the wizard):
    https://your-host.example.com:8099/setup-admin?token=abc123...

  Or if you forget the URL, the token alone is in:
    /etc/patchpanel/setup.token

  Recovery (if locked out later):
    patchpanel user-add --username admin
    patchpanel user-reset --username admin
=================================================================
```

Capture that URL — it's how you claim the admin account.

If you missed the banner, the token is still on disk:

```bash
sudo cat /etc/patchpanel/setup.token
```

## Claim the admin account

Open the setup URL in a browser. patchpanel's self-signed cert will
trigger a TLS warning the first time — accept it for now (you'll
replace the cert later if you want).

The setup-admin page shows three fields:

- **Setup token** — prefilled from the URL.
- **Username** — defaults to `admin`. Lowercase letters/digits/`._-`, must start with a letter, 2–32 chars.
- **Password** — minimum 8 characters.

Submit. The server verifies the token (timing-safe), creates the
admin user, deletes the token file, and signs you in via a session
cookie. You land on the dashboard.

> **Note:** The setup wizard is single-shot. Once it consumes the
> token, that route returns 401 forever. Lost-admin recovery goes
> through the [CLI](#cli-cheatsheet) instead — `patchpanel user-add`
> or `patchpanel user-reset`.

## Run the onboarding wizard

On fresh installs the dashboard shows a primary-bordered card:

> **Fresh install — no defaults, frontends, ACLs, backends, or certs yet.**
> patchpanel is still empty. The wizard collects a Let's Encrypt
> account, the first defaults block, frontend, ACL + use-backend rule,
> backend, and covering certificate — enough to render a valid
> haproxy.cfg.

Click **Run setup wizard**. The wizard walks you through:

1. **ACME account** — your Let's Encrypt email. patchpanel calls
   certbot under the hood. Pick `staging` for first test runs to
   avoid the production rate limit.
2. **Defaults block** — HAProxy `defaults` section. The wizard's
   defaults are sensible (mode http, timeouts, error-files); accept
   them.
3. **Frontend** — bind address + port + TLS settings. `0.0.0.0:443`
   for HTTPS termination on every interface.
4. **ACL + use-backend rule** — example: route hostname `app.example.com`
   to backend `app`.
5. **Backend** — server entries (`server srv1 10.0.0.10:8080`).
6. **Covering cert** — the certificate that secures the frontend.
   Pick the ACME account from step 1.

Submit. patchpanel renders `haproxy.cfg`, runs `haproxy -c` against
it, atomically swaps it into place, and tells HAProxy to reload via
its master CLI socket. If `haproxy -c` rejects, the apply rolls back
and surfaces parsed error hints in the UI.

After the wizard, the dashboard card flips to "Setup complete" with a
muted check.

## Verify

```bash
# patchpanel itself
sudo systemctl status patchpanel
sudo journalctl -fu patchpanel

# the HAProxy config patchpanel wrote
sudo head -20 /etc/haproxy/haproxy.cfg

# HAProxy is running with the new cfg
sudo systemctl status haproxy
```

The first line of `haproxy.cfg` should start with:

```text
# patchpanel-managed - do not edit by hand
```

That watermark tells patchpanel "I wrote this; safe to overwrite on
next reload." A foreign config (no watermark) gets preserved at
`haproxy.cfg.preserved-<iso>` before the first patchpanel write,
in case you had hand-tuned directives to salvage.

## Next steps

1. **Mint an API token.** Open **Profile → API tokens** (top right),
   click **Mint token**, name it something descriptive (e.g. `ci-pipeline`).
   The wire format `pp_<keyId>.<secret>` is shown **once** — copy it
   into your secrets manager immediately. Use it for scripts and CI.
2. **Take a snapshot.** patchpanel auto-snapshots on every apply, but
   you can also restore from any snapshot via **Snapshots → Restore**.
3. **Verify backups.** What to back up: `/var/lib/patchpanel/state.json`,
   `audit.sqlite`, `snapshots/`, `users.json`, `api-tokens.json`, plus
   `/etc/patchpanel/config.yaml`, `.jwt-secret`, and the certbot store
   at `/etc/letsencrypt/`.
4. **Replace the self-signed management cert.** Either set
   `ssl.certPath` to `/etc/letsencrypt/live/<your-host>/fullchain.pem`
   (and `keyPath` to `privkey.pem`) with `ssl.generate: false`, OR
   upload your own PEMs to `/etc/patchpanel/ssl/`.

## CLI cheatsheet

The `patchpanel` CLI dispatcher (installed at `/usr/bin/patchpanel`)
exposes everything that's useful out-of-band. Run as root or as the
`patchpanel` system user.

| Command                                 | Purpose                                                                                        | When to run                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `patchpanel server`                     | Start the Express HTTP server.                                                                 | systemd runs this — manual use only for debugging.                                             |
| `patchpanel bootstrap`                  | Seed `state.json`, render initial `haproxy.cfg`, write safe-mode fallback if state is invalid. | First boot after install; recovery from a corrupted state.json.                                |
| `patchpanel render [--out <path>]`      | Render `haproxy.cfg` from state to stdout.                                                     | Inspect what the daemon would write before applying.                                           |
| `patchpanel validate`                   | Run `haproxy -c` against the rendered cfg without applying.                                    | Pre-flight check on a state change.                                                            |
| `patchpanel reload`                     | Validate + reload via the master CLI socket.                                                   | Force-reload after a hand edit.                                                                |
| `patchpanel certs-renew`                | Run certbot renewal; rebuild crt-list + reload HAProxy on success.                             | Manual cert refresh; scheduled via cron / timer.                                               |
| `patchpanel next-renewal-slot`          | Print the epoch seconds of the next scheduled renewal.                                         | Timer / scheduler scripting.                                                                   |
| `patchpanel user-add --username NAME`   | Create a new admin user. Reads password from stdin (`--stdin-password` for pipe-friendly).     | Headless installs without a browser. Add a second admin for redundancy.                        |
| `patchpanel user-reset --username NAME` | Reset a user's password (skips the current-password check).                                    | Locked-out admin recovery. Bumps `passwordChangedAt`, invalidating that user's other sessions. |
| `patchpanel backup-pre` / `backup-post` | Quiesce / resume state for host-level backup tools.                                            | From your backup tool's pre/post hooks.                                                        |
| `patchpanel version`                    | Print the package version.                                                                     | Diagnostics.                                                                                   |
| `patchpanel help`                       | Show usage.                                                                                    | First time.                                                                                    |

Every command respects `CONFIG_PATH` (or `--config <path>`) for the
config file, and `PATCHPANEL_HOME` (default `/opt/patchpanel`) for the
install root.

## Recovery flows

### Lost admin password

You have shell access on the host — that's already proof of authority.
The `user-reset` CLI skips the current-password check on purpose:

```bash
sudo patchpanel user-reset --username admin
# prompts on stderr: "New password: "
```

Bumps `passwordChangedAt`. Every existing JWT for that user becomes
invalid on next request. The next browser login uses the new password.

For pipe-friendly automation:

```bash
echo -n 'NewPass!23' | sudo patchpanel user-reset --username admin --stdin-password
```

### Need a second admin

```bash
sudo patchpanel user-add --username admin2
```

Same flow — prompts for password on stderr (or pipe with
`--stdin-password`). Creates a user with `role: admin`. Bypasses the
setup-token gate entirely (CLI ↔ filesystem trust).

### Stale or corrupted `state.json`

If `state.json` fails Zod schema validation at boot, the daemon
doesn't crash:

1. It logs the error.
2. It uses an empty state document **in memory only** — your bad
   file is preserved on disk for forensic review.
3. It tries to render `haproxy.cfg` from the empty state.
4. If even that fails, it writes a `SAFE_MINIMAL_CFG` that binds
   `:80` and returns:

```text
   patchpanel: safe-mode (state.json renders invalid cfg; fix via Raw State tab)
```

HAProxy stays up but serves only this 503. Fix the state via the
**Raw State** tab in the UI (or paste a known-good state from a
`.preserved-*` backup) and save — apply pipeline runs normally.

### Setup token already consumed but no admin

The setup wizard deletes `setup.token` only **after** the `createUser`
call succeeds. If creation failed before deletion, the token is still
on disk and you can retry the wizard.

If you somehow lost the token but `users.json` is empty:

```bash
openssl rand -hex 32 | sudo tee /etc/patchpanel/setup.token
sudo chown patchpanel:patchpanel /etc/patchpanel/setup.token
sudo chmod 600 /etc/patchpanel/setup.token
```

Then open `https://<host>:8099/setup-admin?token=$(sudo cat /etc/patchpanel/setup.token)`.

Or skip the wizard and use `patchpanel user-add` directly.

## Common first-week questions

### Why isn't HAProxy reloading after I save?

It is — but via the **master CLI socket**, not `systemctl reload`.
patchpanel speaks to `/run/haproxy/master.sock` directly. The reload
is zero-downtime: old workers drain in-flight requests while new ones
take over.

If `haproxy -c` rejected the rendered cfg, the apply rolled back. The
UI surfaces the parsed error hints — look for the red banner on the
page where you made the change, or check the audit log (`Audit` tab).

### Why can't I edit `/etc/haproxy/haproxy.cfg` directly?

patchpanel is the canonical writer of that file. Every save to
`state.json` regenerates it. Manual edits get overwritten on the
next reload.

If you have hand-tuned directives that don't have a UI equivalent
yet, look at the per-frontend / per-backend / per-default-block
**Advanced directives** field — those are passed through verbatim.
Or use the **Raw State** tab and edit the underlying JSON.

### Where do snapshots and the audit log live?

- **Snapshots:** `/var/lib/patchpanel/snapshots/` — one file per
  apply, JSON, named with ISO timestamp + 7-char hash.
- **Audit:** `/var/lib/patchpanel/audit.sqlite` — every state mutation,
  auth event, runtime op. Query via the **Audit** tab in the UI or
  `GET /api/audit`.

### My HTTPS browser shows the patchpanel cert warning, not my real cert

patchpanel uses its OWN cert for the management UI (`:8099`), not the
LE certs you set up for HAProxy. Two options:

1. **Self-signed (default):** accept the browser warning. Acceptable
   on a private network.
2. **Use one of your Let's Encrypt certs:** set in `config.yaml`:

   ```yaml
   ssl:
     enabled:
       value: true
     generate:
       value: false # don't overwrite our chosen cert
     certPath:
       value: /etc/letsencrypt/live/your-host/fullchain.pem
     keyPath:
       value: /etc/letsencrypt/live/your-host/privkey.pem
   ```

   Restart patchpanel. Make sure the `patchpanel` system user can read
   the cert files (they're owned by root in certbot's standard layout
   — `setfacl -m u:patchpanel:r ...` or symlink them somewhere readable).

## See also

- [Installation](installation/) — production-grade install + uninstall + recovery
- [Authentication](authentication/) — local vs API token vs HA ingress
- [Configuration](../configuration/) — every YAML key
- [API examples](api-examples/) — curl recipes for every endpoint
