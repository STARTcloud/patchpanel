import { Router } from 'express';

import { log } from '../lib/logger.js';
import { dispatchEvent, SUPPORTED_CHANNELS, testChannel } from '../lib/notify.js';
import { loadState } from '../lib/state.js';

export const notificationsRouter = config => {
  const router = Router();

  /**
   * @swagger
   * /api/notifications/channel-types:
   *   get:
   *     summary: List supported notification channel types
   *     description: Returns the schema for each notification channel type (e.g. `webhook`, `email`, `slack`). The UI uses this to drive channel-create forms.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Channel type metadata
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 types:
   *                   type: array
   *                   items: { type: object }
   */
  router.get('/notifications/channel-types', (req, res) => {
    log.api.debug('GET /notifications/channel-types', { ip: req.ip });
    res.json({ types: SUPPORTED_CHANNELS });
  });

  /**
   * @swagger
   * /api/notifications/test:
   *   post:
   *     summary: Send a test notification
   *     description: Dispatches a synthetic event to one configured channel so the operator can verify the channel works. Channel must already exist in `state.notifications.channels[]`.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [channelId]
   *             properties:
   *               channelId: { type: string }
   *     responses:
   *       200: { description: 'Test dispatched', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Missing channelId', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Channel not found in state', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/notifications/test', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const channelId = req.body?.channelId;
    if (!channelId) {
      res.status(400).json({ error: 'channelId required' });
      return;
    }
    log.api.info('POST /notifications/test', { ip: req.ip, actor, channelId });
    try {
      const state = await loadState(config.paths.state);
      const channel = state?.notifications?.channels?.find(c => c.id === channelId);
      if (!channel) {
        res.status(404).json({ error: `channel not found: ${channelId}` });
        return;
      }
      await testChannel(channel);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/notifications/dispatch:
   *   post:
   *     summary: Manually dispatch a notification event (diagnostic)
   *     description: Fans out a synthetic event to every channel that matches the event's category. Real notifications come from server-side hooks; this is a diagnostic / dry-run surface for operators.
   *     tags: [Observability]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object, description: 'Event payload (category-dependent)' }
   *     responses:
   *       200:
   *         description: Dispatch summary (per-channel outcome)
   *         content:
   *           application/json:
   *             schema: { type: object }
   */
  router.post('/notifications/dispatch', async (req, res, next) => {
    // Manual dispatch hook; mostly for diagnostics. Real events come from server-side hooks.
    const event = req.body ?? {};
    try {
      const state = await loadState(config.paths.state);
      const channels = state?.notifications?.channels ?? [];
      const summary = await dispatchEvent(channels, event);
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
