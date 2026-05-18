import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import configLoader from '../config/configLoader.js';
import { writeAtomic } from '../lib/files.js';
import { log } from '../lib/logger.js';
import { renderHaproxyConfig } from '../lib/render.js';
import { loadState } from '../lib/state.js';

import { exitOnError, parseArgs } from './_args.js';

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
    out: { type: 'string', default: null },
  });

  const config = configLoader.load(args.config);
  const state = await loadState(config.paths.state);
  if (!state) {
    throw new Error(`state file not found at ${config.paths.state}; run bootstrap first`);
  }

  const rendered = renderHaproxyConfig(state, {
    certsListPath: config.paths.haproxyCertsList,
    trustedCasDir: config.paths.trustedCasDir,
    trustedCrlsDir: config.paths.trustedCrlsDir,
  });

  if (args.out) {
    await fs.mkdir(dirname(args.out), { recursive: true });
    await writeAtomic(args.out, rendered, { mode: 0o644 });
    log.app.info('rendered haproxy.cfg written', { out: args.out });
  } else {
    process.stdout.write(rendered);
  }
};

main().catch(exitOnError);
