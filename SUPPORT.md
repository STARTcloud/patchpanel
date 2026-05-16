# Support

PatchPanel is maintained by a single person with limited time. Most help
flows through GitHub. This document outlines what to use, what to expect,
and what's out of scope.

## Where to ask

### Bugs and feature requests

[GitHub Issues](https://github.com/STARTcloud/patchpanel/issues) — use the
appropriate template (bug report, feature request, question). Search first.

For a bug report, include:

- Deployment surface (Home Assistant add-on or standalone Debian package)
- PatchPanel version, HAProxy version, Node.js version, Debian/Ubuntu/HAOS version
- Reproduction steps with expected vs. actual behaviour
- The relevant chunk of audit log + `journalctl -u patchpanel` (or HA add-on log)
- A sanitized copy of your `state.json` (or `haproxy.cfg`) when the bug is config-shaped

### Questions and discussion

[GitHub Discussions](https://github.com/STARTcloud/patchpanel/discussions) —
ask before opening an issue if you're not sure something is a bug.

### Security vulnerabilities

Do **not** open a public issue. See [SECURITY.md](SECURITY.md) for the
private reporting flow.

## Documentation

- [Architecture](https://patchpanel.startcloud.com/docs/architecture/) —
  components, data flow, the render-validate-swap loop
- [API reference](https://patchpanel.startcloud.com/docs/api/) — OpenAPI
  spec, interactive Swagger UI
- [Releases](https://patchpanel.startcloud.com/docs/releases/) — download
  the latest `.deb`, view the changelog
- [README](https://github.com/STARTcloud/patchpanel/blob/main/README.md) —
  install steps for both deployment surfaces

## Response expectations

This is a side-project. Realistic timelines:

- Bug acknowledgement: a few days
- Critical security issue: highest priority, days
- Stability bug: high priority, 1–2 weeks
- Feature request: evaluated against current scope; may not land
- Documentation fix: usually merged quickly

PRs move faster than issues. If you can fix it, please do — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Out of scope

- Bespoke development or one-on-one consulting
- Forks and modified builds — please reproduce the bug on a clean install
  of the published `.deb` or add-on before reporting
- Integration work for third-party billing/monitoring/orchestration
  systems beyond what the documented API already supports
- 24/7 emergency response

## Upstream resources

PatchPanel renders config for, but does not replace, HAProxy. For questions
about HAProxy's directive semantics, runtime API, or expected behaviour,
go to the source:

- [HAProxy Configuration Manual](https://docs.haproxy.org/) — definitive reference
- [HAProxy Community Forum](https://discourse.haproxy.org/)
- [HAProxy mailing list archive](https://www.mail-archive.com/haproxy@formilux.org/)

For ACME / Let's Encrypt issues (rate limits, DNS-01 plugin specifics,
EAB credentials):

- [Let's Encrypt Community](https://community.letsencrypt.org/)
- [certbot documentation](https://eff-certbot.readthedocs.io/)

For the add-on surface specifically:

- [Home Assistant Community](https://community.home-assistant.io/)
- [Home Assistant Add-on docs](https://developers.home-assistant.io/docs/add-ons/)
