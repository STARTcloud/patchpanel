import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';

import { ensureDir, fileExists, readJson, writeAtomic } from './files.js';
import * as logger from './logger.js';

const SNAPSHOT_SUFFIX = '.json';
const KEEP_RECENT = 50;
const KEEP_DAILY = 30;

const sha256 = text => createHash('sha256').update(text).digest('hex').slice(0, 12);

const isoToFileName = (iso, sha) => `${iso.replace(/[:.]/gu, '-')}-${sha}${SNAPSHOT_SUFFIX}`;

const parseFileName = name => {
  if (!name.endsWith(SNAPSHOT_SUFFIX)) {
    return null;
  }
  const base = name.slice(0, -SNAPSHOT_SUFFIX.length);
  // ISO 2026-05-12T08-05-00-000Z + - + 12hex
  const match = base.match(
    /^(?<isoRaw>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(?<sha>[a-f0-9]{12})$/u
  );
  if (!match) {
    return null;
  }
  const { isoRaw } = match.groups;
  // Restore the colons and the period: 2026-05-12T08:05:00.000Z
  const iso = `${isoRaw.slice(0, 10)}T${isoRaw.slice(11, 13)}:${isoRaw.slice(14, 16)}:${isoRaw.slice(17, 19)}.${isoRaw.slice(20, 23)}Z`;
  return { name, iso, sha: match.groups.sha };
};

export const listSnapshots = async snapshotsDir => {
  if (!(await fileExists(snapshotsDir))) {
    return [];
  }
  const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  const parsedRecords = entries
    .filter(entry => entry.isFile())
    .map(entry => parseFileName(entry.name))
    .filter(parsed => parsed !== null);
  const records = await Promise.all(
    parsedRecords.map(async parsed => {
      const stat = await fs.stat(joinPath(snapshotsDir, parsed.name));
      return { ...parsed, size: stat.size };
    })
  );
  records.sort((a, b) => (a.iso < b.iso ? 1 : -1));
  return records;
};

const pruneSnapshots = async snapshotsDir => {
  const records = await listSnapshots(snapshotsDir);
  if (records.length === 0) {
    return;
  }
  const keep = new Set();
  // Keep the most recent KEEP_RECENT.
  for (const r of records.slice(0, KEEP_RECENT)) {
    keep.add(r.name);
  }
  // Plus one per day for the last KEEP_DAILY days.
  const seenDays = new Set();
  for (const r of records) {
    const day = r.iso.slice(0, 10);
    if (seenDays.has(day)) {
      continue;
    }
    seenDays.add(day);
    keep.add(r.name);
    if (seenDays.size >= KEEP_DAILY) {
      break;
    }
  }
  await Promise.all(
    records
      .filter(r => !keep.has(r.name))
      .map(r =>
        fs
          .rm(joinPath(snapshotsDir, r.name), { force: true })
          .catch(err =>
            logger.warning('snapshot prune rm failed', { id: r.name, error: err.message })
          )
      )
  );
};

export const writeSnapshot = async (snapshotsDir, state, meta = {}) => {
  await ensureDir(snapshotsDir);
  const iso = new Date().toISOString();
  const wrapped = {
    snapshotAt: iso,
    actor: meta.actor ?? null,
    reason: meta.reason ?? null,
    state,
  };
  const body = JSON.stringify(wrapped, null, 2);
  const sha = sha256(body);
  const fileName = isoToFileName(iso, sha);
  const target = joinPath(snapshotsDir, fileName);
  await writeAtomic(target, `${body}\n`, { mode: 0o644 });
  logger.info('state snapshot written', { fileName, sha, actor: meta.actor });
  await pruneSnapshots(snapshotsDir).catch(err =>
    logger.warning('snapshot pruning failed', { error: err.message })
  );
  return { id: fileName, iso, sha };
};

export const readSnapshot = async (snapshotsDir, id) => {
  const parsed = parseFileName(id);
  if (!parsed) {
    return null;
  }
  const target = joinPath(snapshotsDir, parsed.name);
  if (!(await fileExists(target))) {
    return null;
  }
  return readJson(target);
};

export const isValidSnapshotId = id => parseFileName(id) !== null;
