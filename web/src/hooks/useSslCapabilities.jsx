import { useEffect, useState } from 'react';

import { apiGet } from '../api/client.js';

export const useSslCapabilities = () => {
  const [caps, setCaps] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    apiGet('api/haproxy/ssl-capabilities')
      .then(payload => {
        if (active) {
          setCaps(payload);
          setError(null);
        }
      })
      .catch(err => {
        if (active) {
          setError(err);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return { caps, loading, error };
};
