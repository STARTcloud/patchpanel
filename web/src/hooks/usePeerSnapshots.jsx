import { useEffect, useState } from 'react';

import { apiGet } from '../api/client.js';

// Polls the local-side aggregator `GET /api/peers/snapshots` and exposes
// the per-peer snapshot list. The aggregator fans out to each paired
// peer using stored outbound tokens — the browser only ever talks to
// the local node, so peer tokens never leave the server.
//
// Shape returned to consumers:
//   { peers: [{ peerId, name, url, ok, snapshot, error?, status? }], ts, loading, error }
//
// Each `snapshot` (when ok) carries:
//   { ts, node: { nodeId, vrrp }, haproxy: { ok, alive, info? }, keepalived: { ok, installed, alive, instances } }
//
// Polls at DEFAULT_POLL_MS. Failures keep the last-known snapshot
// returned so the UI doesn't blank out when one poll hiccups; only the
// top-level `error` reflects the most recent poll outcome.

const DEFAULT_POLL_MS = 5_000;

export const usePeerSnapshots = ({ pollMs = DEFAULT_POLL_MS } = {}) => {
  const [peers, setPeers] = useState([]);
  const [ts, setTs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const fetchOnce = async () => {
      try {
        const payload = await apiGet('api/peers/snapshots');
        if (!active) {
          return;
        }
        setPeers(payload?.peers ?? []);
        setTs(payload?.ts ?? null);
        setError(null);
      } catch (err) {
        if (active) {
          setError(err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    fetchOnce();
    const interval = setInterval(fetchOnce, pollMs);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pollMs]);

  return { peers, ts, loading, error };
};
