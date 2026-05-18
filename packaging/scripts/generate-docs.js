#!/usr/bin/env node

/**
 * Generate static API documentation for the Jekyll docs site.
 *
 * Three outputs (mirrors armor / zoneweaver-api):
 *   - docs/api/openapi.json — raw OpenAPI 3.1 spec
 *   - docs/api/swagger-ui.html — standalone HTML page embedding swagger-ui-dist
 *     from unpkg, NOT Jekyll-processed (kept HTML so it survives JTD's
 *     compress_html and renders the Swagger UI directly)
 *   - docs/api/reference.md — Jekyll page with iframe to swagger-ui.html
 *
 * The spec is built by swagger-jsdoc when ../../server/src/config/swagger.js
 * loads. apis: in that file uses absolute paths derived from import.meta.url
 * so this script works regardless of cwd.
 */

import fs from 'node:fs';
import path from 'node:path';

import { specs } from '../../server/src/config/swagger.js';

const SWAGGER_UI_DIST_VERSION = '5.10.5';

const generateSwaggerUI = () => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>patchpanel API Reference</title>
    <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui.css" />
    <style>
        html {
            box-sizing: border-box;
            overflow: -moz-scrollbars-vertical;
            overflow-y: scroll;
        }
        *, *:before, *:after {
            box-sizing: inherit;
        }
        body {
            margin: 0;
            background: #1c1c1e !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        }
        .swagger-ui .topbar { display: none; }
        .swagger-ui { color: #f0f6fc !important; }
        .swagger-ui .info .title { color: #f0f6fc !important; }
        .swagger-ui .info .description,
        .swagger-ui .info .description p { color: #c9d1d9 !important; }

        /* Scheme/server selector */
        .swagger-ui .scheme-container {
            background: #21262d !important;
            border: 1px solid #30363d !important;
            padding: 16px !important;
            border-radius: 6px !important;
            box-shadow: 0 1px 2px 0 rgba(0,0,0,.15);
            margin-bottom: 20px;
        }
        .swagger-ui .scheme-container table {
            width: 100% !important;
            background: transparent !important;
            border-collapse: separate !important;
            border-spacing: 0 !important;
            margin: 0 !important;
        }
        .swagger-ui .scheme-container table tr {
            display: flex !important;
            align-items: center !important;
            margin-bottom: 12px !important;
        }
        .swagger-ui .scheme-container table tr:last-child { margin-bottom: 0 !important; }
        .swagger-ui .scheme-container table td:first-child {
            background: transparent !important;
            border: none !important;
            color: #f0f6fc !important;
            padding: 8px 12px 8px 0 !important;
            min-width: 80px !important;
            text-align: left !important;
            font-weight: 400 !important;
            margin-right: 12px !important;
            flex-shrink: 0 !important;
        }
        .swagger-ui .scheme-container table td:last-child {
            background: transparent !important;
            border: none !important;
            padding: 0 !important;
            flex: 1 !important;
        }
        .swagger-ui .scheme-container select,
        .swagger-ui .scheme-container input {
            background: #21262d !important;
            border: 1px solid #30363d !important;
            color: #f0f6fc !important;
            padding: 8px 12px !important;
            border-radius: 4px !important;
            font-size: 13px !important;
            width: 100% !important;
            box-sizing: border-box !important;
        }
        .swagger-ui .scheme-container select:focus,
        .swagger-ui .scheme-container input:focus {
            border-color: #1f6feb !important;
            box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.3) !important;
            outline: none !important;
        }
        .swagger-ui .computed-url {
            margin: 10px 0;
            font-size: 13px;
        }
        .swagger-ui .computed-url code {
            background: #21262d !important;
            color: #79c0ff !important;
            border: 1px solid #30363d !important;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }

        /* Model/schema tables */
        .swagger-ui table.model {
            background: #0d1117 !important;
            border: 1px solid #30363d !important;
            border-radius: 4px !important;
            margin: 10px 0 !important;
            border-collapse: collapse;
            width: 100%;
        }
        .swagger-ui table.model td {
            background: #0d1117 !important;
            border-color: #30363d !important;
            color: #f0f6fc !important;
            padding: 8px 12px !important;
            border-top: 1px solid #30363d !important;
            vertical-align: top;
            font-size: 13px;
        }
        .swagger-ui table.model .property-row:first-child td { border-top: none !important; }
        .swagger-ui table.model .property-name { color: #79c0ff !important; font-weight: 600 !important; }
        .swagger-ui table.model .property-type { color: #a5a5a5 !important; font-style: italic !important; }
        .swagger-ui .model-title { color: #f0f6fc !important; }
        .swagger-ui .model-box {
            background: #0d1117 !important;
            border: 1px solid #30363d !important;
            border-radius: 4px !important;
            width: 100% !important;
            max-width: 100% !important;
        }
        .swagger-ui .model-box-control {
            background: #21262d !important;
            color: #f0f6fc !important;
            border-bottom: 1px solid #30363d !important;
            width: 100% !important;
            padding: 12px 16px !important;
            display: flex !important;
            align-items: center !important;
            cursor: pointer !important;
            font-size: 13px !important;
            border-radius: 4px 4px 0 0 !important;
            border-top: none;
            border-left: none;
            border-right: none;
        }
        .swagger-ui .model-box-control:hover { background: #30363d !important; }
        .swagger-ui .model-toggle {
            margin-right: 8px !important;
            font-size: 12px !important;
            display: inline-block !important;
            color: #8b949e !important;
        }
        .swagger-ui .model-toggle:before { display: none !important; }
        .swagger-ui .model-toggle.collapsed:after { content: '►' !important; color: #8b949e !important; }
        .swagger-ui .model-toggle:not(.collapsed):after { content: '▼' !important; color: #8b949e !important; }
        .swagger-ui span.model-toggle { color: #8b949e !important; }
        .swagger-ui span.model-toggle:before { display: none !important; }
        .swagger-ui span.model-toggle:after { color: #8b949e !important; }

        /* Opblocks */
        .swagger-ui .opblock {
            background: #0d1117 !important;
            border: 1px solid #30363d !important;
        }
        .swagger-ui .opblock .opblock-summary { border-color: #30363d !important; }
        .swagger-ui .opblock.opblock-post { background: #0d1117 !important; border-color: #238636 !important; }
        .swagger-ui .opblock.opblock-get { background: #0d1117 !important; border-color: #1f6feb !important; }
        .swagger-ui .opblock.opblock-put { background: #0d1117 !important; border-color: #d2a863 !important; }
        .swagger-ui .opblock.opblock-delete { background: #0d1117 !important; border-color: #da3633 !important; }
        .swagger-ui .opblock .opblock-summary-method { text-shadow: none !important; }

        .swagger-ui .btn.authorize {
            background: #238636 !important;
            border-color: #2ea043 !important;
            color: #ffffff !important;
        }
        .swagger-ui .btn.authorize:hover { background: #2ea043 !important; }

        .swagger-ui input[type=text],
        .swagger-ui input[type=password],
        .swagger-ui input[type=search],
        .swagger-ui input[type=email],
        .swagger-ui textarea,
        .swagger-ui select {
            background: #21262d !important;
            border: 1px solid #30363d !important;
            color: #e6edf3 !important;
        }
        .swagger-ui input[type=text]:focus,
        .swagger-ui input[type=password]:focus,
        .swagger-ui input[type=search]:focus,
        .swagger-ui input[type=email]:focus,
        .swagger-ui textarea:focus,
        .swagger-ui select:focus {
            border-color: #1f6feb !important;
            box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.3) !important;
        }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>

    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_DIST_VERSION}/swagger-ui-standalone-preset.js"></script>
    <script>
        window.onload = function() {
            const ui = SwaggerUIBundle({
                url: 'openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                    SwaggerUIBundle.presets.apis,
                    SwaggerUIStandalonePreset
                ],
                plugins: [
                    SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout",
                tryItOutEnabled: true,
                requestInterceptor: function(request) {
                    if (request.url.startsWith('http')) {
                        console.log('Note: Try-it-out functionality requires CORS on the API server.');
                    }
                    return request;
                }
            });
        };
    </script>
</body>
</html>`;

const generateRedirectPage = () => `---
title: Interactive API Reference
layout: default
nav_order: 1
parent: API Reference
permalink: /docs/api/reference/
---

# Interactive API Reference

<div style="width: 100%; height: 800px; border: none; margin: 0; padding: 0;">
  <iframe
    src="../swagger-ui.html"
    style="width: 100%; height: 100%; border: none; background: white;"
    title="patchpanel API Reference">
    <p>Your browser does not support iframes.
       <a href="../swagger-ui.html">Click here to view the API documentation</a>
    </p>
  </iframe>
</div>

## Alternative Formats

- **[View Full Screen](../swagger-ui.html)** — open Swagger UI in a new tab for better experience
- **[Download OpenAPI Spec](../openapi.json)** — raw OpenAPI 3.1 specification file

---

*The interactive API documentation above lets you explore every endpoint, view request/response schemas, and try API calls directly from your browser (CORS permitting).*
`;

const generateDocs = () => {
  console.log('Generating API documentation...');

  const docsDir = path.join(process.cwd(), 'docs', 'api');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  console.log('Writing OpenAPI specification...');
  fs.writeFileSync(path.join(docsDir, 'openapi.json'), `${JSON.stringify(specs, null, 2)}\n`);
  console.log('  wrote docs/api/openapi.json');

  console.log('Generating Swagger UI HTML...');
  fs.writeFileSync(path.join(docsDir, 'swagger-ui.html'), generateSwaggerUI());
  console.log('  wrote docs/api/swagger-ui.html');

  console.log('Generating Jekyll redirect page...');
  fs.writeFileSync(path.join(docsDir, 'reference.md'), generateRedirectPage());
  console.log('  wrote docs/api/reference.md');

  console.log('');
  console.log('Documentation generation completed.');
};

generateDocs();
