import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { HaproxyError } from './errors.js';

const runHaproxyCheck = (haproxyBin, cfgPath) =>
  new Promise((resolve, reject) => {
    const outChunks = [];
    const errChunks = [];
    const child = spawn(haproxyBin, ['-c', '-f', cfgPath]);
    child.stdout.on('data', c => outChunks.push(c));
    child.stderr.on('data', c => errChunks.push(c));
    child.once('error', reject);
    child.once('close', code => {
      resolve({
        code,
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });

export const validateRenderedCfg = async (haproxyBin, rendered) => {
  const tmpDir = await mkdtemp(joinPath(tmpdir(), 'haproxy-validate-'));
  const tmpCfg = joinPath(tmpDir, 'haproxy.cfg');
  try {
    await writeFile(tmpCfg, rendered, { mode: 0o644 });
    const result = await runHaproxyCheck(haproxyBin, tmpCfg);
    return result;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
};

export const assertValidRenderedCfg = async (haproxyBin, rendered) => {
  const result = await validateRenderedCfg(haproxyBin, rendered);
  if (result.code !== 0) {
    throw new HaproxyError('haproxy.validate.failed', {
      message: `haproxy -c failed: code ${result.code}`,
      replacements: { code: result.code },
      output: result.stderr || result.stdout,
    });
  }
  return result;
};
