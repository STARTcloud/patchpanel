import { useCallback, useState } from 'react';

import { apiPost } from '../api/client.js';

export const useActions = () => {
  const [busy, setBusy] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  const runAction = useCallback(async (kind, path, body) => {
    setBusy(kind);
    setError(null);
    setLastResult(null);
    try {
      const result = await apiPost(path, body);
      setLastResult({ kind, ...result });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  const renewCerts = useCallback(
    ({ force = false } = {}) => runAction('renew', 'api/certificates/renew', { force }),
    [runAction]
  );

  const renewCert = useCallback(
    ({ certId, force = false } = {}) =>
      runAction(`renew-${certId}`, `api/certificates/${certId}/renew`, { force }),
    [runAction]
  );

  const reloadHaproxy = useCallback(() => runAction('reload', 'api/haproxy/reload'), [runAction]);

  const stopHaproxy = useCallback(
    () => runAction('stop', 'api/haproxy/stop', { confirm: true }),
    [runAction]
  );

  const startHaproxy = useCallback(() => runAction('start', 'api/haproxy/start'), [runAction]);

  const setServerState = useCallback(
    ({ backend, server, state }) =>
      runAction(
        `server-${backend}-${server}`,
        `api/haproxy/servers/${encodeURIComponent(backend)}/${encodeURIComponent(server)}/state`,
        { state }
      ),
    [runAction]
  );

  const setServerWeight = useCallback(
    ({ backend, server, weight }) =>
      runAction(
        `weight-${backend}-${server}`,
        `api/haproxy/servers/${encodeURIComponent(backend)}/${encodeURIComponent(server)}/weight`,
        { weight }
      ),
    [runAction]
  );

  const enableFrontend = useCallback(
    ({ name }) =>
      runAction(`fe-enable-${name}`, `api/runtime/frontends/${encodeURIComponent(name)}/enable`),
    [runAction]
  );

  const disableFrontend = useCallback(
    ({ name }) =>
      runAction(`fe-disable-${name}`, `api/runtime/frontends/${encodeURIComponent(name)}/disable`),
    [runAction]
  );

  const setMaxconnFrontend = useCallback(
    ({ name, max }) =>
      runAction(`fe-maxconn-${name}`, `api/runtime/maxconn/frontend/${encodeURIComponent(name)}`, {
        max,
      }),
    [runAction]
  );

  const clearCounters = useCallback(
    () => runAction('clear-counters', 'api/runtime/counters/clear'),
    [runAction]
  );

  const clear = useCallback(() => {
    setLastResult(null);
    setError(null);
  }, []);

  return {
    busy,
    lastResult,
    error,
    renewCerts,
    renewCert,
    reloadHaproxy,
    stopHaproxy,
    startHaproxy,
    setServerState,
    setServerWeight,
    enableFrontend,
    disableFrontend,
    setMaxconnFrontend,
    clearCounters,
    clear,
  };
};
