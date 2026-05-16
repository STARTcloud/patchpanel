# PatchPanel

State-driven web UI and config manager for HAProxy. Renders `haproxy.cfg` from
a validated JSON state document, validates with `haproxy -c`, atomically swaps
the file, and reloads via the master CLI socket. Bundles Let's Encrypt
(certbot, eight DNS plugins), trusted CA / CRL upload, and an HTTP API for
remote control.

Ships in two incarnations:

- **Home Assistant add-on** — Drop-in for `home-assistant.io` hosts; UI served
  through HA's ingress proxy.
- **Standalone Debian package** — `.deb` published to
  `packages.debian.startcloud.com`. Runs as a system service on bare Debian or
  Ubuntu.

## Repository layout

- **`server/`** — Express 5 backend. Renders `haproxy.cfg` from state,
  validates it, reloads HAProxy via the master socket, manages
  certificate lineage, logs to Winston, mounts the management API.
- **`web/`** — React 19 + Vite frontend. Single-page app served by the
  backend. Uses relative asset paths so it works behind any URL prefix
  (Home Assistant ingress proxy, nginx subpath, bare-metal root).
- **`packaging/`** — Debian
  - `packaging/DEBIAN/` — `postinst`, `prerm`, `postrm`, systemd unit,
    man pages, README.
  - `packaging/config/` — `production-config.yaml` template merged into
    `/etc/patchpanel/config.yaml` on install.
  - `packaging/scripts/` — version sync + doc generation.
- **`docs/`** — Just-The-Docs source for [patchpanel.startcloud.com](https://patchpanel.startcloud.com/).
- **`.github/workflows/`** — CI, CodeQL, release-please, dev/prod build,
  docs publish.

## Modes

The daemon mode lives in `config.mode`:

- **`homeassistant`** — Inside the HAProxy HA add-on. Trusts the
  supervisor proxy IP, parses `X-Ingress-Path` for asset URLs, reads
  `X-Remote-User-*` headers from HA for audit attribution. No first-run
  wizard required — HA's ingress gates access.
- **`standalone`** — Bare-metal / VM / Docker-non-HA install. First boot
  generates a setup token written to `/etc/patchpanel/setup.token`;
  visit the UI, paste the token, create the first admin user, configure
  TLS, and PatchPanel deletes the token. After setup, the daemon
  authenticates via session cookies (browser) or API keys (programmatic).

## Build

```bash
npm install
npm run build       # Vite builds web/, outputs to web/dist/
```

## Run

Add-on mode (paths come from `/etc/patchpanel/config.yaml`):

```bash
node server/src/server.js
```

Standalone (debian package installs as the `patchpanel` systemd service):

```bash
systemctl enable --now patchpanel
journalctl -fu patchpanel
```

## Lint

Strict ESLint flat config in each workspace. No inline `eslint-disable`
comments. Fix the code, not the lint rule.

```bash
npm run lint
npm run lint:fix
npm run format:check
npm run format:fix
```

## Documentation

Full docs at [patchpanel.startcloud.com](https://patchpanel.startcloud.com/).
API reference is generated from JSDoc on the route handlers — see
`packaging/scripts/generate-docs.js`.

## License

GPL-3.0. See [LICENSE.md](LICENSE.md).
