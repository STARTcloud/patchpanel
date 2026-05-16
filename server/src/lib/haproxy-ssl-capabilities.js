import { spawn } from 'node:child_process';

const DEFAULT_OPENSSL_BIN = 'openssl';

const run = (bin, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args);
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', c => stdoutChunks.push(c));
    child.stderr.on('data', c => stderrChunks.push(c));
    child.once('error', reject);
    child.once('close', code => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        reject(
          new Error(
            `${bin} ${args.join(' ')} exited with code ${code}: ${stderr.trim() || stdout.trim()}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });

const CIPHER_LINE_RE =
  /^\s*(?<hexId>0x[0-9A-Fa-f]+,0x[0-9A-Fa-f]+)\s+-\s+(?<name>\S+)\s+(?<tlsVersion>\S+)\s+Kx=(?<kx>\S+)\s+Au=(?<au>\S+)\s+Enc=(?<enc>\S+)\s+Mac=(?<mac>\S+)/u;

export const parseOpensslCiphers = stdout => {
  const ciphers = [];
  for (const raw of stdout.split('\n')) {
    const match = raw.match(CIPHER_LINE_RE);
    if (!match) {
      continue;
    }
    ciphers.push({
      hexId: match.groups.hexId,
      name: match.groups.name,
      tlsVersion: match.groups.tlsVersion,
      kx: match.groups.kx,
      au: match.groups.au,
      enc: match.groups.enc,
      mac: match.groups.mac,
    });
  }
  return ciphers;
};

const stripComment = line => line.replace(/#.*$/u, '').trim();

export const parseOpensslGroups = stdout => {
  const out = [];
  for (const raw of stdout.split('\n')) {
    const cleaned = stripComment(raw);
    if (cleaned.length === 0) {
      continue;
    }
    const parts = cleaned
      .split(':')
      .map(p => p.trim())
      .filter(Boolean);
    out.push(...parts);
  }
  return [...new Set(out)];
};

export const parseOpensslSigalgs = stdout => {
  const out = [];
  for (const raw of stdout.split('\n')) {
    const cleaned = stripComment(raw);
    if (cleaned.length === 0) {
      continue;
    }
    if (cleaned.endsWith(':')) {
      continue;
    }
    const parts = cleaned
      .split(':')
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      out.push(...parts);
    }
  }
  return [...new Set(out)];
};

const VERSION_RE = /^HAProxy version\s+(?<version>\S+)/mu;
const OPENSSL_BUILT_RE = /^Built with SSL library version\s*:\s*(?<openssl>.+)$/mu;
const OPENSSL_RUNNING_RE = /^Running on SSL library version\s*:\s*(?<openssl>.+)$/mu;
const TLS_VERSIONS_RE = /^SSL library supports\s*:\s*(?<versions>.+)$/mu;
const PROVIDERS_RE = /^OpenSSL providers loaded\s*:\s*(?<providers>.+)$/mu;
const FEATURES_RE = /^Feature list\s*:\s*(?<features>.+)$/mu;

export const parseHaproxyVv = stdout => {
  const result = {
    version: null,
    opensslBuilt: null,
    opensslRunning: null,
    tlsVersionsSupported: [],
    providersLoaded: [],
    features: [],
  };
  const versionMatch = stdout.match(VERSION_RE);
  if (versionMatch) {
    result.version = versionMatch.groups.version;
  }
  const builtMatch = stdout.match(OPENSSL_BUILT_RE);
  if (builtMatch) {
    result.opensslBuilt = builtMatch.groups.openssl.trim();
  }
  const runningMatch = stdout.match(OPENSSL_RUNNING_RE);
  if (runningMatch) {
    result.opensslRunning = runningMatch.groups.openssl.trim();
  }
  const tlsVersionsMatch = stdout.match(TLS_VERSIONS_RE);
  if (tlsVersionsMatch) {
    result.tlsVersionsSupported = tlsVersionsMatch.groups.versions
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
  }
  const providersMatch = stdout.match(PROVIDERS_RE);
  if (providersMatch) {
    result.providersLoaded = providersMatch.groups.providers
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean);
  }
  const featuresMatch = stdout.match(FEATURES_RE);
  if (featuresMatch) {
    result.features = featuresMatch.groups.features
      .trim()
      .split(/\s+/u)
      .filter(t => t.startsWith('+') || t.startsWith('-'));
  }
  return result;
};

const safeRun = async (bin, args) => {
  try {
    return await run(bin, args);
  } catch (err) {
    return { error: err.message };
  }
};

const settled = value => (typeof value === 'string' ? value : '');
const errorOf = value => (typeof value === 'string' ? null : value.error);

export const fetchSslCapabilities = async ({
  haproxyBin = 'haproxy',
  opensslBin = DEFAULT_OPENSSL_BIN,
} = {}) => {
  const [ciphersOut, groupsOut, sigalgsOut, haproxyVvOut] = await Promise.all([
    safeRun(opensslBin, ['ciphers', '-V', '-s', 'ALL:eNULL']),
    safeRun(opensslBin, ['list', '-tls-groups']),
    safeRun(opensslBin, ['list', '-signature-algorithms']),
    safeRun(haproxyBin, ['-vv']),
  ]);

  const allCiphers = parseOpensslCiphers(settled(ciphersOut));
  const ciphersuites = allCiphers.filter(c => c.tlsVersion === 'TLSv1.3');
  const ciphers = allCiphers.filter(c => c.tlsVersion !== 'TLSv1.3');

  return {
    haproxy: parseHaproxyVv(settled(haproxyVvOut)),
    ciphers,
    ciphersuites,
    curves: parseOpensslGroups(settled(groupsOut)),
    sigalgs: parseOpensslSigalgs(settled(sigalgsOut)),
    errors: {
      ciphers: errorOf(ciphersOut),
      groups: errorOf(groupsOut),
      sigalgs: errorOf(sigalgsOut),
      haproxy: errorOf(haproxyVvOut),
    },
  };
};
