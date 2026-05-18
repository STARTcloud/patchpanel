import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import { log } from '../lib/logger.js';

export const runtimeRouter = config => {
  const router = Router();
  const socket = () => config.paths.haproxyStatsSocket;

  /**
   * @swagger
   * /api/runtime/errors:
   *   get:
   *     summary: Dump HAProxy "show errors"
   *     description: Recent in-process HAProxy errors (raw text from the stats socket).
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Error dump
   *         content: { application/json: { schema: { type: object } } }
   */
  router.get('/runtime/errors', async (req, res, next) => {
    log.api.debug('GET /runtime/errors', { ip: req.ip });
    try {
      res.json(await haproxyStats.showErrors(socket()));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/resolvers:
   *   get:
   *     summary: Dump HAProxy "show resolvers"
   *     description: DNS resolver section state (servers, queries, cache).
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Resolver state
   *         content: { application/json: { schema: { type: object } } }
   */
  router.get('/runtime/resolvers', async (req, res, next) => {
    log.api.debug('GET /runtime/resolvers', { ip: req.ip });
    try {
      res.json(await haproxyStats.showResolvers(socket()));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/tables:
   *   get:
   *     summary: List stick tables
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'Table list', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/tables', async (req, res, next) => {
    log.api.debug('GET /runtime/tables', { ip: req.ip });
    try {
      res.json(await haproxyStats.showTables(socket()));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/tables/{name}:
   *   get:
   *     summary: Dump stick table entries
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Table entries', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/tables/:name', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showTable(socket(), req.params.name));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/tables/{name}/clear:
   *   post:
   *     summary: Clear stick table (all or one key)
   *     description: Clears the entire table by default. Pass `{key: "..."}` in the body to clear only one key.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               key: { type: string, description: 'Specific key to clear; omit to clear the entire table' }
   *     responses:
   *       200:
   *         description: Cleared
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean }
   *                 output: { type: string }
   */
  router.post('/runtime/tables/:name/clear', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name } = req.params;
    const key = typeof req.body?.key === 'string' ? req.body.key : null;
    log.api.info('POST /runtime/tables/:name/clear', { ip: req.ip, actor, name, key });
    try {
      const output = await haproxyStats.clearTable(socket(), name, key);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'clear-table',
        target: key ? `${name}/${key}` : name,
        outcome: 'ok',
        details: { output: output.trim().slice(0, 200) },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'clear-table',
        target: key ? `${name}/${key}` : name,
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/acls:
   *   get:
   *     summary: List runtime ACLs
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'ACL list', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/acls', async (req, res, next) => {
    log.api.debug('GET /runtime/acls', { ip: req.ip });
    try {
      res.json(await haproxyStats.showAcls(socket()));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/acls/{ref}/entries:
   *   get:
   *     summary: Dump entries of one ACL
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *         description: ACL reference (id or file path as shown in `show acl`)
   *     responses:
   *       200: { description: 'ACL entries', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/acls/:ref/entries', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showAclEntries(socket(), req.params.ref));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/acls/{ref}/entries:
   *   post:
   *     summary: Add an ACL entry (runtime-only)
   *     description: Mutates the in-memory ACL. Does NOT persist across HAProxy restart unless the ACL is backed by a file.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [value]
   *             properties:
   *               value: { type: string }
   *     responses:
   *       200: { description: 'Entry added', content: { application/json: { schema: { type: object, properties: { ok: { type: boolean }, output: { type: string } } } } } }
   *       400: { description: 'Missing value', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/runtime/acls/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { value } = req.body ?? {};
    if (!value) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    log.api.info('POST /runtime/acls/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
    try {
      const output = await haproxyStats.addAclEntry(socket(), req.params.ref, value);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'add-acl',
        target: `${req.params.ref}/${value}`,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/acls/{ref}/entries:
   *   delete:
   *     summary: Remove an ACL entry (runtime-only)
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: value
   *         required: true
   *         schema: { type: string }
   *         description: Value to remove (URL-encoded)
   *     responses:
   *       200: { description: 'Entry removed', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'Missing value', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/runtime/acls/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { value } = req.query;
    if (typeof value !== 'string' || !value) {
      res.status(400).json({ error: 'value query param required' });
      return;
    }
    log.api.info('DELETE /runtime/acls/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
    try {
      const output = await haproxyStats.delAclEntry(socket(), req.params.ref, value);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'del-acl',
        target: `${req.params.ref}/${value}`,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maps:
   *   get:
   *     summary: List runtime maps
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'Map list', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/maps', async (req, res, next) => {
    log.api.debug('GET /runtime/maps', { ip: req.ip });
    try {
      res.json(await haproxyStats.showMaps(socket()));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maps/{ref}/entries:
   *   get:
   *     summary: Dump map entries
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Map entries', content: { application/json: { schema: { type: object } } } }
   */
  router.get('/runtime/maps/:ref/entries', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showMapEntries(socket(), req.params.ref));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maps/{ref}/entries:
   *   post:
   *     summary: Add a map entry (runtime-only)
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [key, value]
   *             properties:
   *               key: { type: string }
   *               value: { type: string }
   *     responses:
   *       200: { description: 'Entry added', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'Missing key/value', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/runtime/maps/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { key, value } = req.body ?? {};
    if (!key || typeof value !== 'string') {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }
    log.api.info('POST /runtime/maps/:ref/entries', {
      ip: req.ip,
      actor,
      ref: req.params.ref,
      key,
    });
    try {
      const output = await haproxyStats.addMapEntry(socket(), req.params.ref, key, value);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'add-map',
        target: `${req.params.ref}/${key}`,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maps/{ref}/entries:
   *   delete:
   *     summary: Remove a map entry (runtime-only)
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: ref
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: key
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Entry removed', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'Missing key', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/runtime/maps/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { key } = req.query;
    if (typeof key !== 'string' || !key) {
      res.status(400).json({ error: 'key query param required' });
      return;
    }
    log.api.info('DELETE /runtime/maps/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
    try {
      const output = await haproxyStats.delMapEntry(socket(), req.params.ref, key);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'del-map',
        target: `${req.params.ref}/${key}`,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/frontends/{name}/enable:
   *   post:
   *     summary: Enable a frontend (runtime)
   *     description: Resumes listening on a previously-disabled frontend. Mutation is in-memory only — survives reload, not restart.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Enabled', content: { application/json: { schema: { type: object } } } }
   */
  router.post('/runtime/frontends/:name/enable', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /runtime/frontends/:name/enable', {
      ip: req.ip,
      actor,
      name: req.params.name,
    });
    try {
      const output = await haproxyStats.enableFrontend(socket(), req.params.name);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'enable-frontend',
        target: req.params.name,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/frontends/{name}/disable:
   *   post:
   *     summary: Disable a frontend (runtime)
   *     description: Stops accepting new connections on the frontend. Existing connections continue.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: 'Disabled', content: { application/json: { schema: { type: object } } } }
   */
  router.post('/runtime/frontends/:name/disable', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /runtime/frontends/:name/disable', {
      ip: req.ip,
      actor,
      name: req.params.name,
    });
    try {
      const output = await haproxyStats.disableFrontend(socket(), req.params.name);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'disable-frontend',
        target: req.params.name,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/sessions/{id}/shutdown:
   *   post:
   *     summary: Forcibly terminate one HAProxy session
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Session id from `show sess`
   *     responses:
   *       200: { description: 'Session killed', content: { application/json: { schema: { type: object } } } }
   */
  router.post('/runtime/sessions/:id/shutdown', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /runtime/sessions/:id/shutdown', { ip: req.ip, actor, id: req.params.id });
    try {
      const output = await haproxyStats.shutdownSession(socket(), req.params.id);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'shutdown-session',
        target: req.params.id,
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maxconn/frontend/{name}:
   *   post:
   *     summary: Set per-frontend maxconn (runtime)
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [max]
   *             properties:
   *               max: { type: integer, minimum: 0 }
   *     responses:
   *       200: { description: 'maxconn set', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'max not a non-negative integer', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/runtime/maxconn/frontend/:name', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const max = Number(req.body?.max);
    if (!Number.isInteger(max) || max < 0) {
      res.status(400).json({ error: 'max must be a non-negative integer' });
      return;
    }
    log.api.info('POST /runtime/maxconn/frontend/:name', {
      ip: req.ip,
      actor,
      name: req.params.name,
      max,
    });
    try {
      const output = await haproxyStats.setMaxconnFrontend(socket(), req.params.name, max);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-maxconn-frontend',
        target: req.params.name,
        outcome: 'ok',
        details: { max },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/maxconn/global:
   *   post:
   *     summary: Set global maxconn (runtime)
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [max]
   *             properties:
   *               max: { type: integer, minimum: 0 }
   *     responses:
   *       200: { description: 'maxconn set', content: { application/json: { schema: { type: object } } } }
   *       400: { description: 'max not a non-negative integer', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/runtime/maxconn/global', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const max = Number(req.body?.max);
    if (!Number.isInteger(max) || max < 0) {
      res.status(400).json({ error: 'max must be a non-negative integer' });
      return;
    }
    log.api.info('POST /runtime/maxconn/global', { ip: req.ip, actor, max });
    try {
      const output = await haproxyStats.setMaxconnGlobal(socket(), max);
      audit.record({
        actor,
        category: 'haproxy',
        action: 'set-maxconn-global',
        outcome: 'ok',
        details: { max },
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/runtime/counters/clear:
   *   post:
   *     summary: Reset all HAProxy max/total counters
   *     description: Clears every frontend/backend/server counter. Useful before benchmark runs.
   *     tags: [HAProxy Runtime]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200: { description: 'Counters cleared', content: { application/json: { schema: { type: object } } } }
   */
  router.post('/runtime/counters/clear', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    log.api.info('POST /runtime/counters/clear', { ip: req.ip, actor });
    try {
      const output = await haproxyStats.clearCounters(socket());
      audit.record({
        actor,
        category: 'haproxy',
        action: 'clear-counters',
        outcome: 'ok',
      });
      res.json({ ok: true, output: output.trim() });
    } catch (err) {
      audit.record({
        actor,
        category: 'haproxy',
        action: 'clear-counters',
        outcome: 'error',
        details: { error: err.message },
      });
      next(err);
    }
  });

  return router;
};
