import { useCallback, useEffect, useState as useReactState } from 'react';

import { apiGet, apiPut } from '../api/client.js';

const DEFAULT_POLL_MS = 30_000;

export const useStateDoc = ({ pollMs = DEFAULT_POLL_MS } = {}) => {
  const [doc, setDoc] = useReactState(null);
  const [error, setError] = useReactState(null);
  const [loading, setLoading] = useReactState(true);
  const [saving, setSaving] = useReactState(false);

  const fetchOnce = useCallback(async () => {
    try {
      const fresh = await apiGet('api/state');
      setDoc(fresh);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [setDoc, setError, setLoading]);

  const reload = useCallback(async () => {
    setLoading(true);
    await fetchOnce();
  }, [fetchOnce, setLoading]);

  useEffect(() => {
    fetchOnce().catch(() => undefined);
    if (pollMs <= 0) {
      return undefined;
    }
    const interval = setInterval(() => {
      fetchOnce().catch(() => undefined);
    }, pollMs);
    return () => clearInterval(interval);
  }, [fetchOnce, pollMs]);

  const save = useCallback(
    async next => {
      setSaving(true);
      try {
        const persisted = await apiPut('api/state', next);
        setDoc(persisted);
        setError(null);
        return persisted;
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [setSaving, setDoc, setError]
  );

  return { doc, error, loading, saving, reload, save };
};
