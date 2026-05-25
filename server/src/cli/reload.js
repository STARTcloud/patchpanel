import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import configLoader from '../config/configLoader.js';
import { HaproxyError } from '../lib/errors.js';
import { writeAtomic } from '../lib/files.js';
import * as haproxyControl from '../lib/haproxy-control.js';
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

  const tmpDir = await mkdtemp(joinPath(tmpdir(), 'haproxy-reload-'));
  const tmpCfg = joinPath(tmpDir, 'haproxy.cfg');
  try {
    await writeFile(tmpCfg, rendered, { mode: 0o644 });
    const check = await runHaproxyCheck(config.paths.haproxyBin, tmpCfg);
    if (check.code !== 0) {
      throw new HaproxyError(
        `refusing to reload; new config failed validation`,
        check.stderr || check.stdout
      );
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  await writeAtomic(config.paths.haproxyConfig, rendered, { mode: 0o644 });
  log.app.info('haproxy.cfg updated', { path: config.paths.haproxyConfig });

  const output = await haproxyControl.reload(config);
  log.app.info('haproxy reloaded', {
    method: config.haproxy?.reload?.method ?? 'master-socket',
    output: typeof output === 'string' ? output.trim().slice(0, 200) : null,
  });
};

main().catch(exitOnError);
