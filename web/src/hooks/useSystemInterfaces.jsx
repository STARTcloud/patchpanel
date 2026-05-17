import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '../api/client.js';

// Fetch the host's network interfaces; expose a manual refresh callback
// for the BindAddressPicker's "reload" affordance. Interfaces don't change
// often so we don't poll — a stale list isn't dangerous, just slightly
// out-of-date.
//
// Server response shape (from /api/system/interfaces):
//   {
//     groups: [
//       { label: "This node's interfaces", addresses: [{ ip, interface, family, scope }] },
//       { label: "Container bridges",       addresses: [...] }
//     ],
//     filtered: <number>
//   }
//
// When showFiltered is true, the request appends `?showFiltered=1` and the
// server includes the dropped (veth/link-local/overlay) addresses as an
// extra group. The hook re-fetches whenever the flag flips so the operator
// gets fresh data on toggle.
//
// `loading` is derived rather than stored: we compare the current "fetch
// key" (a tuple of `version` + `showFiltered`) against the key of the last
// resolved fetch. As soon as the key changes (refresh() bumps version, or
// showFiltered toggles), the derivation flips to true; once the in-flight
// fetch resolves, the resolved key updates and it flips back to false. No
// setState in the effect body — only in the resolved-callback.
//
// Hook return shape:
//   { groups, filtered, loading, error, refresh }

const keyOf = (version, showFiltered) => `${version}:${showFiltered ? '1' : '0'}`;

export const useSystemInterfaces = ({ showFiltered = false } = {}) => {
  const [groups, setGroups] = useState([]);
  const [filtered, setFiltered] = useState(0);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const [resolvedKey, setResolvedKey] = useState(null);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    const myKey = keyOf(version, showFiltered);
    const url = showFiltered ? 'api/system/interfaces?showFiltered=1' : 'api/system/interfaces';
    apiGet(url)
      .then(payload => {
        if (cancelled) {
          return;
        }
        setGroups(payload?.groups ?? []);
        setFiltered(payload?.filtered ?? 0);
        setError(null);
        setResolvedKey(myKey);
      })
      .catch(err => {
        if (cancelled) {
          return;
        }
        setError(err);
        setResolvedKey(myKey);
      });
    return () => {
      cancelled = true;
    };
  }, [version, showFiltered]);

  const loading = resolvedKey !== keyOf(version, showFiltered);

  return { groups, filtered, loading, error, refresh };
};
