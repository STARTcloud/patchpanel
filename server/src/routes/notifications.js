import { Router } from 'express';

import * as logger from '../lib/logger.js';
import { dispatchEvent, SUPPORTED_CHANNELS, testChannel } from '../lib/notify.js';
import { loadState } from '../lib/state.js';

export const notificationsRouter = config => {
  const router = Router();

  router.get('/notifications/channel-types', (req, res) => {
    logger.debug('GET /notifications/channel-types', { ip: req.ip });
    res.json({ types: SUPPORTED_CHANNELS });
  });

  router.post('/notifications/test', async (req, res, next) => {
    const actor = req.user?.id ?? null;
    const channelId = req.body?.channelId;
    if (!channelId) {
      res.status(400).json({ error: 'channelId required' });
      return;
    }
    logger.info('POST /notifications/test', { ip: req.ip, actor, channelId });
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
