---
title: Home
layout: home
nav_order: 1
description: 'PatchPanel — state-driven web UI for HAProxy'
permalink: /
---

# PatchPanel

{: .fs-9 }

A state-driven web UI for HAProxy. Render `haproxy.cfg` from a validated
JSON document, validate it with `haproxy -c`, reload via the master CLI
socket, and manage TLS certificates (Let's Encrypt + BYO) — all from a
browser.
{: .fs-6 .fw-300 }

[Get started](#getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[API reference](docs/api/swagger-ui.html){: .btn .fs-5 .mb-4 .mb-md-0 .mr-2 }
[GitHub](https://github.com/STARTcloud/patchpanel){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What it does

PatchPanel turns HAProxy from a hand-edited `haproxy.cfg` into a
state-driven, declarative system:

- **State-driven rendering** — A single `state.json` is the source of
  truth. Every save re-renders `haproxy.cfg`, runs `haproxy -c` against
  it, and atomically swaps the file. Bad config never reaches a running
  worker.
- **Zero-downtime reloads** — Master CLI socket reloads (`-W -S`). Old
  workers drain gracefully.
- **Let's Encrypt baked in** — DNS-01 (Cloudflare, Route 53, Google,
  DigitalOcean, OVH, RFC 2136, dns-multi) and HTTP-01. Multiple ACME
  accounts. Bring-your-own PEM uploads for hosts you renew elsewhere.
- **Trusted CAs and CRLs** — Upload root + intermediate bundles and
  revocation lists; reference them on bind lines for mTLS and on server
  lines for upstream verification.
- **Live observability** — Per-frontend/backend traffic, stats socket
  runtime API, audit log, snapshot timeline, GeoIP origin map.
- **Authentication** — Local admin login (session cookies) + bcrypt-hashed
  API keys (Bearer tokens) for programmatic / remote control.
- **Two deployment surfaces** — Home Assistant add-on, standalone Debian
  package (`.deb` from the STARTcloud apt repository).

## Getting started

### Home Assistant add-on

1. Add `https://github.com/STARTcloud/homeassistant-addons` to your HA
   add-on repositories.
2. Install the HAProxy add-on.
3. Start it. The first run seeds an empty state document at
   `/data/state.json`.
4. Open the **HAProxy** sidebar item in Home Assistant.
5. Run through the setup wizard to add your first ACME account, route,
   and backend.

### Standalone Debian

```bash
# Add the STARTcloud apt repository (one-time)
curl -fsSL https://packages.debian.startcloud.com/startcloud.gpg \
  | sudo tee /etc/apt/keyrings/startcloud.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/startcloud.gpg] https://packages.debian.startcloud.com bookworm main" \
  | sudo tee /etc/apt/sources.list.d/startcloud.list

sudo apt update
sudo apt install patchpanel haproxy

# First run prints a setup token to the terminal
sudo journalctl -fu patchpanel
```

Open `https://your-host:8099/`, paste the setup token, create the first
admin account, and finish the configuration wizard.

## Concepts

- **State document** — Zod-validated JSON. Frontends, backends, ACLs,
  rules, certs, providers, trusted CAs / CRLs, ACME accounts. Every
  change is a write to `/data/state.json` (HA addon) or
  `/var/lib/patchpanel/state.json` (standalone), which triggers a
  render + validate + atomic-swap + reload.
- **Renderer** — Deterministically renders `haproxy.cfg` from the state
  document plus a small bootstrap config (paths, ports, SSL).
- **Audit log** — SQLite-backed log of every state change, attributed to
  the editor (local user, API key, or HA user when running as add-on).

## Documentation

- **[Architecture](docs/architecture/)** — Components, data flow,
  process model
- **[API reference](docs/api/)** — OpenAPI spec + interactive Swagger UI
- **[Releases](docs/releases/)** — Download `.deb` / view release notes
- **[Changelog](docs/changelog/)** — Per-version change log

## About

PatchPanel is &copy; 2026 STARTcloud.

### License

GPL-3.0. See [LICENSE](https://github.com/STARTcloud/patchpanel/blob/main/LICENSE.md).

### Contributing

Discuss the change you want to make via issue first.
[CONTRIBUTING](https://github.com/STARTcloud/patchpanel/blob/main/CONTRIBUTING.md).

#### Thank you to the contributors

<ul class="list-style-none">
{% for contributor in site.github.contributors %}
  <li class="d-inline-block mr-1">
     <a href="{{ contributor.html_url }}"><img src="{{ contributor.avatar_url }}" width="32" height="32" alt="{{ contributor.login }}"></a>
  </li>
{% endfor %}
</ul>

### Code of Conduct

[Contributor Covenant 2.1](https://github.com/STARTcloud/patchpanel/blob/main/CODE_OF_CONDUCT.md).
