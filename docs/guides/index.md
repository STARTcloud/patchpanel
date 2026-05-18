---
title: Guides
layout: default
nav_order: 3
has_children: true
permalink: /docs/guides/
---

# Guides

{: .no_toc }

Task-oriented walkthroughs of patchpanel. These complement the
[Configuration reference](../configuration/) (every YAML key) and the
[API reference](../api/) (every endpoint).

---

## Available guides

### [Getting Started](getting-started/)

Day-zero walkthrough: install patchpanel, claim the admin account from
the postinst banner, run the onboarding wizard to land at a working
HAProxy with a covering Let's Encrypt cert. Plus CLI cheatsheet and the
common first-week gotchas.

### [Installation](installation/)

Sysadmin-grade reference for production installs. Adds the STARTcloud
apt repository, walks through every systemd hardening flag and on-disk
artifact, and covers upgrades, uninstalls, and disaster recovery
(snapshots, audit-DB backups, locked-admin recovery via the CLI).

### [Authentication](authentication/)

The three auth strategies (`local`, `ha-ingress`, `none`), the API
token wire format, the setup-token handshake, JWT lifecycle and
password-change invalidation, and how to recover from a lost admin via
shell access.

### [Backend Integration](backend-integration/)

Programmatic patchpanel — mint a Bearer token, work with the state
document via read-modify-write, automate cert renewals, drain backend
servers via runtime ops without a reload, scrape stats for Prometheus,
and ship audit events to your SIEM. Plus CI/CD recipes for GitHub
Actions, Ansible, and Terraform-style flows.

### [API Examples](api-examples/)

A curl-by-example walkthrough of every public endpoint, organised by
domain (auth, state, certificates, runtime, observability, cluster,
misc). Companion to the interactive Swagger UI at [/api/](../api/).

---

## Where else to look

- **[Architecture](../architecture/)** — components, data flow, the
  render pipeline, the state machine, the audit log.
- **[Configuration](../configuration/)** — every key in
  `config.yaml`, what reads it, and the migrator / watermark
  lifecycle.
- **[Releases](../releases/)** — downloads + changelog.
- **[Support](../support/)** — issue tracker, security policy, code of
  conduct.

Need something the docs don't cover yet?
[Open an issue](https://github.com/STARTcloud/patchpanel/issues).
