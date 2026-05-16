# Acknowledgments

PatchPanel is built on top of HAProxy plus a long list of excellent open-source
projects. We are grateful to the developers and communities behind them.

## The thing PatchPanel manages

**HAProxy** - High-performance TCP/HTTP load balancer and reverse proxy

- Website: [haproxy.org](https://www.haproxy.org/)
- License: GPL-2.0
- Usage: The reverse proxy PatchPanel renders configuration for, validates,
  and reloads via the master CLI socket. PatchPanel is, fundamentally, a
  state-driven UI on top of HAProxy.

**certbot** - ACME client for Let's Encrypt and other certificate authorities

- Website: [certbot.eff.org](https://certbot.eff.org/)
- License: Apache 2.0
- Usage: Issues and renews TLS certificates via DNS-01 / HTTP-01 challenges.
  PatchPanel wraps it with a state-driven configuration and renewal scheduler.

## Backend dependencies

**Express.js** - Fast, unopinionated, minimalist web framework for Node.js

- Website: [expressjs.com](https://expressjs.com/)
- License: MIT
- Usage: Serves the management API and the SPA shell.

**zod** - TypeScript-first schema validation with static type inference

- Repository: [github.com/colinhacks/zod](https://github.com/colinhacks/zod)
- License: MIT
- Usage: Validates every state document on save and surfaces precise
  field-level errors back to the UI.

**better-sqlite3** - Fast, simple, synchronous SQLite3 bindings for Node.js

- Repository: [github.com/WiseLibs/better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- License: MIT
- Usage: Audit log storage.

**croner** - Cron job scheduler for Node.js

- Repository: [github.com/Hexagon/croner](https://github.com/Hexagon/croner)
- License: MIT
- Usage: Scheduled certificate renewal and GeoIP DB updates.

**@maxmind/geoip2-node** - MaxMind GeoIP2 database reader

- Repository: [github.com/maxmind/GeoIP2-node](https://github.com/maxmind/GeoIP2-node)
- License: Apache 2.0
- Usage: Resolves client IPs to country/city/ASN for the dashboard origin
  panels. Optional — PatchPanel runs without it.

**ws** - Simple to use WebSocket client and server library

- Repository: [github.com/websockets/ws](https://github.com/websockets/ws)
- License: MIT
- Usage: Real-time log streaming and stats push.

**multer** - Node.js middleware for handling multipart/form-data

- Repository: [github.com/expressjs/multer](https://github.com/expressjs/multer)
- License: MIT
- Usage: PEM uploads (BYO certs, trusted CAs, trusted CRLs).

## Frontend dependencies

**React** - Library for building user interfaces

- Website: [react.dev](https://react.dev/)
- License: MIT
- Usage: The entire management UI.

**Vite** - Frontend tooling

- Website: [vitejs.dev](https://vitejs.dev/)
- License: MIT
- Usage: Dev server and production bundler.

**react-bootstrap** + **Bootstrap** + **Bootstrap Icons**

- Websites: [react-bootstrap.github.io](https://react-bootstrap.github.io/),
  [getbootstrap.com](https://getbootstrap.com/),
  [icons.getbootstrap.com](https://icons.getbootstrap.com/)
- License: MIT
- Usage: Component library and iconography.

**Highcharts** (commercial license required for production / non-personal use)

- Website: [highcharts.com](https://www.highcharts.com/)
- License: Highcharts Non-Commercial / Commercial
- Usage: Stats charts and the GeoIP origin map.

**@xyflow/react** + **dagre** - Node-and-edge graph library + layout engine

- Repositories: [github.com/xyflow/xyflow](https://github.com/xyflow/xyflow),
  [github.com/dagrejs/dagre](https://github.com/dagrejs/dagre)
- License: MIT
- Usage: Frontend → ACL → backend topology visualization.

**diff** - Unified diff library for JavaScript

- Repository: [github.com/kpdecker/jsdiff](https://github.com/kpdecker/jsdiff)
- License: BSD-3-Clause
- Usage: Rendered haproxy.cfg diff view (added/removed lines).

## Platform

**Node.js** - JavaScript runtime built on V8

- Website: [nodejs.org](https://nodejs.org/)
- License: MIT-style
- Usage: Core runtime.

**Debian** - The universal operating system

- Website: [debian.org](https://www.debian.org/)
- License: DFSG-compatible
- Usage: Target platform for the standalone `.deb` distribution.

**Home Assistant** - Open-source home automation platform

- Website: [home-assistant.io](https://www.home-assistant.io/)
- License: Apache 2.0
- Usage: Host platform for the HAProxy add-on incarnation of PatchPanel.

## Tools and ecosystem

**GitHub** - Code hosting, issue tracking, CI/CD

- Website: [github.com](https://github.com/)

**npm** - Package manager for Node.js

- Website: [npmjs.com](https://www.npmjs.com/)

**Jekyll** + **Just the Docs**

- Websites: [jekyllrb.com](https://jekyllrb.com/),
  [github.com/just-the-docs/just-the-docs](https://github.com/just-the-docs/just-the-docs)
- License: MIT
- Usage: Documentation site at [patchpanel.startcloud.com](https://patchpanel.startcloud.com/).

**release-please** - Conventional-commit-driven release automation

- Repository: [github.com/googleapis/release-please](https://github.com/googleapis/release-please)
- License: Apache 2.0
- Usage: Auto version bumps + changelog + release PRs on every merge to main.

**CodeQL** - Semantic code analysis engine

- Repository: [github.com/github/codeql](https://github.com/github/codeql)
- License: MIT
- Usage: Continuous security scanning.

## Standards

**OpenAPI Specification** - API description format

- Website: [openapis.org](https://www.openapis.org/)
- Usage: Public API contract.

**Semantic Versioning** - Versioning scheme for software

- Website: [semver.org](https://semver.org/)
- Usage: Project versioning strategy.

**Conventional Commits** - Commit message convention

- Website: [conventionalcommits.org](https://www.conventionalcommits.org/)
- Usage: Drives release-please version inference.

**ACME (RFC 8555)** - Automatic Certificate Management Environment

- Specification: [RFC 8555](https://datatracker.ietf.org/doc/html/rfc8555)
- Usage: Protocol PatchPanel uses (via certbot) for cert issuance/renewal.

## Documentation and learning resources

**MDN Web Docs** - Web development documentation

- Website: [developer.mozilla.org](https://developer.mozilla.org/)

**HAProxy Configuration Manual** - Definitive HAProxy reference

- Website: [docs.haproxy.org](https://docs.haproxy.org/)

**Node.js Documentation** - Official Node.js documentation

- Website: [nodejs.org/docs](https://nodejs.org/docs/)

## Special recognition

**Open Source Community** - The broader open-source software community whose
collaborative spirit makes projects like PatchPanel possible.

**STARTcloud** - For sponsoring and hosting the PatchPanel apt repository,
the documentation site, and the CI infrastructure.

**Home Assistant Community** - For the add-on platform that gave PatchPanel
its first home.

**Early Users and Testers** - Community members who provided feedback during
development and testing phases.

---

## Disclaimer

This acknowledgment file may not be exhaustive. If you believe a project or
individual should be acknowledged here, please open an issue or contribute to
this file.

All trademarks and registered trademarks mentioned herein are the property of
their respective owners.

## Contributing to acknowledgments

If you notice missing acknowledgments or have suggestions:

1. Open an issue with the `documentation` label
2. Submit a pull request with your proposed changes
3. Ensure you have permission to acknowledge any individuals mentioned
