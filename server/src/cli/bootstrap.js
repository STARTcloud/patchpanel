import { promises as fs } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';

import { buildCertsList, ensureCertsDirs } from '../lib/cert-lineage.js';
import configLoader from '../config/configLoader.js';
import { fileExists, readJson, writeAtomic } from '../lib/files.js';
import { validateRenderedCfg } from '../lib/haproxy-validate.js';
import * as logger from '../lib/logger.js';
import { renderHaproxyConfig } from '../lib/render.js';
import { initStateIfMissing, saveState } from '../lib/state.js';
import { emptyState } from '../lib/state-schema.js';

import { exitOnError, parseArgs } from './_args.js';

const HA_TO_HAPROXY_LOG_LEVEL = Object.freeze({
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  notice: 'notice',
  warning: 'warning',
  error: 'err',
  fatal: 'emerg',
});

const TIMEZONE_PATH = '/etc/localtime';
const ZONEINFO_BASE = '/usr/share/zoneinfo';

const applyTimezoneFromOptions = async opts => {
  const tz = opts?.timezone;
  if (!tz) {
    return;
  }
  const target = joinPath(ZONEINFO_BASE, tz);
  if (!(await fileExists(target))) {
    logger.warning('addon timezone not found in zoneinfo; skipping', { tz, target });
    return;
  }
  try {
    await fs.rm(TIMEZONE_PATH, { force: true });
    await fs.symlink(target, TIMEZONE_PATH);
    logger.info('timezone applied', { tz, target });
  } catch (err) {
    logger.warning('failed to apply timezone', { tz, error: err.message });
  }
};

const readAddonOptions = async config => {
  if (!config.paths.options) {
    return null;
  }
  if (!(await fileExists(config.paths.options))) {
    return null;
  }
  return readJson(config.paths.options).catch(() => null);
};

const SAFE_MINIMAL_CFG = `global
    log stdout format raw local0 info
    maxconn 4096
    stats socket /var/lib/haproxy/stats level admin mode 660 group haproxy expose-fd listeners

defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s

frontend http-in
    bind *:80
    http-request return status 503 content-type text/plain string "patchpanel: safe-mode (state.json renders invalid cfg; fix via Raw State tab)"
`;

const writeProviderCredentialsFromOptions = async (config, opts) => {
  if (!opts) {
    return;
  }
  await fs.mkdir(config.paths.credentials, { recursive: true, mode: 0o700 });

  if (opts.cloudflare_api_token) {
    const target = joinPath(config.paths.credentials, 'cloudflare.ini');
    const content = `dns_cloudflare_api_token = ${opts.cloudflare_api_token}\n`;
    await writeAtomic(target, content, { mode: 0o600 });
    logger.info('cloudflare credentials written from addon options', { path: target });
  }
};

const ensureDefaultCloudflareProvider = stateInput => {
  const hasCloudflare = stateInput.tls.providers.some(p => p.type === 'dns-cloudflare');
  if (hasCloudflare) {
    return stateInput;
  }
  return {
    ...stateInput,
    tls: {
      ...stateInput.tls,
      providers: [
        ...stateInput.tls.providers,
        {
          id: 'cloudflare',
          type: 'dns-cloudflare',
          credentialsRef: '/data/credentials/cloudflare.ini',
          options: {},
        },
      ],
    },
  };
};

const seedFromAddonOptions = async (config, baseState) => {
  if (!config.paths.options) {
    return baseState;
  }
  if (!(await fileExists(config.paths.options))) {
    return baseState;
  }
  const opts = await readJson(config.paths.options).catch(() => null);
  if (!opts) {
    return baseState;
  }

  await writeProviderCredentialsFromOptions(config, opts);

  let seeded = {
    ...baseState,
    letsencrypt: {
      ...baseState.letsencrypt,
      email: opts.email && opts.email.length > 0 ? opts.email : baseState.letsencrypt.email,
      staging: opts.staging ?? baseState.letsencrypt.staging,
      forceRenewal: opts.force_renewal ?? baseState.letsencrypt.forceRenewal,
      skipRenewal: opts.skip_renewal ?? baseState.letsencrypt.skipRenewal,
      defaultPropagationSeconds:
        opts.dns_propagation_seconds ?? baseState.letsencrypt.defaultPropagationSeconds,
    },
  };

  if (opts.log_level && HA_TO_HAPROXY_LOG_LEVEL[opts.log_level]) {
    seeded = {
      ...seeded,
      globalSettings: {
        ...seeded.globalSettings,
        logLevel: HA_TO_HAPROXY_LOG_LEVEL[opts.log_level],
      },
    };
  }

  return opts.cloudflare_api_token ? ensureDefaultCloudflareProvider(seeded) : seeded;
};

