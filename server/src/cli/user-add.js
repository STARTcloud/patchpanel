import { stdin as input } from 'node:process';
import { createInterface } from 'node:readline/promises';

import configLoader from '../config/configLoader.js';
import { createUser } from '../lib/users.js';

import { exitOnError, parseArgs } from './_args.js';

// `patchpanel user-add` — out-of-band admin creation. Useful when the
// first-run wizard hasn't been completed (e.g. headless deployment with no
// browser handy) or when the operator is locked out and needs a second
// admin account.
//
// Reads the password from stdin so it doesn't leak into shell history.
// Usage:
//   patchpanel user-add --username admin
//   (then type password at the prompt)
//
// Or non-interactively (pipe-friendly, password on stdin one line):
//   echo -n 'mypassword' | patchpanel user-add --username admin --stdin-password

const promptPassword = async () => {
  const rl = createInterface({ input, output: process.stderr, terminal: true });
  process.stderr.write('Password: ');
  const password = await rl.question('');
  rl.close();
  return password.trim();
};

const readStdinPassword = () =>
  new Promise((resolve, reject) => {
    let buf = '';
    input.setEncoding('utf8');
    input.on('data', chunk => {
      buf += chunk;
    });
    input.on('end', () => resolve(buf.trim()));
    input.on('error', reject);
  });

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
    username: { type: 'string', default: null },
    'stdin-password': { type: 'boolean', default: false },
  });

  if (!args.username) {
    throw new Error('--username is required');
  }

  const password = args['stdin-password'] ? await readStdinPassword() : await promptPassword();
  if (!password) {
    throw new Error('password must be non-empty');
  }

  const config = configLoader.load(args.config);
  const user = await createUser(
    config.paths.users,
    { username: args.username, password, role: 'admin' },
    { bcryptRounds: config.security?.bcryptRounds ?? 12 }
  );

  process.stdout.write(`${JSON.stringify(user, null, 2)}\n`);
};

main().catch(exitOnError);
