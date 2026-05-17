import { stdin as input } from 'node:process';
import { createInterface } from 'node:readline/promises';

import configLoader from '../config/configLoader.js';
import { forceResetPassword } from '../lib/users.js';

import { exitOnError, parseArgs } from './_args.js';

// `patchpanel user-reset` — out-of-band password reset for an existing
// user. Used when an admin forgets their password and there's no second
// admin to do it via the UI. Skips the currentPassword check on purpose:
// having shell access on the host is the out-of-band proof of authority.
//
// Usage:
//   patchpanel user-reset --username admin
//   (then type new password at the prompt)
//
// Bumps passwordChangedAt, which invalidates every existing session JWT
// on the next request.

const promptPassword = async () => {
  const rl = createInterface({ input, output: process.stderr, terminal: true });
  process.stderr.write('New password: ');
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
  const user = await forceResetPassword(config.paths.users, args.username, password, {
    bcryptRounds: config.security?.bcryptRounds ?? 12,
  });

  process.stdout.write(`${JSON.stringify(user, null, 2)}\n`);
  process.stderr.write('Password reset. All existing sessions for this user are now invalid.\n');
};

main().catch(exitOnError);
