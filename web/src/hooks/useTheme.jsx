import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';
const STORAGE_KEY = 'patchpanel.theme';
const VALID_PREFERENCES = Object.freeze(['auto', 'light', 'dark']);

const detectOSTheme = () =>
  typeof window !== 'undefined' && window.matchMedia(QUERY).matches ? 'dark' : 'light';

const readStoredPreference = () => {
  if (typeof localStorage === 'undefined') {
    return 'auto';
  }
  const value = localStorage.getItem(STORAGE_KEY);
  return VALID_PREFERENCES.includes(value) ? value : 'auto';
};

const writeStoredPreference = value => {
  if (typeof localStorage === 'undefined') {
    return;
  }
  if (value === 'auto') {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, value);
  }
};

const applyAttribute = theme => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute('data-bs-theme', theme);
};

export const useTheme = () => {
  const [preference, setPreferenceState] = useState(readStoredPreference);
  const [systemTheme, setSystemTheme] = useState(detectOSTheme);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const mql = window.matchMedia(QUERY);
    const handler = event => setSystemTheme(event.matches ? 'dark' : 'light');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const effective = preference === 'auto' ? systemTheme : preference;

  useEffect(() => {
    applyAttribute(effective);
  }, [effective]);

  const setPreference = next => {
    if (!VALID_PREFERENCES.includes(next)) {
      return;
    }
    writeStoredPreference(next);
    setPreferenceState(next);
  };

  const cyclePreference = () => {
    const idx = VALID_PREFERENCES.indexOf(preference);
    const nextIdx = (idx + 1) % VALID_PREFERENCES.length;
    setPreference(VALID_PREFERENCES[nextIdx]);
  };

  return { preference, effective, systemTheme, setPreference, cyclePreference };
};
