import { promises as fs } from 'node:fs';

import { Router } from 'express';

import { errorResponse } from '../lib/api-response.js';
import * as audit from '../lib/audit.js';
import { log } from '../lib/logger.js';
import {
  isAllowedLuaPluginDir,
  listLuaPluginFiles,
  luaPluginFileExists,
  luaPluginPath,
  readLuaPlugin,
  removeLuaPlugin,
  validateLuaPluginId,
  validateLuaPluginSource,
  writeLuaPlugin,
} from '../lib/lua-plugins.js';

// Lua plugin upload + management.
//
//   GET    /lua-plugins/dirs         configured upload-target whitelist
//                                    (paths.luaPluginsDirs from config.yaml)
//   GET    /lua-plugins              files on disk across all whitelisted
//                                    dirs — grouped by dir
//   GET    /lua-plugins/file         ?dir=…&name=… → raw .lua source
//   POST   /lua-plugins/upload       { dir, name, source } — validates +
//                                    writes <dir>/<name>.lua, returns the
//                                    absolute path for the state.json
//                                    luaPlugins[] entry
//   POST   /lua-plugins/delete       { dir, name } — removes the on-disk
//                                    file. Body-style because Express 5's
//                                    DELETE+body is awkward and dir/name
//                                    don't fit cleanly in path params.
//
// All endpoints reject any dir not in the configured whitelist so callers
// can't traverse outside the operator-approved set of upload targets.

const listFilesForDir = async dir => {
  const ids = await listLuaPluginFiles(dir);
  const summaries = await Promise.all(
    ids.map(async id => {
      const filePath = `${dir}/${id}.lua`;
      const stat = await fs.stat(filePath).catch(() => null);
      return {
        id,
        path: filePath,
        uploadedAt: stat?.mtime?.toISOString() ?? null,
        sizeBytes: stat?.size ?? null,
      };
    })
  );
  return summaries.sort((a, b) => a.id.localeCompare(b.id));
};

