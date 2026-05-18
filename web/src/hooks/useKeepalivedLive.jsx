import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiGet } from '../api/client.js';

// Keepalived liveness + per-VRRP-instance state. Mirrors useHaproxyLive
// (same shape, same tri-state `alive`, same one-poll-loop model) but reads
// from /api/keepalived/state, which returns:
//
//   { installed: bool, alive: bool|null,
//     strategy: 's6'|'systemd'|'direct'|'docker-exec'|'none',
//     instances: [{ id, state: 'MASTER'|'BACKUP'|'FAULT'|'INIT', holding: bool }] }
//
// `alive` is tri-state until the first probe resolves so the UI can show
// "checking…" instead of falsely reporting "stopped." `installed` lets the
// navbar hide the badge entirely on deployments that don't ship keepalived
// (e.g. HA addons without the binary installed) — distinct from "installed
// but currently stopped" (alive: false, badge shows red with Start menu).
// `strategy` is the reload-control strategy detected at server startup
// (cached server-side).

const DEFAULT_POLL_MS = 5_000;

const KeepalivedLiveContext = createContext(null);

const fetchState = async setters => {
  try {
    const payload = await apiGet('api/keepalived/state');
    setters.setAlive(payload?.alive ?? null);
    setters.setStrategy(payload?.strategy ?? null);
    setters.setInstances(payload?.instances ?? []);
    setters.setInstalled(payload?.installed ?? true);
    setters.setNodeId(payload?.nodeId ?? null);
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
  const [installed, setInstalled] = useState(true);
  const [nodeId, setNodeId] = useState(null);
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
      setInstalled: v => active && setInstalled(v),
      setNodeId: v => active && setNodeId(v),
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
      installed,
      nodeId,
      error,
      loaded,
      refresh,
    }),
    [alive, strategy, instances, installed, nodeId, error, loaded, refresh]
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
