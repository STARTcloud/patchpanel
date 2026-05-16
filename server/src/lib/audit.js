import { dirname } from 'node:path';

import Database from 'better-sqlite3';

import { ensureDir } from './files.js';
import * as logger from './logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  outcome TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts);
CREATE INDEX IF NOT EXISTS audit_log_category_idx ON audit_log(category);
`;

let dbInstance = null;
let dbPath = null;

export const openAudit = async path => {
  if (dbInstance && dbPath === path) {
    return dbInstance;
  }
  await ensureDir(dirname(path));
  dbInstance = new Database(path);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.exec(SCHEMA);
  dbPath = path;
  logger.debug('audit log opened', { path });
  return dbInstance;
};

export const closeAudit = () => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPath = null;
  }
};

export const record = entry => {
  if (!dbInstance) {
    return;
  }
  const stmt = dbInstance.prepare(
    `INSERT INTO audit_log (ts, actor, category, action, target, details, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    new Date().toISOString(),
    entry.actor ?? null,
    entry.category,
    entry.action,
    entry.target ?? null,
    entry.details ? JSON.stringify(entry.details) : null,
    entry.outcome ?? 'ok'
  );
};

export const recent = (limit = 100, filter = {}) => {
  if (!dbInstance) {
    throw new Error('audit log not opened; call openAudit() first');
  }
  const where = [];
  const params = [];
  if (filter.category) {
    where.push('category = ?');
    params.push(filter.category);
  }
  if (filter.actor) {
    where.push('actor = ?');
    params.push(filter.actor);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const stmt = dbInstance.prepare(
    `SELECT id, ts, actor, category, action, target, details, outcome
     FROM audit_log ${clause}
     ORDER BY id DESC
     LIMIT ?`
  );
  params.push(limit);
  return stmt.all(...params).map(row => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null,
  }));
};
