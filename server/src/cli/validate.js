import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import configLoader from '../config/configLoader.js';
import { HaproxyError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { renderHaproxyConfig } from '../lib/render.js';
import { loadState } from '../lib/state.js';

import { exitOnError, parseArgs } from './_args.js';

const runHaproxyCheck = (haproxyBin, cfgPath) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const errs = [];
    const child = spawn(haproxyBin, ['-c', '-f', cfgPath]);
    child.stdout.on('data', c => chunks.push(c));
    child.stderr.on('data', c => errs.push(c));
    child.once('error', reject);
    child.once('close', code => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errs).toString('utf8');
      resolve({ code, stdout, stderr });
    });
  });

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
  });
  const config = configLoader.load(args.config);
  const state = await loadState(config.paths.state);
  if (!state) {
    throw new Error(`state file not found at ${config.paths.state}`);
  }
  const rendered = renderHaproxyConfig(state, {
    certsListPath: config.paths.haproxyCertsList,
    trustedCasDir: config.paths.trustedCasDir,
    trustedCrlsDir: config.paths.trustedCrlsDir,
  });

  const tmpDir = await mkdtemp(joinPath(tmpdir(), 'patchpanel-validate-'));
  const tmpCfg = joinPath(tmpDir, 'haproxy.cfg');
  try {
    await writeFile(tmpCfg, rendered, { mode: 0o644 });
    const result = await runHaproxyCheck(config.paths.haproxyBin, tmpCfg);
    if (result.code !== 0) {
      throw new HaproxyError(
        `haproxy -c failed with code ${result.code}`,
        result.stderr || result.stdout
      );
    }
    log.app.info('haproxy.cfg validated', { bytes: rendered.length });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
};

main().catch(exitOnError);
