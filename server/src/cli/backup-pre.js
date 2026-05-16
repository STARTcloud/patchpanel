import Database from 'better-sqlite3';

import configLoader from '../config/configLoader.js';
import { fileExists } from '../lib/files.js';
import * as logger from '../lib/logger.js';

import { exitOnError } from './_args.js';

const main = async () => {
  const config = configLoader.load();
  if (!(await fileExists(config.paths.audit))) {
    logger.info('backup-pre: no audit DB found; nothing to checkpoint', {
      path: config.paths.audit,
    });
    return;
  }
  const db = new Database(config.paths.audit);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    logger.info('backup-pre: audit DB WAL checkpointed', { path: config.paths.audit });
  } finally {
    db.close();
  }
};

main().catch(exitOnError);
