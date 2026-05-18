---
title: Releases
layout: default
nav_order: 5
permalink: /docs/releases/
---

<!-- markdownlint-disable MD013 MD033 MD060 -->

# Releases

{: .no_toc }

Download the latest version of PatchPanel.

---

## Latest Release

<div id="latest-release-content">
<p>Loading latest release information...</p>
</div>

### Download Options

| Package Type              | Platform          | Download                                                                              |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| **Debian Package**        | x86_64            | [Download .deb][deb]{: .btn .btn-primary }                                            |
| **Source Code**           | All               | [Download Source][src]{: .btn .btn-outline }                                          |
| **Home Assistant Add-on** | HAOS / Supervised | [STARTcloud/homeassistant-addons](https://github.com/STARTcloud/homeassistant-addons) |

[deb]: https://github.com/STARTcloud/patchpanel/releases/latest/download/patchpanel.deb
[src]: https://github.com/STARTcloud/patchpanel/archive/refs/heads/main.tar.gz

---

## Installation

Three supported install paths:

- **Apt repository (recommended)** — `apt install patchpanel` from
  `packages.debian.startcloud.com`. Auto-installs HAProxy as a dependency and registers a systemd unit.
- **Direct `.deb` download** — grab the asset from the Latest Release table above and run
  `dpkg -i ./patchpanel_*.deb`; resolve deps with `apt -f install`.
- **Home Assistant add-on** — add the `STARTcloud/homeassistant-addons` repository to your HA instance
  and install PatchPanel. See the installation guide for the full procedure.

Quick install on Bookworm or Trixie:

```bash
curl -fsSL https://packages.debian.startcloud.com/debian/startcloud.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/startcloud-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/startcloud-archive-keyring.gpg] \
  https://packages.debian.startcloud.com/debian stable main" \
  | sudo tee /etc/apt/sources.list.d/startcloud.list
sudo apt update && sudo apt install patchpanel
```

See the getting started guide for the 15-minute walkthrough, or the
installation reference for the production-grade procedure (systemd
hardening, backup recipes, reverse-proxy posture, upgrades, uninstall).

---

## Release History

[View Changelog](/docs/changelog/){: .btn .btn-outline }
[All Releases](https://github.com/STARTcloud/patchpanel/releases){: .btn .btn-outline }
