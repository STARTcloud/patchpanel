# PatchPanel Dockerfile — standalone Docker deployment surface.
#
# Stage 1 (builder): node:24-bookworm builds the Vite frontend and
#   installs runtime npm deps. Matches the HA addon's builder stage.
# Stage 2 (runtime): STARTcloud's debian13-server base (same base the
#   HA addon uses) with Node + certbot + openssl + tini layered on top.
#
# Pair with docker-compose.yml at repo root for a two-container
# standalone Docker deployment.

ARG BUILD_FROM=public.containers.startcloud.com/startcloud/debian13-server:2025.8.13
ARG NODE_MAJOR=22

# ─────────────────────────── Stage 1: builder ───────────────────────────
FROM node:24-bookworm AS builder

WORKDIR /build

# Copy workspace manifests first for better layer caching
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

# Strip dev dependencies for the runtime stage
RUN rm -rf node_modules server/node_modules web/node_modules \
 && npm ci --omit=dev --workspaces --include-workspace-root --no-audit --no-fund

# ─────────────────────────── Stage 2: runtime ───────────────────────────
FROM ${BUILD_FROM}

ARG NODE_MAJOR
ARG BUILD_DATE
ARG BUILD_REF
ARG BUILD_VERSION

LABEL \
    org.opencontainers.image.title="patchpanel" \
    org.opencontainers.image.description="State-driven web UI and config manager for HAProxy" \
    org.opencontainers.image.vendor="STARTcloud" \
    org.opencontainers.image.licenses="GPL-3.0" \
    org.opencontainers.image.source="https://github.com/STARTcloud/patchpanel" \
    org.opencontainers.image.documentation="https://patchpanel.startcloud.com/" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.revision="${BUILD_REF}" \
    org.opencontainers.image.version="${BUILD_VERSION}"

ENV \
    LANG=C.UTF-8 \
    DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    CONFIG_PATH=/etc/patchpanel/config.yaml \
    NODE_OPTIONS=--use-openssl-ca

# Base apt packages
RUN chmod 1777 /tmp \
 && apt-get update \
 && apt-get install --no-install-recommends -yqq \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        openssl \
        python3 \
        python3-venv \
        tini \
 && rm -rf /var/lib/apt/lists/*

# Node.js from NodeSource (debian13-server ships an older Node).
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
 && apt-get install --no-install-recommends -yqq nodejs \
 && rm -rf /var/lib/apt/lists/*

# certbot in an isolated venv with bundled DNS provider plugins.
RUN python3 -m venv /opt/certbot \
 && /opt/certbot/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/certbot/bin/pip install --no-cache-dir \
        'certbot>=5.6.0' \
        'certbot-dns-cloudflare>=5.6.0' \
        'certbot-dns-route53>=5.6.0' \
        'certbot-dns-google>=5.6.0' \
        'certbot-dns-digitalocean>=5.6.0' \
        'certbot-dns-ovh>=5.6.0' \
        'certbot-dns-rfc2136>=5.6.0' \
        'certbot-dns-multi' \
 && ln -sf /opt/certbot/bin/certbot /usr/bin/certbot

# Non-root system user. UID/GID 1500 stable container-only ID.
RUN groupadd -r -g 1500 patchpanel \
 && useradd  -r -u 1500 -g 1500 -d /opt/patchpanel -s /usr/sbin/nologin patchpanel

WORKDIR /opt/patchpanel

# Application from builder
COPY --from=builder --chown=patchpanel:patchpanel /build/package.json /build/package-lock.json ./
COPY --from=builder --chown=patchpanel:patchpanel /build/node_modules ./node_modules
COPY --from=builder --chown=patchpanel:patchpanel /build/server ./server
COPY --from=builder --chown=patchpanel:patchpanel /build/web/dist ./web/dist
COPY --from=builder --chown=patchpanel:patchpanel /build/web/package.json ./web/package.json

# Config template (runtime configMigrator copies this on first boot)
COPY --from=builder --chown=patchpanel:patchpanel /build/packaging/config/production-config.yaml ./config-templates/production-config.yaml

# Volume mountpoints
RUN install -d -o patchpanel -g patchpanel -m 755 /etc/patchpanel /var/lib/patchpanel /var/log/patchpanel \
 && install -d -o patchpanel -g patchpanel -m 700 /etc/patchpanel/ssl

USER patchpanel

EXPOSE 8099

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/src/server.js"]
