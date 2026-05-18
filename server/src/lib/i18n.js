import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import i18n from 'i18n';

import configLoader from '../config/configLoader.js';
import { log } from './logger.js';

// Backend i18n. Architecture is BoxVault's configAwareI18nMiddleware + a
// Cipher-style `t(key, locale, replacements)` helper for non-HTTP call
// sites. Locale resolution order on each request:
//   1. ?lang= query param
//   2. Accept-Language header
//   3. config.i18n.default_locale
//   4. 'en'
// `config.i18n.force_locale` (when set) overrides everything and pins all
// requests to a single locale; `config.i18n.auto_detect = false` falls
// straight through to the default without consulting the request.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, 'locales');

const getAvailableLocales = () => {
  if (!existsSync(localesDir)) {
    log.app.warn('i18n locales directory not found; defaulting to en-only', {
      localesDir,
    });
    return ['en'];
  }
  try {
    const found = readdirSync(localesDir)
      .filter(file => file.endsWith('.json'))
      .map(file => file.slice(0, -'.json'.length))
      .filter(locale => locale.length >= 2);
    if (found.length === 0) {
      log.app.warn('i18n locales directory empty; defaulting to en-only', { localesDir });
      return ['en'];
    }
    return found;
  } catch (err) {
    log.app.error('i18n locale scan failed; defaulting to en-only', { error: err.message });
    return ['en'];
  }
};

const availableLocales = getAvailableLocales();
const defaultLocale = availableLocales.includes('en') ? 'en' : availableLocales[0];

const buildFallbacks = () => {
  const fallbacks = {};
  for (const locale of availableLocales) {
    if (locale !== defaultLocale) {
      fallbacks[locale] = defaultLocale;
    }
  }
  return fallbacks;
};

i18n.configure({
  locales: availableLocales,
  defaultLocale,
  fallbacks: buildFallbacks(),
  directory: localesDir,
  objectNotation: true,
  updateFiles: false,
  syncFiles: false,
  autoReload: process.env.NODE_ENV === 'development',
  indent: '  ',
  extension: '.json',
  logDebugFn(msg) {
    if (process.env.NODE_ENV === 'development') {
      log.app.debug('i18n debug', { message: msg });
    }
  },
  logWarnFn(msg) {
    log.app.warn('i18n warn', { message: msg });
  },
  logErrorFn(msg) {
    log.app.error('i18n error', { message: msg });
  },
});

const readI18nConfig = () => {
  try {
    return configLoader.getConfig().i18n ?? {};
  } catch {
    return {};
  }
};

const matchLocale = requested => {
  if (!requested) {
    return defaultLocale;
  }
  const lowered = String(requested).toLowerCase();
  if (availableLocales.includes(lowered)) {
    return lowered;
  }
  const [prefix] = lowered.split('-');
  const prefixMatch = availableLocales.find(locale => locale.startsWith(prefix));
  return prefixMatch ?? defaultLocale;
};

const pickRequestLocale = req => {
  const cfg = readI18nConfig();
  if (cfg.force_locale) {
    return matchLocale(cfg.force_locale);
  }
  if (cfg.auto_detect === false) {
    return matchLocale(cfg.default_locale ?? defaultLocale);
  }
  // Auto-detect: ?lang= → Accept-Language → configured default → 'en'
  const queryLang = req.query?.lang;
  const headerLang = req.get?.('Accept-Language');
  let candidate = queryLang ?? headerLang ?? cfg.default_locale ?? defaultLocale;
  if (Array.isArray(candidate)) {
    [candidate] = candidate;
  }
  if (typeof candidate === 'string' && candidate.includes(',')) {
    [candidate] = candidate.split(',');
  }
  return matchLocale(candidate);
};

// Express middleware. Initialise i18n state on the request, then override
// the locale per our resolution order so config-driven force/auto behaviour
// applies regardless of what `i18n.init` decided.
const baseMiddleware = i18n.init;

export const i18nMiddleware = () => (req, res, next) => {
  baseMiddleware(req, res, () => {
    req.setLocale(pickRequestLocale(req));
    next();
  });
};

// Non-request helper: translate a key under an explicit locale. Saves and
// restores the global i18n locale so concurrent callers don't trample each
// other's setLocale state.
export const t = (key, locale = defaultLocale, replacements = {}) => {
  const previous = i18n.getLocale();
  i18n.setLocale(locale);
  const translated = i18n.__(key, replacements);
  i18n.setLocale(previous);
  return translated;
};

export const getSupportedLocales = () => [...availableLocales];
export const getDefaultLocale = () => defaultLocale;

log.app.info('i18n initialized', { availableLocales, defaultLocale });
