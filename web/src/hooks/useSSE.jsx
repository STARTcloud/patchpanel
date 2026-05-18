import { useEffect, useRef, useState } from 'react';

import { log } from '../utils/Logger.js';

const RECONNECT_DELAY_MS = 5_000;

export const useSSE = (path, { events = {}, enabled = true } = {}) => {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const handlersRef = useRef(events);
  useEffect(() => {
    handlersRef.current = events;
  });

  useEffect(() => {
    if (!enabled || !path) {
      return undefined;
    }

    let cancelled = false;
    let source = null;
    let reconnectTimer = null;

    const dispatch = (eventName, raw) => {
      const handler = handlersRef.current[eventName];
      if (!handler) {
        return;
      }
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = raw;
      }
      try {
        handler(payload);
      } catch (err) {
        log.app.error(`SSE handler "${eventName}" threw`, {
          error: err?.message,
          stack: err?.stack,
        });
      }
    };

    const connect = () => {
      if (cancelled) {
        return;
      }
      const url = new URL(path.replace(/^\//u, ''), document.baseURI).toString();
      source = new EventSource(url, { withCredentials: true });

      source.addEventListener('open', () => {
        if (!cancelled) {
          setConnected(true);
          setError(null);
        }
      });

      source.addEventListener('message', e => {
        dispatch('message', e.data);
      });

      Object.keys(handlersRef.current).forEach(eventName => {
        if (eventName === 'message') {
          return;
        }
        source.addEventListener(eventName, e => {
          dispatch(eventName, e.data);
        });
      });

      source.addEventListener('error', () => {
        if (cancelled) {
          return;
        }
        setConnected(false);
        setError(new Error('SSE connection lost'));
        try {
          source.close();
        } catch {
          // ignore
        }
        source = null;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (source) {
        try {
          source.close();
        } catch {
          // ignore
        }
      }
      setConnected(false);
    };
  }, [path, enabled]);

  return { connected, error };
};
