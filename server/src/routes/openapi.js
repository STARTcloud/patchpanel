import { Router } from 'express';

import * as logger from '../lib/logger.js';

// Hand-curated OpenAPI 3.1 description of the patchpanel REST API. Kept simple
// on purpose — no external dependency, no JSDoc scanner. When new endpoints
// land, add them here. The /api/openapi.json endpoint is the source of truth
// the in-app docs page consumes.

const buildSpec = () => ({
  openapi: '3.1.0',
  info: {
    title: 'patchpanel REST API',
    version: '1',
    description:
      'In-addon REST API for managing HAProxy state, certificates, runtime ops, and observability.',
  },
  servers: [{ url: '.' }],
  paths: {
    '/health': {
      get: {
        summary: 'Liveness probe',
        responses: {
          200: { description: 'patchpanel server is running' },
        },
      },
    },
    '/api/state': {
      get: { summary: 'Get full state document' },
      put: {
        summary: 'Replace full state document',
        description:
          'Schema-validates, renders haproxy.cfg, runs haproxy -c, atomically writes, reloads via master socket, rolls back on failure, and writes an audit + snapshot entry.',
      },
    },
    '/api/snapshots': {
      get: { summary: 'List state snapshots (newest first)' },
    },
    '/api/snapshots/{id}': {
      get: { summary: 'Read a snapshot' },
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
    '/api/snapshots/{id}/restore': {
      post: { summary: 'Restore state from a snapshot through the apply pipeline' },
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
    '/api/certificates': {
      get: { summary: 'List configured certs with lineage info from /data/letsencrypt' },
    },
    '/api/certificates/renew': {
      post: { summary: 'Renew all certs (force: bool body)' },
    },
    '/api/certificates/{id}/renew': {
      post: { summary: 'Renew one cert by id' },
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    },
    '/api/haproxy/cfg': {
      get: {
        summary: 'Read rendered haproxy.cfg',
        parameters: [
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string', enum: ['disk', 'state'] },
          },
        ],
      },
    },
    '/api/haproxy/reload': {
      post: { summary: 'Reload HAProxy via master socket' },
    },
    '/api/haproxy/status': {
      get: { summary: 'HAProxy master socket status' },
    },
    '/api/haproxy/ssl-capabilities': {
      get: {
        summary:
          'Introspect installed HAProxy + OpenSSL: version, features, ciphers, TLSv1.3 ciphersuites, curves, signature algorithms',
      },
    },
    '/api/haproxy/servers/{backend}/{server}/state': {
      post: { summary: 'Set server state (ready/drain/maint) via stats socket' },
    },
    '/api/haproxy/servers/{backend}/{server}/weight': {
      post: { summary: 'Set server weight (0-256) via stats socket' },
    },
    '/api/stats': {
      get: { summary: 'show info + show stat snapshot' },
    },
    '/api/stats/history': {
      get: { summary: 'Server-side rolling stats sampler buffer (1 hour)' },
    },
    '/api/stats/slowest-backends': {
      get: {
        summary:
          'Top-N backends sorted by HAProxy rtime (avg response time over last 1024 requests)',
      },
    },
    '/api/stats/http-codes': {
      get: {
        summary:
          'HTTP status-code distribution (1xx/2xx/3xx/4xx/5xx/other) across the sampled window',
      },
    },
    '/api/stats/sessions': {
      get: {
        summary:
          'show sess all summary (top clients/frontends/backends; geo-enriched when state.geoip.enabled)',
      },
    },
    '/api/logs': {
      get: { summary: "This addon's logs (via the Home Assistant supervisor)" },
    },
    '/api/logs/stream': {
      get: {
        summary: "SSE tail of this addon's logs — emits 'snapshot' then 'lines' events",
      },
    },
    '/api/audit': {
      get: { summary: 'Audit log entries (?limit, ?category, ?actor)' },
    },
    '/api/error-pages': {
      get: { summary: 'List error-page codes with current override + bundled template' },
    },
    '/api/error-pages/{code}': {
      get: { summary: 'Read one error-page entry' },
    },
    '/api/runtime/errors': {
      get: { summary: 'HAProxy "show errors" (raw)' },
    },
    '/api/runtime/resolvers': {
      get: { summary: 'HAProxy "show resolvers" (raw)' },
    },
    '/api/runtime/tables': {
      get: { summary: 'List stick tables' },
    },
    '/api/runtime/tables/{name}': {
      get: { summary: 'Dump stick table entries' },
    },
    '/api/runtime/tables/{name}/clear': {
      post: { summary: 'Clear stick table (or one key in body.key)' },
    },
    '/api/runtime/acls': {
      get: { summary: 'List runtime ACLs' },
    },
    '/api/runtime/acls/{ref}/entries': {
      get: { summary: 'Dump ACL entries' },
      post: { summary: 'Add ACL entry (body.value)' },
      delete: { summary: 'Delete ACL entry (?value)' },
    },
    '/api/runtime/maps': {
      get: { summary: 'List runtime maps' },
    },
    '/api/runtime/maps/{ref}/entries': {
      get: { summary: 'Dump map entries' },
      post: { summary: 'Add map entry (body.key + body.value)' },
      delete: { summary: 'Delete map entry (?key)' },
    },
    '/api/runtime/frontends/{name}/enable': {
      post: { summary: 'Enable HAProxy frontend (runtime)' },
    },
    '/api/runtime/frontends/{name}/disable': {
      post: { summary: 'Disable HAProxy frontend (runtime)' },
    },
    '/api/runtime/sessions/{id}/shutdown': {
      post: { summary: 'Shutdown one session' },
    },
    '/api/runtime/maxconn/frontend/{name}': {
      post: { summary: 'Set frontend maxconn (runtime)' },
    },
    '/api/runtime/maxconn/global': {
      post: { summary: 'Set global maxconn (runtime)' },
    },
    '/api/notifications/channel-types': {
      get: { summary: 'Supported channel types' },
    },
    '/api/notifications/test': {
      post: { summary: 'Send a test notification to a saved channel (body.channelId)' },
    },
    '/api/geoip/status': {
      get: { summary: 'GeoIP feature state + MaxMind DB info' },
    },
    '/api/geoip/lookup/{ip}': {
      get: { summary: 'Geo-lookup a single IP (MaxMind local first, then online fallback)' },
    },
    '/api/geoip/lookup': {
      post: { summary: 'Bulk geo-lookup (body.ips: string[])' },
    },
    '/api/geoip/download': {
      post: {
        summary: 'Download latest MaxMind GeoLite2-City DB using state.geoip.maxmindLicenseKey',
      },
    },
    '/api/auth-providers/{id}/test': {
      post: {
        summary:
          'Probe an auth provider — Authelia /api/configuration, basic-auth users files exist, OIDC discovery URL fetch',
      },
    },
    '/api/tls-providers/{id}/test': {
      post: {
        summary: 'Probe a TLS/ACME provider — credentials file existence + certbot lineage list',
      },
    },
    '/api/tls-providers/credential-template/{type}': {
      get: {
        summary:
          'DNS-provider credential form schema (no state lookup). Returns {type, format, fields[]}.',
        parameters: [{ name: 'type', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/api/tls-providers/{id}/credentials': {
      get: {
        summary:
          'On-disk credentials for a configured TLS provider. Secret fields are masked as "***".',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      put: {
        summary:
          'Write/update the per-provider credentials .ini. body.fields = { key: value }. Secret fields whose incoming value is "***" preserve the on-disk value.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      delete: {
        summary: 'Remove the credentials .ini for the provider.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
    },
    '/api/openapi.json': {
      get: { summary: 'This spec' },
    },
  },
});

export const openapiRouter = () => {
  const router = Router();

  router.get('/openapi.json', (req, res) => {
    logger.debug('GET /openapi.json', { ip: req.ip });
    res.set('cache-control', 'no-store').json(buildSpec());
  });

  router.get('/docs', (req, res) => {
    logger.debug('GET /docs', { ip: req.ip });
    // Lightweight Redoc-style page that fetches the spec.
    res.set('content-type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>patchpanel API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 0; }
      header { padding: 1rem 1.5rem; background: #212529; color: #f8f9fa; }
      main { padding: 1rem 1.5rem; }
      .endpoint { border-left: 4px solid #0d6efd; padding: 0.5rem 1rem; margin-bottom: 0.75rem; background: #f8f9fa; }
      .method { display: inline-block; min-width: 4.5rem; font-weight: 600; padding: 0.1rem 0.4rem; border-radius: 0.25rem; color: #fff; font-size: 0.75rem; text-transform: uppercase; }
      .GET { background: #198754; }
      .POST { background: #0d6efd; }
      .PUT { background: #fd7e14; }
      .DELETE { background: #dc3545; }
      .path { font-family: ui-monospace, Menlo, monospace; margin-left: 0.5rem; }
      .summary { color: #495057; margin: 0.25rem 0 0 0; }
    </style>
  </head>
  <body>
    <header><strong>patchpanel API</strong> &mdash; live endpoint reference</header>
    <main>
      <p>The full machine-readable spec is at <a href="openapi.json"><code>./openapi.json</code></a>.</p>
      <div id="content"><em>Loading…</em></div>
    </main>
    <script>
      (async () => {
        const res = await fetch('openapi.json', { credentials: 'same-origin' });
        const spec = await res.json();
        const root = document.getElementById('content');
        root.innerHTML = '';
        const paths = Object.keys(spec.paths).sort();
        for (const path of paths) {
          const ops = spec.paths[path];
          for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
            if (!ops[method]) continue;
            const card = document.createElement('div');
            card.className = 'endpoint';
            const m = method.toUpperCase();
            card.innerHTML =
              '<span class="method ' + m + '">' + m + '</span>' +
              '<span class="path">' + path + '</span>' +
              '<p class="summary">' + (ops[method].summary || '') + '</p>';
            root.appendChild(card);
          }
        }
      })();
    </script>
  </body>
</html>`);
  });

  return router;
};
