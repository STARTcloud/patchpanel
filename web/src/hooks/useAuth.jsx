import PropTypes from 'prop-types';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { apiGet, apiPost } from '../api/client.js';

// AuthProvider/useAuth — single source of truth for the SPA's auth state.
//
// On mount, calls GET /api/auth/whoami which returns one of:
//   { authenticated: false }
//   { authenticated: true, source: 'ingress' | 'session' | 'token', user: {...} }
//
// `source` matters to the UI:
//   - ingress  → no login UI, no logout button (HA addon mode; user is
//                already authenticated upstream).
//   - session  → show profile/logout; login route reachable.
//   - token    → the SPA shouldn't normally see this (tokens are for
//                scripts), but handle it gracefully.

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
};

export const AuthProvider = ({ children }) => {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    user: null,
    source: null,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet('api/auth/whoami');
      setState({
        loading: false,
        authenticated: Boolean(data?.authenticated),
        user: data?.user ?? null,
        source: data?.source ?? null,
      });
      return data;
    } catch {
      setState({ loading: false, authenticated: false, user: null, source: null });
      return null;
    }
  }, []);

  // Initial whoami probe. Inlined (rather than calling refresh()) so the
  // lint rule react-hooks/set-state-in-effect can see that setState only
  // happens inside the .then/.catch callback, not synchronously in the
  // effect body. refresh remains exported for login/logout/setup pages.
  useEffect(() => {
    let cancelled = false;
    apiGet('api/auth/whoami')
      .then(data => {
        if (cancelled) {
          return;
        }
        setState({
          loading: false,
          authenticated: Boolean(data?.authenticated),
          user: data?.user ?? null,
          source: data?.source ?? null,
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setState({ loading: false, authenticated: false, user: null, source: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiPost('api/auth/login', { username, password });
    setState({
      loading: false,
      authenticated: true,
      user: data.user,
      source: 'session',
    });
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiPost('api/auth/logout');
    } finally {
      setState({ loading: false, authenticated: false, user: null, source: null });
    }
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { apiPut } = await import('../api/client.js');
    return apiPut('api/auth/change-password', { currentPassword, newPassword });
  }, []);

  const value = {
    ...state,
    refresh,
    login,
    logout,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
