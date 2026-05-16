export const VERSION = 1;

const MODERN = Object.freeze({
  enabledVersions: ['TLSv1.3'],
  ciphers: [],
  ciphersuites: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ],
  curves: ['X25519', 'prime256v1', 'secp384r1'],
  sigalgs: [],
  clientSigalgs: [],
  options: ['prefer-client-ciphers'],
});

const INTERMEDIATE = Object.freeze({
  enabledVersions: ['TLSv1.2', 'TLSv1.3'],
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'DHE-RSA-AES128-GCM-SHA256',
    'DHE-RSA-AES256-GCM-SHA384',
  ],
  ciphersuites: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ],
  curves: ['X25519', 'prime256v1', 'secp384r1'],
  sigalgs: [],
  clientSigalgs: [],
  options: ['no-tls-tickets'],
});

const OLD = Object.freeze({
  enabledVersions: ['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'],
  ciphers: [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
    'ECDHE-RSA-CHACHA20-POLY1305',
    'DHE-RSA-AES128-GCM-SHA256',
    'DHE-RSA-AES256-GCM-SHA384',
    'DHE-RSA-CHACHA20-POLY1305',
    'ECDHE-ECDSA-AES128-SHA256',
    'ECDHE-RSA-AES128-SHA256',
    'ECDHE-ECDSA-AES128-SHA',
    'ECDHE-RSA-AES128-SHA',
    'ECDHE-ECDSA-AES256-SHA384',
    'ECDHE-RSA-AES256-SHA384',
    'ECDHE-ECDSA-AES256-SHA',
    'ECDHE-RSA-AES256-SHA',
    'DHE-RSA-AES128-SHA256',
    'DHE-RSA-AES256-SHA256',
    'AES128-GCM-SHA256',
    'AES256-GCM-SHA384',
    'AES128-SHA256',
    'AES256-SHA256',
    'AES128-SHA',
    'AES256-SHA',
    'DES-CBC3-SHA',
  ],
  ciphersuites: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ],
  curves: ['X25519', 'prime256v1', 'secp384r1'],
  sigalgs: [],
  clientSigalgs: [],
  options: [],
});

export const MOZILLA_PROFILES = Object.freeze({
  modern: MODERN,
  intermediate: INTERMEDIATE,
  old: OLD,
});

export const PROFILE_NAMES = Object.freeze(['modern', 'intermediate', 'old', 'custom']);

const EMPTY_SIDE = Object.freeze({
  enabledVersions: [],
  ciphers: [],
  ciphersuites: [],
  curves: [],
  sigalgs: [],
  clientSigalgs: [],
  options: [],
});

const isPresetName = name => name === 'modern' || name === 'intermediate' || name === 'old';

const pickArray = (override, fallback) => (override === undefined ? [...fallback] : [...override]);

const mergeSide = (presetSide, overrideSide) => {
  if (!overrideSide) {
    return {
      enabledVersions: [...presetSide.enabledVersions],
      ciphers: [...presetSide.ciphers],
      ciphersuites: [...presetSide.ciphersuites],
      curves: [...presetSide.curves],
      sigalgs: [...presetSide.sigalgs],
      clientSigalgs: [...presetSide.clientSigalgs],
      options: [...presetSide.options],
    };
  }
  return {
    enabledVersions: pickArray(overrideSide.enabledVersions, presetSide.enabledVersions),
    ciphers: pickArray(overrideSide.ciphers, presetSide.ciphers),
    ciphersuites: pickArray(overrideSide.ciphersuites, presetSide.ciphersuites),
    curves: pickArray(overrideSide.curves, presetSide.curves),
    sigalgs: pickArray(overrideSide.sigalgs, presetSide.sigalgs),
    clientSigalgs: pickArray(overrideSide.clientSigalgs, presetSide.clientSigalgs),
    options: pickArray(overrideSide.options, presetSide.options),
  };
};

const pluckProfile = ssl => ssl?.profile ?? { name: 'custom', basedOnVersion: VERSION };
const pluckProfileName = ssl => ssl?.profile?.name ?? 'custom';
const pluckTune = ssl => ({ ...(ssl?.tune ?? {}) });

const pluckProviders = ssl => {
  const p = ssl?.providers;
  return {
    loaded: [...(p?.loaded ?? [])],
    defaultProperties: p?.defaultProperties ?? null,
  };
};

const pluckLoadExtraFiles = ssl => {
  const l = ssl?.loadExtraFiles;
  return {
    extraFiles: [...(l?.extraFiles ?? [])],
    deleteExtensions: l?.deleteExtensions ?? false,
  };
};

export const resolveSslConfig = ssl => {
  const profileName = pluckProfileName(ssl);
  const presetSide = isPresetName(profileName) ? MOZILLA_PROFILES[profileName] : EMPTY_SIDE;
  return {
    profile: pluckProfile(ssl),
    bind: mergeSide(presetSide, ssl?.bind),
    server: mergeSide(presetSide, ssl?.server),
    tune: pluckTune(ssl),
    providers: pluckProviders(ssl),
    loadExtraFiles: pluckLoadExtraFiles(ssl),
  };
};
