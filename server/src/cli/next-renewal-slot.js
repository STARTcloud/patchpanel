import { nextRunEpochSeconds } from '../lib/cron.js';

import { exitOnError, parseArgs } from './_args.js';

const main = () => {
  const args = parseArgs(process.argv, {
    schedule: { type: 'string', default: '5 8 * * 1,4' },
  });
  const epoch = nextRunEpochSeconds(args.schedule);
  process.stdout.write(`${epoch}\n`);
};

try {
  main();
} catch (err) {
  exitOnError(err);
}
