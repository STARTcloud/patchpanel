import configLoader from '../config/configLoader.js';
import * as logger from '../lib/logger.js';

import { exitOnError } from './_args.js';

const main = () => {
  const config = configLoader.load();
  logger.info('backup-post: nothing to do (audit DB stays open in long-running server)', {
    audit: config.paths.audit,
  });
};

try {
  main();
} catch (err) {
  exitOnError(err);
}
