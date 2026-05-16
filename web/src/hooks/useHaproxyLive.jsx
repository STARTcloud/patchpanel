import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { apiGet } from '../api/client.js';

// Single source of truth for "is HAProxy alive" and "what supervisor strategy
// is in effect" across the whole app. Both pieces are useful in more than one
// place (Layout's nav-bar power control, Dashboard's runtime panels,
// QuickActionsCard, etc.), so we lift them to a single context provider that
// owns one poll loop and one strategy fetch — no parallel polling, no
// drift between components.
//
// `/api/stats` is the canonical liveness probe: it returns 502 when HAProxy's
// stats socket isn't answering, which is exactly the condition we want to
// report. `info` is the parsed `show info` output (Pid, Uptime, Nbthread,
// MaxConn, etc.); `rows` is the parsed `show stat` table. Components that
// only care about "alive vs dead" read `alive`; components that show runtime
// numbers read `info`/`rows`.
//
// `/api/haproxy/control-strategy` is a one-shot fetch on mount — the strategy
// (s6 / systemd / direct) is detected at server startup and cached; it
// doesn't change at runtime.

const DEFAULT_POLL_MS = 5_000;

const HaproxyLiveContext = createContext(null);

const fetchStats = async setters => {
  try {
    const payload = await apiGet('api/stats');
    setters.setInfo(payload?.info ?? null);
    setters.setRows(payload?.stat ?? []);
    setters.setError(null);
  } catch (err) {
    setters.setError(err);
  } finally {
    setters.setLoaded(true);
  }
};

const fetchStrategy = async setters => {
  try {
    const payload = await apiGet('api/haproxy/control-strategy');
    setters.setStrategy(payload?.strategy ?? null);
  } catch {
    setters.setStrategy(null);
  }
};

export const HaproxyLiveProvider = ({ pollMs = DEFAULT_POLL_MS, children }) => {
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [strategy, setStrategy] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let active = true;
    const setters = {
      setInfo: v => active && setInfo(v),
      setRows: v => active && setRows(v),
      setError: v => active && setError(v),
      setStrategy: v => active && setStrategy(v),
      setLoaded: v => active && setLoaded(v),
    };
    fetchStats(setters);
    fetchStrategy(setters);
    const interval = setInterval(() => fetchStats(setters), pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollMs, version]);

  const value = useMemo(() => {
    // `alive` is tri-state: null until the first fetch resolves so the UI
    // can show "checking…" instead of falsely reporting "stopped". After
    // the first response it's a hard true/false.
    const alive = loaded ? !error && info !== null : null;
    return {
      info,
      rows,
      error,
      strategy,
      alive,
      loaded,
      statsReady: alive === true,
      refresh,
    };
  }, [info, rows, error, strategy, loaded, refresh]);

  return <HaproxyLiveContext.Provider value={value}>{children}</HaproxyLiveContext.Provider>;
};

HaproxyLiveProvider.propTypes = {
  pollMs: PropTypes.number,
  children: PropTypes.node.isRequired,
};

export const useHaproxyLive = () => {
  const ctx = useContext(HaproxyLiveContext);
  if (!ctx) {
    throw new Error('useHaproxyLive must be used inside a HaproxyLiveProvider');
  }
  return ctx;
};
