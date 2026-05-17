import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiGet } from '../api/client.js';

// Keepalived liveness + per-VRRP-instance state. Mirrors useHaproxyLive
// (same shape, same tri-state `alive`, same one-poll-loop model) but reads
// from /api/keepalived/state, which returns:
//
//   { alive: bool|null, strategy: 's6'|'systemd'|'direct'|'docker-exec'|'none',
//     instances: [{ id, state: 'MASTER'|'BACKUP'|'FAULT'|'INIT', holding: bool }] }
//
// `alive` is tri-state until the first probe resolves so the UI can show
// "checking…" instead of falsely reporting "stopped." `strategy` is the
// reload-control strategy detected at server startup (cached server-side).

const DEFAULT_POLL_MS = 5_000;

const KeepalivedLiveContext = createContext(null);

const fetchState = async setters => {
  try {
    const payload = await apiGet('api/keepalived/state');
    // Preserve tri-state: server returns true/false when it can read the
    // pidfile, null when it can't. Coercing null → false would show
    // "stopped" for a probe that genuinely couldn't tell.
    setters.setAlive(payload?.alive ?? null);
    setters.setStrategy(payload?.strategy ?? null);
    setters.setInstances(payload?.instances ?? []);
    setters.setError(null);
  } catch (err) {
    setters.setError(err);
    setters.setAlive(false);
  } finally {
    setters.setLoaded(true);
  }
};

export const KeepalivedLiveProvider = ({ pollMs = DEFAULT_POLL_MS, children }) => {
  const [alive, setAlive] = useState(null);
  const [strategy, setStrategy] = useState(null);
  const [instances, setInstances] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let active = true;
    const setters = {
      setAlive: v => active && setAlive(v),
      setStrategy: v => active && setStrategy(v),
      setInstances: v => active && setInstances(v),
      setError: v => active && setError(v),
      setLoaded: v => active && setLoaded(v),
    };
    fetchState(setters);
    const interval = setInterval(() => fetchState(setters), pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollMs, version]);

  const value = useMemo(
    () => ({
      alive: loaded ? alive : null,
      strategy,
      instances,
      error,
      loaded,
      refresh,
    }),
    [alive, strategy, instances, error, loaded, refresh]
  );

  return <KeepalivedLiveContext.Provider value={value}>{children}</KeepalivedLiveContext.Provider>;
};

KeepalivedLiveProvider.propTypes = {
  pollMs: PropTypes.number,
  children: PropTypes.node.isRequired,
};

export const useKeepalivedLive = () => {
  const ctx = useContext(KeepalivedLiveContext);
  if (!ctx) {
    throw new Error('useKeepalivedLive must be used inside a KeepalivedLiveProvider');
  }
  return ctx;
};
