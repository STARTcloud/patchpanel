import { promises as fs } from 'node:fs';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as logger from '../lib/logger.js';
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

  router.get('/lua-plugins/dirs', (req, res) => {
    logger.debug('GET /lua-plugins/dirs', { ip: req.ip });
    res.set('cache-control', 'no-store').json({ dirs: dirs() });
  });

  router.get('/lua-plugins', async (req, res, next) => {
    logger.debug('GET /lua-plugins', { ip: req.ip });
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

  router.get('/lua-plugins/file', async (req, res, next) => {
    const dir = typeof req.query.dir === 'string' ? req.query.dir : null;
    const name = typeof req.query.name === 'string' ? req.query.name : null;
    logger.debug('GET /lua-plugins/file', { ip: req.ip, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, error: 'dir is not in the configured whitelist' });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    try {
      if (!(await luaPluginFileExists(dirs(), dir, name))) {
        res.status(404).json({ ok: false, error: 'not found' });
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

  router.post('/lua-plugins/upload', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { dir, name, source } = req.body ?? {};
    logger.info('POST /lua-plugins/upload', { ip: req.ip, actor, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, error: 'dir is not in the configured whitelist' });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
      return;
    }
    const sourceError = validateLuaPluginSource(source);
    if (sourceError) {
      res.status(400).json({ ok: false, error: sourceError });
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
      logger.info('lua plugin uploaded', { name, dir, sizeBytes: source.length });
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

  router.post('/lua-plugins/delete', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { dir, name } = req.body ?? {};
    logger.info('POST /lua-plugins/delete', { ip: req.ip, actor, dir, name });
    if (!isAllowedLuaPluginDir(dirs(), dir)) {
      res.status(400).json({ ok: false, error: 'dir is not in the configured whitelist' });
      return;
    }
    const idError = validateLuaPluginId(name);
    if (idError) {
      res.status(400).json({ ok: false, error: idError });
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
      logger.info('lua plugin deleted', { name, dir });
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
