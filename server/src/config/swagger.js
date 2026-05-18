import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import swaggerJsdoc from 'swagger-jsdoc';

// Build the OpenAPI 3.1 spec at module load. The spec is the merge of:
//   1. This file's `definition` block (info, servers, security schemes,
//      base schemas, top-level tags).
//   2. Every `@swagger`-tagged JSDoc block found by globbing the route files
//      below.
//
// Paths are resolved against this file's directory rather than process.cwd()
// so swagger-jsdoc works identically whether the spec is loaded by the
// running server (cwd = server/) or by packaging/scripts/generate-docs.js
// (cwd = repo root).

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
const routesGlob = resolve(__dirname, '../routes/*.js');

const options = {
  definition: {
    openapi: '3.1.0',
    info: {
      title: 'patchpanel REST API',
      version: pkg.version,
      description:
        'REST API for the patchpanel HAProxy management server. Manages state ' +
        '(haproxy.cfg is rendered from a canonical state document), certificates ' +
        "(Let's Encrypt + BYO), runtime ops (server states, stick tables, ACLs, " +
        'maps), and observability (stats, logs, audit, GeoIP). The server runs ' +
        'in three deployment modes — `homeassistant` (behind HA ingress, ' +
        'authenticated upstream), `standalone` (cookie session + Bearer tokens), ' +
        'and `none` (dev-only, no auth).',
      license: {
        name: 'GPL-3.0',
        url: 'https://www.gnu.org/licenses/gpl-3.0.html',
      },
      contact: {
        name: 'patchpanel',
        url: 'https://github.com/STARTcloud/patchpanel',
      },
    },
    servers: [
      { url: 'http://localhost:8099', description: 'Standalone Debian default' },
      {
        url: '{protocol}://{host}',
        description: 'Custom server (set protocol + host)',
        variables: {
          protocol: { default: 'https', enum: ['http', 'https'] },
          host: { default: 'patchpanel.example.com:8099' },
        },
      },
    ],
    tags: [
      { name: 'Health', description: 'Liveness + readiness probes' },
      {
        name: 'Auth',
        description: 'Login, logout, session probe, setup wizard, API token CRUD',
      },
      { name: 'State', description: 'Canonical state document + snapshot time machine' },
      {
        name: 'Certificates',
        description: "Let's Encrypt + BYO certs + trusted CAs + CRLs",
      },
      {
        name: 'HAProxy Runtime',
        description:
          'Direct HAProxy ops via stats/master sockets — reload, server states, runtime ACLs/maps/tables, error/resolver dumps',
      },
      {
        name: 'Observability',
        description: 'Stats sampler, logs (file + SSE tail), audit log, GeoIP, notifications',
      },
      {
        name: 'Configuration',
        description:
          'Auth/TLS providers, Lua plugins, keepalived/VRRP, node identity, error pages, peer sync',
      },
      { name: 'System', description: 'System interfaces, hostname, OS info' },
      { name: 'Documentation', description: 'OpenAPI spec' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'pp_<keyId>.<secret>',
          description:
            'API token authentication. Mint a token under Profile → API tokens, then send as ' +
            '`Authorization: Bearer pp_<keyId>.<secret>`. Tokens are independent of cookie ' +
            'sessions and work in every auth strategy.',
        },
        CookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'patchpanel.sid',
          description:
            'Session JWT issued by `POST /api/auth/login` and stored in an httpOnly cookie. ' +
            'Only relevant in `local` auth strategy.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              description: 'Error class name (e.g. ValidationError, AuthError)',
              example: 'AuthError',
            },
            message: {
              type: 'string',
              description: 'Human-readable error message',
              example: 'authentication required',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
          },
        },
        ApiToken: {
          type: 'object',
          required: ['keyId', 'name', 'createdAt'],
          properties: {
            keyId: {
              type: 'string',
              example: 'a1b2c3d4',
              description: 'Token identifier (left of the dot in the wire format)',
            },
            name: { type: 'string', example: 'ci-pipeline' },
            createdBy: {
              type: 'string',
              nullable: true,
              description: 'User id of the admin who minted the token',
            },
            createdAt: { type: 'string', format: 'date-time' },
            expiresAt: { type: 'string', format: 'date-time', nullable: true },
            lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        Snapshot: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '2026-05-17T12-34-56Z-abc1234' },
            snapshotAt: { type: 'string', format: 'date-time' },
            actor: { type: 'string', nullable: true },
            reason: { type: 'string', nullable: true },
            state: { type: 'object', description: 'Full state document at snapshot time' },
          },
        },
        StateDoc: {
          type: 'object',
          description:
            'Canonical patchpanel state document. Zod-validated server-side; full structure includes global/defaults/frontends/backends/routes/acls/rules/tls/letsencrypt/keepalived/peers/etc. The OpenAPI spec keeps this opaque — refer to `server/src/lib/state-schema.js` for the authoritative shape.',
          additionalProperties: true,
        },
      },
    },
    security: [{ BearerAuth: [] }, { CookieAuth: [] }],
  },
  apis: [routesGlob],
};

export const specs = swaggerJsdoc(options);
