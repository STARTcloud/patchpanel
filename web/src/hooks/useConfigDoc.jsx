import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiPost, apiPut } from '../api/client.js';

// Settings-page counterpart to useStateDoc. Loads /api/config once on mount
// (no polling — config.yaml changes only when an admin saves), exposes a
// `save(patch)` that PUTs a flat {path: value} map and refetches, and a
// `restart()` that POSTs /api/config/restart so systemd / the HA addon
// supervisor brings the process back with the new config loaded.

export const useConfigDoc = () => {
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet('api/config')
      .then(payload => {
        if (cancelled) {
          return;
        }
        setRaw(payload);
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) {
          return;
        }
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async patch => {
    setSaving(true);
    try {
      await apiPut('api/config', { patch });
      // Refetch the raw tree so the form reflects what's now on disk.
      const fresh = await apiGet('api/config');
      setRaw(fresh);
      setError(null);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const restart = useCallback(async () => {
    await apiPost('api/config/restart');
  }, []);

  return { raw, loading, error, saving, save, restart };
};
