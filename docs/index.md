---
title: Home
layout: home
nav_order: 1
description: 'PatchPanel — state-driven web UI for HAProxy'
permalink: /
---

<!-- markdownlint-disable MD013 MD033 MD060 -->

# PatchPanel

{: .fs-9 }

A state-driven web UI for HAProxy. Render `haproxy.cfg` from a validated
JSON document, validate it with `haproxy -c`, reload via the master CLI
socket, and manage TLS certificates (Let's Encrypt + BYO) — all from a
browser.
{: .fs-6 .fw-300 }

[Get started](docs/guides/getting-started/){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
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
- **Authentication** — Local admin login (JWT in httpOnly cookie) + bcrypt-hashed
  API keys (Bearer tokens) for programmatic / remote control.
- **Two deployment surfaces** — Home Assistant add-on, standalone Debian
  package (`.deb` from the STARTcloud apt repository).

## Getting started

PatchPanel can be installed two ways:

- **[Home Assistant add-on](docs/guides/installation/#home-assistant-add-on)** — install from the `STARTcloud/homeassistant-addons` repository for HAOS / Supervised hosts.
- **[Standalone Debian](docs/guides/installation/)** — apt install on Bookworm/Trixie. See the [15-minute walkthrough](docs/guides/getting-started/) for first-run setup.

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

- **[Guides](docs/guides/)** — Task-oriented walkthroughs
  - [Getting Started](docs/guides/getting-started/) — apt install -> running HAProxy in 15 min
  - [Installation](docs/guides/installation/) — production install, systemd hardening, backups
  - [Authentication](docs/guides/authentication/) — strategies, API tokens, lost-admin recovery
  - [Backend Integration](docs/guides/backend-integration/) — automate via the REST API
  - [API Examples](docs/guides/api-examples/) — every endpoint with curl examples
- **[Configuration](docs/configuration/)** — Every key in `config.yaml`
- **[Architecture](docs/architecture/)** — Components, data flow, render pipeline
- **[API reference](docs/api/)** — OpenAPI spec + Swagger UI
- **[Releases](docs/releases/)** — Download .deb / view release notes
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
