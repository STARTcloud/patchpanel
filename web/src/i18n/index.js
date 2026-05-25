import { createInstance } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import { initReactI18next } from 'react-i18next';

import { buildUrl } from '../api/client.js';
import { log } from '../utils/Logger.js';

// i18next instance for the patchpanel SPA. Resolution order:
//   1. ?lang= via LanguageDetector (querystring)
//   2. localStorage (caches the user's manual switch)
//   3. navigator (browser preferred lang)
// Falls back to the server's default locale, which is fetched once from
// /api/i18n/languages so the SPA only offers languages the server has
// translation files for. Namespaces mirror the server's en.json sections
// — load on demand from /locales/{lng}/{ns}.json.

const NAMESPACES = Object.freeze([
  'common',
  'auth',
  'api',
  'validation',
  'cluster',
  'cert',
  'config',
  'state',
  'lua',
  'haproxy',
  'runtime',
  'stats',
  'logs',
  'notify',
  'geoip',
]);

// Static config — bound at module load so getI18n() returns a usable instance
// from the first React render. Dynamic config (supportedLngs, loadPath) is
// applied in init() below once the server reports which languages exist.
const i18n = createInstance({
  fallbackLng: 'en',
  ns: NAMESPACES,
  defaultNS: 'common',
  load: 'languageOnly',
  debug: import.meta.env.DEV,
  detection: {
    order: ['querystring', 'localStorage', 'navigator'],
    lookupQuerystring: 'lang',
    lookupLocalStorage: 'i18nextLng',
    caches: ['localStorage'],
  },
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: true,
  },
});

// Register plugins synchronously to avoid NO_I18NEXT_INSTANCE during the
// first React render. The plugins themselves don't fire until i18n.init()
// resolves, but `getI18n()` returns this bound instance immediately.
i18n.use(HttpBackend).use(LanguageDetector).use(initReactI18next);

const fetchSupportedLanguages = async () => {
  try {
    const response = await fetch(buildUrl('api/i18n/languages'), { credentials: 'same-origin' });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.languages) && data.languages.length > 0) {
        return {
          languages: data.languages,
          defaultLanguage: data.defaultLanguage ?? data.languages[0],
        };
      }
    }
  } catch (error) {
    log.app.warn('i18n languages fetch failed; falling back to en-only', {
      error: error?.message,
    });
  }
  return { languages: ['en'], defaultLanguage: 'en' };
};

export const i18nPromise = (async () => {
  const { languages, defaultLanguage } = await fetchSupportedLanguages();

  await i18n.init({
    fallbackLng: defaultLanguage,
    supportedLngs: languages,
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
  });

  log.app.info('i18n initialized', { languages, defaultLanguage });
  return { languages, defaultLanguage };
})();

export const getSupportedLanguages = () => i18n.options?.supportedLngs || ['en'];

export default i18n;
