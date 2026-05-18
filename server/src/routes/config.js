import { basename, resolve as resolvePath } from 'node:path';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { applyConfigPatch, writeRawConfig } from '../lib/config-write.js';
import { ValidationError } from '../lib/errors.js';
import { ensureDir, safePathUnder, writeAtomic } from '../lib/files.js';
import { log } from '../lib/logger.js';

import configLoader from '../config/configLoader.js';
import { requireAdmin } from '../middleware/auth.js';

// /api/config — admin-only CRUD for /etc/patchpanel/config.yaml. The config
// is metadata-wrapped YAML (every leaf is {type, value, description, section,
// subsection, validation, ...}). Edits are applied at the leaf-value layer:
// the client sends a flat {path: value} patch, the server validates each
// value against the leaf's schema metadata, then atomic-writes the YAML back
// to disk. Most fields require a process restart to take effect — POST
// /config/restart exits the process so systemd (or the HA addon supervisor)
// brings us back with the new values loaded.

const SSL_UPLOAD_ROOT = '/etc/patchpanel/ssl';
const SSL_FILENAME_RE = /^[a-zA-Z0-9._-]+\.(?:pem|crt|key|ca-bundle)$/u;

const buildConfigRouter = () => {
  const router = Router();
  router.use(requireAdmin);

  /**
   * @swagger
   * /api/config:
   *   get:
   *     summary: Read the metadata-wrapped operator config
   *     description: Returns the full `/etc/patchpanel/config.yaml` tree as JSON, including the schema metadata (type / section / subsection / description / validation) on every leaf. Admin-only. The Settings UI uses this to auto-build its form; scripts can `.value`-pluck the fields they care about.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Metadata-wrapped config tree. Each leaf is `{type, value, description, section, subsection, validation, ...}`. A top-level `_sections` map keys each section name to `{icon, description, order}` for UI rendering.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               additionalProperties: true
   *       401: { description: 'Authentication required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       403: { description: 'Admin role required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/config', (req, res, next) => {
    log.api.debug('GET /config', { actor: req.user?.id });
    try {
      const raw = configLoader.getRawConfig();
      res.set('cache-control', 'no-store').json(raw);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/config:
   *   put:
   *     summary: Apply a patch of leaf values to the operator config
   *     description: |
   *       Accepts a flat `{path: value}` map where each path is a dotted YAML path to a metadata leaf. Each value is validated against the leaf's schema metadata (`type`, `options`, `validation.min/max`) before disk write. The first UI-driven save against a hand-written `config.yaml` preserves the original verbatim at `<configPath>.preserved-<iso>` so any operator-added comments / formatting survive — the response includes the preserved path. Subsequent saves (file already carries the patchpanel watermark) do not create new sidecars.
   *
   *       Most fields require a process restart to take effect; the response always returns `requiresRestart: true`. Use `POST /api/config/restart` (or restart manually) to apply.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [patch]
   *             properties:
   *               patch:
   *                 type: object
   *                 description: Flat map of dotted paths to new leaf values. Empty objects are rejected.
   *                 additionalProperties: true
   *                 example:
   *                   server.port: 8443
   *                   ssl.minVersion: TLSv1.3
   *                   security.bcryptRounds: 14
   *     responses:
   *       200:
   *         description: Config written
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 requiresRestart: { type: boolean, example: true }
   *                 preservedPath:
   *                   type: string
   *                   nullable: true
   *                   description: Path to verbatim copy of the pre-save config. Only set on the first save against a foreign (non-watermarked) file; null on subsequent saves.
   *       400: { description: 'Empty patch, malformed body, unknown path, or value failed schema validation', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Authentication required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       403: { description: 'Admin role required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.put('/config', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const patch = req.body?.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      res.status(400).json({ ok: false, error: 'body.patch must be an object' });
      return;
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ ok: false, error: 'patch must not be empty' });
      return;
    }
    try {
      const raw = configLoader.getRawConfig();
      const updated = applyConfigPatch(raw, patch);
      const configPath = configLoader.getLoadedFrom();
      if (!configPath) {
        throw new Error('configLoader loaded-from path unknown');
      }
      const writeResult = await writeRawConfig(configPath, updated);
      // Reset + re-load so subsequent GETs reflect the new state. Both ops are
      // synchronous w.r.t. the event loop so there's no window where a peer
      // request could see an unloaded cache.
      configLoader.reset();
      configLoader.load();
      audit.record({
        actor,
        category: 'config',
        action: 'update',
        outcome: 'ok',
        details: {
          paths: Object.keys(patch),
          count: Object.keys(patch).length,
          preservedPath: writeResult.preservedPath,
        },
      });
      log.api.info('config updated', {
        actor,
        paths: Object.keys(patch),
        preservedPath: writeResult.preservedPath,
      });
      res.json({
        ok: true,
        requiresRestart: true,
        preservedPath: writeResult.preservedPath,
      });
    } catch (err) {
      audit.record({
        actor,
        category: 'config',
        action: 'update',
        outcome: 'error',
        details: { error: err.message },
      });
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      next(err);
    }
  });

  /**
   * @swagger
   * /api/config/restart:
   *   post:
   *     summary: Restart the patchpanel process
   *     description: Sends `SIGTERM` to the running process so systemd (with `Restart=always`) or the Home Assistant addon supervisor restarts it. Required after most config saves because the running daemon captured the prior config in memory at boot. The Settings UI polls `/health` for up to 60 s after this call and auto-reloads on first 2xx.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Restart initiated; the process is exiting. Subsequent requests will fail until the supervisor brings the server back up.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 message: { type: string, example: 'restart initiated' }
   *       401: { description: 'Authentication required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       403: { description: 'Admin role required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/config/restart', (req, res) => {
    const actor = req.user?.id ?? null;
    audit.record({
      actor,
      category: 'config',
      action: 'restart',
      outcome: 'ok',
      details: { trigger: 'config-update' },
    });
    log.api.warn('process termination triggered by /api/config/restart', { actor });
    // Flush the response BEFORE signalling self — the .end() callback fires
    // only after the bytes are on the wire. SIGTERM rather than process.exit
    // so the supervisor (systemd Restart=always, HA addon container, etc.)
    // sees a normal signal-terminated exit and brings us back cleanly.
    res.status(200).type('json');
    res.end(JSON.stringify({ ok: true, message: 'restart initiated' }), () => {
      process.kill(process.pid, 'SIGTERM');
    });
  });

  /**
   * @swagger
   * /api/config/upload-file:
   *   post:
   *     summary: Upload a PEM file to /etc/patchpanel/ssl/
   *     description: |
   *       Backs the file-picker shown by the Settings UI on fields tagged `upload: true` (currently `ssl.cert_path` and `ssl.key_path`). The server enforces the destination directory — only the basename of `targetPath` is honoured and only files matching `[a-zA-Z0-9._-]+\.(pem|crt|key|ca-bundle)` are accepted. Returns the canonical on-disk path so the form can write it back into the field's `.value`.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [targetPath, content]
   *             properties:
   *               targetPath:
   *                 type: string
   *                 description: Desired path under `/etc/patchpanel/ssl/`. Only the basename is used; the directory is enforced server-side.
   *                 example: '/etc/patchpanel/ssl/server.crt'
   *               content:
   *                 type: string
   *                 description: File contents as a string (PEM text).
   *     responses:
   *       200:
   *         description: File written, mode 0600.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 path: { type: string, description: 'Canonical on-disk path of the written file.' }
   *       400: { description: 'Bad target path, disallowed filename, or non-string fields', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Authentication required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       403: { description: 'Admin role required', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/config/upload-file', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { targetPath, content } = req.body ?? {};
    if (typeof targetPath !== 'string' || typeof content !== 'string') {
      res.status(400).json({ ok: false, error: 'targetPath and content are required strings' });
      return;
    }
    try {
      const fileBasename = basename(targetPath);
      if (!SSL_FILENAME_RE.test(fileBasename)) {
        throw new ValidationError('filename must match [a-zA-Z0-9._-]+.(pem|crt|key|ca-bundle)');
      }
      // The targetPath claims to point somewhere; reject anything not strictly
      // under SSL_UPLOAD_ROOT before we even consider the filename. We accept
      // only basename-flat writes (no subdirs) under the root for now.
      const resolvedTarget = resolvePath(targetPath);
      const resolvedRoot = resolvePath(SSL_UPLOAD_ROOT);
      if (!resolvedTarget.startsWith(resolvedRoot)) {
        throw new ValidationError(`target must be under ${SSL_UPLOAD_ROOT}`);
      }
      const finalPath = safePathUnder(SSL_UPLOAD_ROOT, fileBasename);
      await ensureDir(SSL_UPLOAD_ROOT, 0o700);
      await writeAtomic(finalPath, content, { mode: 0o600 });
      audit.record({
        actor,
        category: 'config',
        action: 'upload-file',
        target: finalPath,
        outcome: 'ok',
        details: { bytes: content.length },
      });
      log.api.info('config file uploaded', { actor, path: finalPath, bytes: content.length });
      res.json({ ok: true, path: finalPath });
    } catch (err) {
      audit.record({
        actor,
        category: 'config',
        action: 'upload-file',
        target: targetPath,
        outcome: 'error',
        details: { error: err.message },
      });
      if (err instanceof ValidationError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
};

export const configRouter = buildConfigRouter;