const refreshCredentialsOnly = async config => {
  if (!config.paths.options) {
    return;
  }
  if (!(await fileExists(config.paths.options))) {
    return;
  }
  const opts = await readJson(config.paths.options).catch(() => null);
  if (!opts) {
    return;
  }
  await writeProviderCredentialsFromOptions(config, opts);
};

const tryRender = (state, config, loadableCertCount) => {
  try {
    return renderHaproxyConfig(state, {
      certsListPath: config.paths.haproxyCertsList,
      trustedCasDir: config.paths.trustedCasDir,
      trustedCrlsDir: config.paths.trustedCrlsDir,
      loadableCertCount,
    });
  } catch (err) {
    logger.error('renderHaproxyConfig threw', { error: err.message, stack: err.stack });
    return null;
  }
};

const writeWithFallback = async (config, primary) => {
  if (primary) {
    const validation = await validateRenderedCfg(config.paths.haproxyBin, primary).catch(err => ({
      code: -1,
      stderr: `validateRenderedCfg threw: ${err.message}`,
    }));
    if (validation.code === 0) {
      await writeAtomic(config.paths.haproxyConfig, primary, { mode: 0o644 });
      logger.info('haproxy.cfg written', { path: config.paths.haproxyConfig });
      return;
    }
    logger.error('rendered haproxy.cfg failed validation', { stderr: validation.stderr.trim() });
  }

  await writeAtomic(config.paths.haproxyConfig, SAFE_MINIMAL_CFG, { mode: 0o644 }).catch(err => {
    logger.error('failed to write safe-minimal haproxy.cfg', { error: err.message });
  });
  logger.warning('wrote SAFE_MINIMAL haproxy.cfg so HAProxy can start; fix state via UI');
};

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
  });
  const config = configLoader.load(args.config);

  const opts = await readAddonOptions(config);
  await applyTimezoneFromOptions(opts);

  await ensureCertsDirs(config.paths);

  let state;
  let preservedInvalid = false;
  try {
    state = await initStateIfMissing(config.paths.state);
  } catch (err) {
    logger.error(
      'state.json failed schema validation; rendering with empty state in memory (file preserved on disk)',
      { error: err.message }
    );
    state = emptyState();
    preservedInvalid = true;
  }

  if (preservedInvalid) {
    await refreshCredentialsOnly(config);
  } else if (!state || state.meta.lastEditedBy === null) {
    const seeded = await seedFromAddonOptions(config, state ?? emptyState());
    state = await saveState(config.paths.state, seeded, { editor: 'bootstrap' });
  } else {
    await refreshCredentialsOnly(config);
  }

  await fs.mkdir(dirname(config.paths.haproxyCertsList), { recursive: true });
  let loadableCertCount = 0;
  try {
    const emitted = await buildCertsList(config.paths, state.tls.certs, state.tls.providers);
    loadableCertCount = emitted.length;
  } catch (err) {
    logger.error('buildCertsList threw; assuming zero loadable certs', { error: err.message });
  }

  const mapsDir = config.paths.haproxyMapsDir ?? '/etc/haproxy/maps';
  if ((state.maps ?? []).length > 0) {
    await fs.mkdir(mapsDir, { recursive: true });
    await Promise.all(
      state.maps.map(async map => {
        const body = map.entries.map(e => `${e.key} ${e.value}`).join('\n');
        const target = joinPath(mapsDir, `${map.name}.map`);
        await writeAtomic(target, body ? `${body}\n` : '', { mode: 0o644 }).catch(err =>
          logger.warning('failed to write map file at bootstrap', {
            name: map.name,
            error: err.message,
          })
        );
      })
    );
  }

  const primary = tryRender(state, config, loadableCertCount);
  await writeWithFallback(config, primary);
};

main().catch(exitOnError);
