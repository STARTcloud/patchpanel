# Building the PatchPanel Debian package

The release pipeline lives in `.github/workflows/{release-please,prod-build,dev-build}.yml`.
This document mirrors the workflow for manual local builds.

## Prerequisites

```bash
sudo apt update
sudo apt install nodejs npm dpkg-dev rsync gnupg
node --version   # >= 22.0.0
```

## Build steps

```bash
# 1. Install workspace dependencies
npm ci

# 2. Build the frontend (Vite → web/dist/)
npm run build

# 3. Sync versions from root package.json into all version-bearing files
npm run sync-versions

# 4. Strip dev dependencies
rm -rf node_modules server/node_modules web/node_modules
npm ci --omit=dev --workspaces --include-workspace-root

# 5. Package variables
export VERSION=$(node -p "require('./package.json').version")
export PACKAGE_NAME=patchpanel
export ARCH=amd64

# 6. Build tree
mkdir -p "${PACKAGE_NAME}_${VERSION}_${ARCH}"/{opt/patchpanel/web,opt/patchpanel/config-templates,etc/systemd/system,var/lib/patchpanel,var/log/patchpanel,usr/share/man/man8,usr/share/man/man5,DEBIAN}

# 7. Application files
cp -r package.json package-lock.json node_modules "${PACKAGE_NAME}_${VERSION}_${ARCH}/opt/patchpanel/"
cp -r server "${PACKAGE_NAME}_${VERSION}_${ARCH}/opt/patchpanel/"
cp -r web/dist "${PACKAGE_NAME}_${VERSION}_${ARCH}/opt/patchpanel/web/dist"
cp web/package.json "${PACKAGE_NAME}_${VERSION}_${ARCH}/opt/patchpanel/web/"

# 8. Config template (postinst copies this to /etc/patchpanel/config.yaml on fresh install)
cp packaging/config/production-config.yaml "${PACKAGE_NAME}_${VERSION}_${ARCH}/opt/patchpanel/config-templates/"

# 9. systemd unit + maintainer scripts
cp packaging/DEBIAN/systemd/patchpanel.service "${PACKAGE_NAME}_${VERSION}_${ARCH}/etc/systemd/system/"
cp packaging/DEBIAN/{preinst,postinst,prerm,postrm} "${PACKAGE_NAME}_${VERSION}_${ARCH}/DEBIAN/"

# 10. Man pages (gzipped per Debian Policy 12.3)
gzip -9 -c packaging/DEBIAN/man/patchpanel.8 > "${PACKAGE_NAME}_${VERSION}_${ARCH}/usr/share/man/man8/patchpanel.8.gz"
gzip -9 -c packaging/DEBIAN/man/patchpanel.yaml.5 > "${PACKAGE_NAME}_${VERSION}_${ARCH}/usr/share/man/man5/patchpanel.yaml.5.gz"

# 11. DEBIAN/control
cat > "${PACKAGE_NAME}_${VERSION}_${ARCH}/DEBIAN/control" << EOF
Package: patchpanel
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Maintainer: MarkProminic <MarkProminic@users.noreply.github.com>
Depends: nodejs (>= 22.0.0), haproxy (>= 2.6), certbot, openssl
Recommends: python3-certbot-dns-cloudflare, python3-certbot-dns-route53, python3-certbot-dns-google, python3-certbot-dns-digitalocean
Description: State-driven web UI and config manager for HAProxy
 PatchPanel renders haproxy.cfg from a validated JSON state document,
 validates it with haproxy -c, atomically swaps the file, and reloads
 via the master CLI socket. Bundles Let's Encrypt (certbot, DNS-01
 plugins), trusted CA / CRL upload, and a REST API for remote control.
Homepage: https://github.com/STARTcloud/patchpanel
EOF

# 12. Permissions
find "${PACKAGE_NAME}_${VERSION}_${ARCH}" -type d -exec chmod 755 {} \;
find "${PACKAGE_NAME}_${VERSION}_${ARCH}" -type f -exec chmod 644 {} \;
chmod 755 "${PACKAGE_NAME}_${VERSION}_${ARCH}/DEBIAN"/{preinst,postinst,prerm,postrm}

# 13. Build
dpkg-deb --build "${PACKAGE_NAME}_${VERSION}_${ARCH}" "${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"
```

## Install + run

```bash
sudo apt install ./patchpanel_${VERSION}_amd64.deb
sudo systemctl enable --now patchpanel
journalctl -fu patchpanel
```

Open `https://<host>:8099/`. On first install, the postinst prints a
**setup token** — paste it into the first-run wizard to claim the
admin account.

## Filesystem layout after install

| Path                          | Owner                   | Purpose                                  |
| :---------------------------- | :---------------------- | :--------------------------------------- |
| `/opt/patchpanel/`            | `patchpanel:patchpanel` | Application code + node_modules          |
| `/etc/patchpanel/config.yaml` | `patchpanel:patchpanel` | Runtime config (metadata-wrapped YAML)   |
| `/etc/patchpanel/ssl/`        | `patchpanel` (700)      | Self-signed cert (generated at runtime)  |
| `/etc/patchpanel/.jwt-secret` | `patchpanel` (600)      | JWT signing key (postinst-generated)     |
| `/etc/patchpanel/setup.token` | `patchpanel` (600)      | First-run gate (consumed by wizard)      |
| `/var/lib/patchpanel/`        | `patchpanel:patchpanel` | `state.json`, `audit.sqlite`, snapshots/ |
| `/var/log/patchpanel/`        | `patchpanel:patchpanel` | Application logs (journald is primary)   |

## Single source of truth for versioning

The root `package.json` `version` field is canonical.
`npm run sync-versions` propagates it to:

- `server/package.json`
- `web/package.json`
- `packaging/config/production-config.yaml`
- `.release-please-manifest.json`

On every push to `main`, release-please reads conventional-commit
messages, computes the next version, opens a PR that bumps the same
files, and on merge cuts a GitHub release. `prod-build.yml` then builds
the `.deb` and rsyncs it into the STARTcloud apt repository under
`pool/main/p/patchpanel/`, regenerates `Packages`/`Release` for
`bookworm`, `trixie`, and `stable`, and GPG-signs each suite.

## Uninstall

```bash
sudo systemctl disable --now patchpanel
sudo apt remove patchpanel             # keeps /var/lib + /etc + user
sudo apt purge patchpanel              # removes everything
```

## Troubleshooting

```bash
# Logs
sudo journalctl -fu patchpanel

# Effective config
sudo -u patchpanel cat /etc/patchpanel/config.yaml

# Permission checks
sudo -u patchpanel ls -la /etc/haproxy/   # patchpanel must read+write here
sudo -u patchpanel test -w /etc/haproxy/haproxy.cfg && echo OK

# Restart
sudo systemctl restart patchpanel
```
