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

export const PROFILE_OPTIONS = Object.freeze([
  { value: 'modern', label: 'Modern (TLSv1.3 only)' },
  { value: 'intermediate', label: 'Intermediate (recommended)' },
  { value: 'old', label: 'Old (legacy clients)' },
  { value: 'custom', label: 'Custom (no preset)' },
]);

export const TLS_VERSIONS = Object.freeze(['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);

export const SIDE_FIELD_KEYS = Object.freeze([
  'enabledVersions',
  'ciphers',
  'ciphersuites',
  'curves',
  'sigalgs',
  'clientSigalgs',
  'options',
]);

const EMPTY_SIDE = Object.freeze({
  enabledVersions: [],
  ciphers: [],
  ciphersuites: [],
  curves: [],
  sigalgs: [],
  clientSigalgs: [],
  options: [],
});

export const presetSideFor = profileName => {
  if (profileName === 'modern' || profileName === 'intermediate' || profileName === 'old') {
    return MOZILLA_PROFILES[profileName];
  }
  return EMPTY_SIDE;
};

export const effectiveSideValue = (profileName, overrideSide, key) => {
  if (overrideSide && overrideSide[key] !== undefined) {
    return overrideSide[key];
  }
  return presetSideFor(profileName)[key] ?? [];
};

export const sideHasOverride = (overrideSide, key) =>
  Boolean(overrideSide && overrideSide[key] !== undefined);

export const countOverrides = overrideSide => {
  if (!overrideSide) {
    return 0;
  }
  let count = 0;
  for (const key of SIDE_FIELD_KEYS) {
    if (overrideSide[key] !== undefined) {
      count += 1;
    }
  }
  return count;
};
