import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../api/client.js';

// Polls `/api/certificates` and turns the per-cert lineage info into a
// state-id keyed map that other pages (Routes, Dashboard, Topology) can use
// to distinguish three cert states:
//   - undefined  — cert id not present (the entry only lives in state, no
//                  on-disk lineage match yet — i.e. provisioned but not issued)
//   - isIssued false — a lineage exists but it's expired
//   - isIssued true  — there's at least one PEM on disk that's valid right now
//
// The Routes page CertCell uses this to flip the badge between "no cert"
// (state has nothing covering the hostname), "pending issuance" (state has
// an entry but no valid PEM), and "issued" (state has an entry and the PEM
// is loadable + not expired).

const DEFAULT_POLL_MS = 60_000;

const computeStatus = liveCert => {
  if (!liveCert?.newest?.notAfter) {
    return { isIssued: false, daysUntilExpiry: null, lineageDir: null, hasLineage: false };
  }
  const notAfterMs = new Date(liveCert.newest.notAfter).getTime();
  const nowMs = Date.now();
  const daysUntilExpiry = Math.round((notAfterMs - nowMs) / (24 * 60 * 60 * 1000));
  return {
    isIssued: notAfterMs > nowMs,
    daysUntilExpiry,
    lineageDir: liveCert.newest.lineageDir ?? null,
    hasLineage: true,
  };
};

export const useCertStatus = ({ pollMs = DEFAULT_POLL_MS } = {}) => {
  const [byId, setById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOnce = useCallback(() => {
    apiGet('api/certificates')
      .then(payload => {
        const next = {};
        for (const cert of payload?.certs ?? []) {
          next[cert.id] = computeStatus(cert);
        }
        setById(next);
        setError(null);
      })
      .catch(err => {
        setError(err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchOnce();
    if (pollMs <= 0) {
      return undefined;
    }
    const interval = setInterval(fetchOnce, pollMs);
    return () => clearInterval(interval);
  }, [fetchOnce, pollMs]);

  return { byId, loading, error, refresh: fetchOnce };
};
