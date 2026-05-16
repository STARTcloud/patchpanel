#!/usr/bin/env node

/**
 * Generate static API documentation for the Jekyll docs site.
 *
 * PatchPanel's OpenAPI spec is not yet wired up. This script emits a
 * minimal stub openapi.json + a placeholder swagger-ui.html + a Jekyll
 * wrapper so that:
 *   - docs.yml CI doesn't break trying to run `npm run generate-docs`
 *   - the docs site at https://patchpanel.startcloud.com/docs/api/ has
 *     working `swagger-ui.html` and `openapi.json` link targets
 *   - the slot is ready for swagger-jsdoc once route handlers are
 *     annotated with @openapi JSDoc blocks
 *
 * When OpenAPI lands, replace the stub with:
 *   import { specs } from '../../server/src/config/swagger.js';
 *   const openApi = JSON.stringify(specs, null, 2);
 */

import fs from 'fs';
import path from 'path';

const rootPackage = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const VERSION = rootPackage.version;

const stubOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'PatchPanel API',
    version: VERSION,
    description:
      'PatchPanel REST API. Endpoint annotations not yet extracted from ' +
      'route handlers; the full spec will appear here when swagger-jsdoc is ' +
      'wired into the build.',
    license: {
      name: 'GPL-3.0',
      url: 'https://github.com/STARTcloud/patchpanel/blob/main/LICENSE.md',
    },
  },
  servers: [{ url: 'https://localhost:8099', description: 'Default standalone install' }],
  paths: {},
};

const stubSwaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PatchPanel API Reference</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #1c1c1e;
      color: #f0f6fc;
      margin: 0;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 720px; margin: 4rem auto; }
    h1 { color: #f0f6fc; }
    p { color: #c9d1d9; }
    a { color: #79c0ff; }
    code { background: #21262d; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>PatchPanel API Reference</h1>
    <p><strong>Version ${VERSION}</strong></p>
    <p>The interactive Swagger UI will appear here once PatchPanel's OpenAPI
       spec is generated from the route handlers (planned).</p>
    <p>In the meantime, see the
       <a href="../">API overview</a>
       for the endpoint summary, or the raw stub
       <a href="openapi.json"><code>openapi.json</code></a>.</p>
  </div>
</body>
</html>`;

const stubReferenceMd = `---
title: Interactive API Reference
layout: default
nav_order: 1
parent: API Reference
permalink: /docs/api/reference/
---

# Interactive API Reference

The interactive Swagger UI is not yet wired up. Once PatchPanel's OpenAPI
spec is generated from route-handler JSDoc, it will live at
[swagger-ui.html](../swagger-ui.html).

In the meantime, see the [API overview](../) for the endpoint summary.
`;

const generate = () => {
  console.log(`Generating API documentation stubs for v${VERSION}...`);

  const docsApiDir = path.join(process.cwd(), 'docs', 'api');
  if (!fs.existsSync(docsApiDir)) {
    fs.mkdirSync(docsApiDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(docsApiDir, 'openapi.json'),
    `${JSON.stringify(stubOpenApi, null, 2)}\n`
  );
  console.log('  wrote docs/api/openapi.json (stub)');

  fs.writeFileSync(path.join(docsApiDir, 'swagger-ui.html'), stubSwaggerUiHtml);
  console.log('  wrote docs/api/swagger-ui.html (stub)');

  fs.writeFileSync(path.join(docsApiDir, 'reference.md'), stubReferenceMd);
  console.log('  wrote docs/api/reference.md (stub)');

  console.log('');
  console.log('Stubs only. Replace with swagger-jsdoc extraction once route');
  console.log('handlers carry @openapi annotations.');
};

generate();
