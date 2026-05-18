import { log } from './logger.js';

const SUPERVISOR_BASE = 'http://supervisor';
const ADDON_LOGS_PATH = '/addons/self/logs';
const POLL_INTERVAL_MS = 2_000;
const MAX_BUFFERED_LINES = 5_000;

const fetchAddonLogs = async token => {
  const response = await fetch(`${SUPERVISOR_BASE}${ADDON_LOGS_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const err = new Error(`supervisor returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.text();
};

const createAddonLogBroadcaster = () => {
  const clients = new Set();
  let lastText = '';
  let lastTail = '';
  let intervalHandle = null;

  const sendInitial = res => {
    if (lastText) {
      const opening =
        lastText.length > MAX_BUFFERED_LINES * 200
          ? lastText.slice(-MAX_BUFFERED_LINES * 200)
          : lastText;
      const lines = opening.split('\n');
      const event = `event: snapshot\ndata: ${JSON.stringify({ lines })}\n\n`;
      res.write(event);
    }
  };

  const broadcast = (event, payload) => {
    const wire = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...clients]) {
      try {
        client.write(wire);
      } catch (err) {
        clients.delete(client);
        try {
          client.end();
        } catch {
          // ignore
        }
        log.app.debug('dropped SSE client on write error', { error: err.message });
      }
    }
  };

  const tick = async () => {
    if (clients.size === 0) {
      return;
    }
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) {
      return;
    }
    try {
      const text = await fetchAddonLogs(token);
      if (!text || text === lastText) {
        return;
      }
      let newSegment = text;
      if (lastTail && text.length > lastTail.length) {
        const idx = text.lastIndexOf(lastTail);
        if (idx >= 0) {
          newSegment = text.slice(idx + lastTail.length);
        }
      }
      lastText = text;
      lastTail = text.slice(-512);
      const newLines = newSegment.split('\n').filter(line => line.length > 0);
      if (newLines.length > 0) {
        broadcast('lines', { lines: newLines, ts: Date.now() });
      }
    } catch (err) {
      broadcast('error', { message: err.message, ts: Date.now() });
    }
  };

  const ensureRunning = () => {
    if (intervalHandle) {
      return;
    }
    intervalHandle = setInterval(() => {
      tick().catch(() => undefined);
    }, POLL_INTERVAL_MS);
    intervalHandle.unref?.();
    tick().catch(() => undefined);
  };

  const maybeStop = () => {
    if (clients.size === 0 && intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
      lastText = '';
      lastTail = '';
    }
  };

  const addClient = res => {
    clients.add(res);
    ensureRunning();
    sendInitial(res);
  };

  const removeClient = res => {
    clients.delete(res);
    maybeStop();
  };

  return {
    addClient,
    removeClient,
    get clientCount() {
      return clients.size;
    },
  };
};

let cached = null;
export const getAddonLogBroadcaster = () => {
  if (!cached) {
    cached = createAddonLogBroadcaster();
  }
  return cached;
};
