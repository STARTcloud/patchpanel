import { Router } from 'express';

import { getAddonLogBroadcaster } from '../lib/log-broadcaster.js';
import { log } from '../lib/logger.js';

const SUPERVISOR_BASE = 'http://supervisor';
const ADDON_LOGS_PATH = '/addons/self/logs';

const fetchAddonLogs = async token => {
  const response = await fetch(`${SUPERVISOR_BASE}${ADDON_LOGS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(
      `supervisor returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
    );
    err.status = response.status;
    throw err;
  }
  return response.text();
};

export const logsRouter = () => {
  const router = Router();

  /**
   * @swagger
   * /api/logs:
   *   get:
   *     summary: Addon container logs (HA only)
   *     description: Fetches the addon's logs via the Home Assistant supervisor (`http://supervisor/addons/self/logs`). Returns 501 outside the addon (when `SUPERVISOR_TOKEN` env is unset — standalone Debian doesn't have this surface).
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Container log text
   *         content:
   *           text/plain:
   *             schema: { type: string }
   *       501: { description: 'Not running inside HA addon', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/logs', async (req, res, next) => {
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) {
      res.status(501).json({
        error:
          'supervisor token not available; the logs endpoint is only functional inside a Home Assistant addon',
      });
      return;
    }
    log.api.debug('GET /logs', { ip: req.ip });
    try {
      const text = await fetchAddonLogs(token);
      res.set('content-type', 'text/plain; charset=utf-8').send(text);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/logs/stream:
   *   get:
   *     summary: SSE tail of addon container logs
   *     description: Server-Sent Events stream that begins with a `ready` event, then emits `lines` events as new log output arrives, plus `ping` heartbeats every 30s. HA addon only. Use `text/event-stream` Accept header.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: SSE stream
   *         content:
   *           text/event-stream:
   *             schema: { type: string }
   *       501: { description: 'Not running inside HA addon', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/logs/stream', (req, res) => {
    if (!process.env.SUPERVISOR_TOKEN) {
      res.status(501).json({ error: 'supervisor token not available' });
      return;
    }
    log.api.debug('GET /logs/stream', { ip: req.ip });
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);

    const broadcaster = getAddonLogBroadcaster();
    broadcaster.addClient(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      } catch {
        // ignore
      }
    }, 30_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      broadcaster.removeClient(res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  return router;
};
