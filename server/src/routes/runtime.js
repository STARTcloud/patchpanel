import { Router } from 'express';

import * as audit from '../lib/audit.js';
import * as haproxyStats from '../lib/haproxy-stats.js';
import * as logger from '../lib/logger.js';

export const runtimeRouter = config => {
  const router = Router();
  const socket = () => config.paths.haproxyStatsSocket;

  router.get('/runtime/errors', async (req, res, next) => {
    logger.debug('GET /runtime/errors', { ip: req.ip });
    try {
      res.json(await haproxyStats.showErrors(socket()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime/resolvers', async (req, res, next) => {
    logger.debug('GET /runtime/resolvers', { ip: req.ip });
    try {
      res.json(await haproxyStats.showResolvers(socket()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime/tables', async (req, res, next) => {
    logger.debug('GET /runtime/tables', { ip: req.ip });
    try {
      res.json(await haproxyStats.showTables(socket()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime/tables/:name', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showTable(socket(), req.params.name));
    } catch (err) {
      next(err);
    }
  });

  router.post('/runtime/tables/:name/clear', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { name } = req.params;
    const key = typeof req.body?.key === 'string' ? req.body.key : null;
    logger.info('POST /runtime/tables/:name/clear', { ip: req.ip, actor, name, key });
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

  router.get('/runtime/acls', async (req, res, next) => {
    logger.debug('GET /runtime/acls', { ip: req.ip });
    try {
      res.json(await haproxyStats.showAcls(socket()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime/acls/:ref/entries', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showAclEntries(socket(), req.params.ref));
    } catch (err) {
      next(err);
    }
  });

  router.post('/runtime/acls/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { value } = req.body ?? {};
    if (!value) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    logger.info('POST /runtime/acls/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
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

  router.delete('/runtime/acls/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { value } = req.query;
    if (typeof value !== 'string' || !value) {
      res.status(400).json({ error: 'value query param required' });
      return;
    }
    logger.info('DELETE /runtime/acls/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
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

  router.get('/runtime/maps', async (req, res, next) => {
    logger.debug('GET /runtime/maps', { ip: req.ip });
    try {
      res.json(await haproxyStats.showMaps(socket()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/runtime/maps/:ref/entries', async (req, res, next) => {
    try {
      res.json(await haproxyStats.showMapEntries(socket(), req.params.ref));
    } catch (err) {
      next(err);
    }
  });

  router.post('/runtime/maps/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { key, value } = req.body ?? {};
    if (!key || typeof value !== 'string') {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }
    logger.info('POST /runtime/maps/:ref/entries', { ip: req.ip, actor, ref: req.params.ref, key });
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

  router.delete('/runtime/maps/:ref/entries', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const { key } = req.query;
    if (typeof key !== 'string' || !key) {
      res.status(400).json({ error: 'key query param required' });
      return;
    }
    logger.info('DELETE /runtime/maps/:ref/entries', { ip: req.ip, actor, ref: req.params.ref });
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

  router.post('/runtime/frontends/:name/enable', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /runtime/frontends/:name/enable', {
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

  router.post('/runtime/frontends/:name/disable', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /runtime/frontends/:name/disable', {
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

  router.post('/runtime/sessions/:id/shutdown', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /runtime/sessions/:id/shutdown', { ip: req.ip, actor, id: req.params.id });
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

  router.post('/runtime/maxconn/frontend/:name', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const max = Number(req.body?.max);
    if (!Number.isInteger(max) || max < 0) {
      res.status(400).json({ error: 'max must be a non-negative integer' });
      return;
    }
    logger.info('POST /runtime/maxconn/frontend/:name', {
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

  router.post('/runtime/maxconn/global', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const max = Number(req.body?.max);
    if (!Number.isInteger(max) || max < 0) {
      res.status(400).json({ error: 'max must be a non-negative integer' });
      return;
    }
    logger.info('POST /runtime/maxconn/global', { ip: req.ip, actor, max });
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

  router.post('/runtime/counters/clear', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    logger.info('POST /runtime/counters/clear', { ip: req.ip, actor });
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