export const luaPluginsRouter = config => {
  const router = Router();
  const dirs = () => config.paths.luaPluginsDirs ?? [];

  /**
   * @swagger
   * /api/lua-plugins/dirs:
   *   get:
   *     summary: List configured Lua-plugin upload directories
   *     description: Returns `config.paths.luaPluginsDirs` — the operator-approved set of dirs that Lua plugin uploads are allowed to land in. Outside this whitelist, every upload/read/delete request is rejected.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Directory list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dirs: { type: array, items: { type: string } }
   */
  router.get('/lua-plugins/dirs', (req, res) => {
    log.api.debug('GET /lua-plugins/dirs', { ip: req.ip });
    res.set('cache-control', 'no-store').json({ dirs: dirs() });
  });

  /**
   * @swagger
   * /api/lua-plugins:
   *   get:
   *     summary: List uploaded Lua plugins across every whitelisted dir
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Plugins grouped by directory
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 dirs: { type: array, items: { type: string } }
   *                 grouped:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       dir: { type: string }
   *                       files:
   *                         type: array
   *                         items:
   *                           type: object
   *                           properties:
   *                             id: { type: string }
   *                             path: { type: string }
   *                             uploadedAt: { type: string, format: 'date-time', nullable: true }
   *                             sizeBytes: { type: integer, nullable: true }
   */
  router.get('/lua-plugins', async (req, res, next) => {
    log.api.debug('GET /lua-plugins', { ip: req.ip });
    try {
      const allDirs = dirs();
      const grouped = await Promise.all(
        allDirs.map(async dir => ({ dir, files: await listFilesForDir(dir) }))
      );
      res.set('cache-control', 'no-store').json({ dirs: allDirs, grouped });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/lua-plugins/file:
   *   get:
   *     summary: Read one Lua plugin's source
   *     description: Streams the raw `.lua` source. `dir` must match a whitelisted directory; `name` is the plugin id (without extension).
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: query
   *         name: dir
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Lua source
   *         content:
   *           text/x-lua:
   *             schema: { type: string }
   *       400: { description: 'dir not in whitelist or invalid name', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'File not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/lua-plugins/file', async (req, res, next) => {
    const dir = typeof req.query.dir === 'string' ? req.query.dir : null;
    const name = typeof req.query.name === 'string' ? req.query.name : null;
    log.api.debug('GET /lua-plugins/file', { ip: req.ip, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, ...errorResponse(req, 'lua.plugin.dirNotWhitelisted') });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res
        .status(400)
        .json({ ok: false, ...errorResponse(req, idError.code, idError.replacements) });
      return;
    }
    try {
      if (!(await luaPluginFileExists(dirs(), dir, name))) {
        res.status(404).json({ ok: false, ...errorResponse(req, 'lua.plugin.notFound') });
        return;
      }
      const source = await readLuaPlugin(dirs(), dir, name);
      res
        .set('content-type', 'text/x-lua; charset=utf-8')
        .set('cache-control', 'no-store')
        .send(source);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/lua-plugins/upload:
   *   post:
   *     summary: Upload a Lua plugin
   *     description: Validates the Lua source (parse-check) and writes it to `<dir>/<name>.lua`. `dir` must be in the configured whitelist.
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
   *             required: [dir, name, source]
   *             properties:
   *               dir: { type: string }
   *               name: { type: string, description: 'Plugin id (no extension)' }
   *               source: { type: string, description: 'Raw Lua source' }
   *     responses:
   *       200:
   *         description: Plugin written
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 name: { type: string }
   *                 dir: { type: string }
   *                 path: { type: string }
   *                 sizeBytes: { type: integer }
   *       400: { description: 'dir not in whitelist / invalid name / source rejected', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/lua-plugins/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { dir, name, source } = req.body ?? {};
    log.api.info('POST /lua-plugins/upload', { ip: req.ip, actor, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, ...errorResponse(req, 'lua.plugin.dirNotWhitelisted') });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res
        .status(400)
        .json({ ok: false, ...errorResponse(req, idError.code, idError.replacements) });
      return;
    }
    const sourceError = validateLuaPluginSource(source);
    if (sourceError) {
      res
        .status(400)
        .json({ ok: false, ...errorResponse(req, sourceError.code, sourceError.replacements) });
      return;
    }
    try {
      const filePath = await writeLuaPlugin(dirs(), dir, name, source);
      audit.record({
        actor,
        category: 'lua-plugin',
        action: 'upload',
        target: name,
        outcome: 'ok',
        details: { dir, sizeBytes: source.length },
      });
      log.api.info('lua plugin uploaded', { name, dir, sizeBytes: source.length });
      res.json({ ok: true, name, dir, path: filePath, sizeBytes: source.length });
    } catch (err) {
      audit.record({
        actor,
        category: 'lua-plugin',
        action: 'upload',
        target: name,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  /**
   * @swagger
   * /api/lua-plugins/delete:
   *   post:
   *     summary: Remove a Lua plugin
   *     description: POST (not DELETE) so the dir + name fit cleanly in the JSON body — Express 5's DELETE+body is awkward.
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
   *             required: [dir, name]
   *             properties:
   *               dir: { type: string }
   *               name: { type: string }
   *     responses:
   *       200:
   *         description: Removed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 name: { type: string }
   *                 dir: { type: string }
   *       400: { description: 'dir not in whitelist / invalid name', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/lua-plugins/delete', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { dir, name } = req.body ?? {};
    log.api.info('POST /lua-plugins/delete', { ip: req.ip, actor, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, ...errorResponse(req, 'lua.plugin.dirNotWhitelisted') });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res
        .status(400)
        .json({ ok: false, ...errorResponse(req, idError.code, idError.replacements) });
      return;
    }
    try {
      const filePath = luaPluginPath(dirs(), dir, name);
      await removeLuaPlugin(dirs(), dir, name);
      audit.record({
        actor,
        category: 'lua-plugin',
        action: 'delete',
        target: name,
        outcome: 'ok',
        details: { dir, path: filePath },
      });
      log.api.info('lua plugin deleted', { name, dir });
      res.json({ ok: true, name, dir });
    } catch (err) {
      audit.record({
        actor,
        category: 'lua-plugin',
        action: 'delete',
        target: name,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
