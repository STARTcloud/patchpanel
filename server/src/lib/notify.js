import { log } from './logger.js';

const DEFAULT_TIMEOUT_MS = 10_000;

const fetchWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const sendHaNotify = async (channel, event) => {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error('SUPERVISOR_TOKEN not set; HA notify channel only works inside an addon');
  }
  const service = channel.config?.service ?? 'persistent_notification.create';
  const [domain, name] = service.split('.');
  if (!domain || !name) {
    throw new Error(`invalid HA notify service: ${service}`);
  }
  const data = {
    title: event.title,
    message: event.message,
    ...(channel.config?.data ?? {}),
  };
  const response = await fetchWithTimeout(
    `http://supervisor/core/api/services/${domain}/${name}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(data),
    },
    DEFAULT_TIMEOUT_MS
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HA notify failed: ${response.status} ${body.slice(0, 200)}`);
  }
};

const sendWebhook = async (channel, event) => {
  const url = channel.config?.url;
  if (!url) {
    throw new Error('webhook url missing');
  }
  const headers = { 'content-type': 'application/json', ...(channel.config?.headers ?? {}) };
  const body = JSON.stringify({
    title: event.title,
    message: event.message,
    severity: event.severity,
    ts: event.ts,
    source: 'patchpanel',
    details: event.details ?? {},
  });
  const response = await fetchWithTimeout(
    url,
    { method: 'POST', headers, body },
    DEFAULT_TIMEOUT_MS
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`webhook ${url} returned ${response.status}: ${text.slice(0, 200)}`);
  }
};

const DISCORD_COLORS = Object.freeze({
  error: 0xdc3545,
  warning: 0xffc107,
  success: 0x198754,
  info: 0x0d6efd,
});

const NTFY_PRIORITIES = Object.freeze({
  error: 'urgent',
  warning: 'high',
  success: 'default',
  info: 'default',
});

const sendDiscord = async (channel, event) => {
  const url = channel.config?.webhookUrl;
  if (!url) {
    throw new Error('discord webhookUrl missing');
  }
  const color = DISCORD_COLORS[event.severity] ?? DISCORD_COLORS.info;
  const body = JSON.stringify({
    username: channel.config?.username ?? 'patchpanel',
    embeds: [
      {
        title: event.title,
        description: event.message,
        color,
        timestamp: new Date(event.ts).toISOString(),
      },
    ],
  });
  const response = await fetchWithTimeout(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    DEFAULT_TIMEOUT_MS
  );
  if (!response.ok && response.status !== 204) {
    const text = await response.text().catch(() => '');
    throw new Error(`discord ${response.status}: ${text.slice(0, 200)}`);
  }
};

const sendNtfy = async (channel, event) => {
  const baseUrl = channel.config?.url ?? 'https://ntfy.sh';
  const topic = channel.config?.topic;
  if (!topic) {
    throw new Error('ntfy topic missing');
  }
  const headers = {
    title: event.title,
    priority: NTFY_PRIORITIES[event.severity] ?? NTFY_PRIORITIES.info,
  };
  if (channel.config?.tags) {
    headers.tags = channel.config.tags;
  }
  if (channel.config?.token) {
    headers.authorization = `Bearer ${channel.config.token}`;
  }
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(topic)}`,
    { method: 'POST', headers, body: event.message },
    DEFAULT_TIMEOUT_MS
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ntfy ${response.status}: ${text.slice(0, 200)}`);
  }
};

const sendSlack = async (channel, event) => {
  const url = channel.config?.webhookUrl;
  if (!url) {
    throw new Error('slack webhookUrl missing');
  }
  const body = JSON.stringify({
    text: `*${event.title}*\n${event.message}`,
    username: channel.config?.username ?? 'patchpanel',
    icon_emoji: channel.config?.iconEmoji ?? ':shield:',
  });
  const response = await fetchWithTimeout(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    DEFAULT_TIMEOUT_MS
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`slack ${response.status}: ${text.slice(0, 200)}`);
  }
};

const PROVIDERS = Object.freeze({
  'ha-notify': sendHaNotify,
  webhook: sendWebhook,
  discord: sendDiscord,
  ntfy: sendNtfy,
  slack: sendSlack,
});

export const SUPPORTED_CHANNELS = Object.freeze(Object.keys(PROVIDERS));

const channelHandlesEvent = (channel, event) => {
  if (!channel.enabled) {
    return false;
  }
  const events = channel.events ?? [];
  if (events.length === 0) {
    return true; // empty list means subscribe to everything
  }
  return events.includes(event.kind);
};

const channelMeetsSeverity = (channel, event) => {
  const min = channel.minSeverity ?? 'info';
  const order = ['info', 'success', 'warning', 'error'];
  return order.indexOf(event.severity) >= order.indexOf(min);
};

export const dispatchEvent = async (channels, event) => {
  const enriched = { ts: Date.now(), severity: 'info', details: {}, ...event };
  const results = await Promise.allSettled(
    channels
      .filter(c => channelHandlesEvent(c, enriched))
      .filter(c => channelMeetsSeverity(c, enriched))
      .map(async c => {
        const provider = PROVIDERS[c.type];
        if (!provider) {
          throw new Error(`unsupported channel type: ${c.type}`);
        }
        await provider(c, enriched);
        return c.id;
      })
  );
  for (const r of results) {
    if (r.status === 'rejected') {
      log.app.warn('notification channel failed', {
        error: r.reason?.message ?? String(r.reason),
      });
    }
  }
  return {
    delivered: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
};

export const testChannel = (channel, event) => {
  const provider = PROVIDERS[channel.type];
  if (!provider) {
    throw new Error(`unsupported channel type: ${channel.type}`);
  }
  return provider(channel, {
    title: 'patchpanel test notification',
    message: 'If you can read this, the channel works.',
    severity: 'info',
    ts: Date.now(),
    kind: 'test',
    ...event,
  });
};
