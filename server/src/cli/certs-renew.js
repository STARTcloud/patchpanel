import { openAudit } from '../lib/audit.js';
import { renewAllCerts } from '../lib/cert-renewal.js';
import configLoader from '../config/configLoader.js';
import * as logger from '../lib/logger.js';
import { loadState } from '../lib/state.js';

import { exitOnError, parseArgs } from './_args.js';

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
  });
  const config = configLoader.load(args.config);
  await openAudit(config.paths.audit).catch(err => {
    logger.warning('audit DB unavailable; renewal will run without recording', {
      error: err.message,
    });
  });

  const state = await loadState(config.paths.state);
  if (!state) {
    throw new Error(`state file not found at ${config.paths.state}`);
  }

  if (state.letsencrypt.skipRenewal) {
    logger.info('renewal skipped per state.letsencrypt.skipRenewal');
    return;
  }

  if (state.tls.certs.length === 0) {
    logger.info('no certs configured; nothing to renew');
    return;
  }

  await renewAllCerts(config, state, { actor: 'cron' });
};

main().catch(exitOnError);
