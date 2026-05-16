import { spawn } from 'node:child_process';

import { CertbotError } from './errors.js';
import * as logger from './logger.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const CA_DIRECTORY_URLS = Object.freeze({
  letsencrypt: 'https://acme-v02.api.letsencrypt.org/directory',
  'letsencrypt-staging': 'https://acme-staging-v02.api.letsencrypt.org/directory',
  zerossl: 'https://acme.zerossl.com/v2/DV90',
  buypass: 'https://api.buypass.com/acme/directory',
  google: 'https://dv.acme-v02.api.pki.goog/directory',
});

const resolveDirectoryUrl = account => {
  if (account.server === 'custom') {
    if (!account.directoryUrl) {
      throw new CertbotError(`ACME account ${account.id} has server "custom" but no directoryUrl`);
    }
    return account.directoryUrl;
  }
  const url = CA_DIRECTORY_URLS[account.server];
  if (!url) {
    throw new CertbotError(`ACME account ${account.id} has unknown server "${account.server}"`);
  }
  return url;
};

const runProcess = (bin, args, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrChunks.push(chunk);
    });
    child.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      resolve({ code, stdout, stderr });
    });
  });

const buildChallengeArgs = (provider, propagationSeconds) => {
  const credentials = provider.credentialsRef
    ? [`--${provider.type}-credentials`, provider.credentialsRef]
    : [];
  switch (provider.type) {
    case 'dns-cloudflare':
    case 'dns-route53':
    case 'dns-google':
    case 'dns-digitalocean':
    case 'dns-ovh':
    case 'dns-rfc2136':
    case 'dns-multi':
      return [
        `--${provider.type}`,
        ...credentials,
        `--${provider.type}-propagation-seconds`,
        String(propagationSeconds),
      ];
    case 'http-01':
      return [
        '--webroot',
        '--webroot-path',
        provider.options?.webrootPath ?? '/var/lib/letsencrypt',
      ];
    case 'byo':
      throw new CertbotError('BYO certificates do not use certbot');
    default:
      throw new CertbotError(`unknown TLS provider type: ${provider.type}`);
  }
};

// v0.2.41 — Wire the v0.2.37 typed provider options through to the certbot
// invocation where the underlying plugin accepts the option via env or CLI.
// (Most certbot-dns plugins read their auxiliary options from the .ini
// credentials file, NOT the CLI — endpoint for OVH, server/key for RFC 2136,
// provider for dns-multi all live in the .ini. The UI help text on those
// kinds documents this expectation. Route 53 is the one outlier: AWS region
// is read from the AWS_REGION env var by boto3.)
const buildChallengeEnv = provider => {
  if (provider.type === 'dns-route53' && provider.options?.awsRegion) {
    return { AWS_REGION: provider.options.awsRegion };
  }
  return {};
};

export const renewCert = async ({
  certbotBin,
  cert,
  provider,
  account,
  forceRenewal,
  propagationSeconds,
  letsencryptDir,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) => {
  const directoryUrl = resolveDirectoryUrl(account);
  const args = [
    'certonly',
    '-n',
    '--text',
    '--agree-tos',
    '--keep-until-expiring',
    '--config-dir',
    letsencryptDir,
    '--cert-name',
    cert.certName,
    '--key-type',
    cert.keyType,
    '--server',
    directoryUrl,
    '--email',
    account.email,
    ...buildChallengeArgs(provider, propagationSeconds),
  ];

  if (account.eabKid && account.eabHmacKey) {
    args.push('--eab-kid', account.eabKid, '--eab-hmac-key', account.eabHmacKey);
  }

  if (cert.keyType === 'rsa' && cert.rsaKeySize) {
    args.push('--rsa-key-size', String(cert.rsaKeySize));
  }

  if (cert.expanding) {
    args.push('--expand');
  }

  if (forceRenewal) {
    args.push('--force-renewal');
  }

  for (const domain of cert.domains) {
    args.push('-d', domain);
  }

  const env = buildChallengeEnv(provider);
  logger.info('starting certbot', {
    certName: cert.certName,
    providerType: provider.type,
    acmeAccountId: account.id,
    acmeServer: account.server,
    envOverrides: Object.keys(env),
  });
  const { code, stdout, stderr } = await runProcess(certbotBin, args, env, timeoutMs);
  if (code !== 0) {
    throw new CertbotError(`certbot exited with code ${code}`, {
      exitCode: code,
      output: stderr || stdout,
    });
  }
  return { code, stdout, stderr };
};

export const listCertificates = async certbotBin => {
  const { code, stdout, stderr } = await runProcess(
    certbotBin,
    ['certificates'],
    {},
    DEFAULT_TIMEOUT_MS
  );
  if (code !== 0) {
    throw new CertbotError(`certbot certificates exited with code ${code}`, {
      exitCode: code,
      output: stderr || stdout,
    });
  }
  return stdout;
};
