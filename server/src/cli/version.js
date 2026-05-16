import { promises as fs } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exitOnError } from './_args.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = joinPath(here, '..', '..', 'package.json');

const main = async () => {
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const pkg = JSON.parse(raw);
  process.stdout.write(`${pkg.version}\n`);
};

main().catch(exitOnError);
