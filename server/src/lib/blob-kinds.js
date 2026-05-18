import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { ensureDir, safePathUnder } from './files.js';
import { log } from './logger.js';

// Central whitelist of every file kind the peer-to-peer blob endpoints
// accept, plus the helpers needed to enumerate them, hash them, resolve
// them on disk, and ship them across the cluster.
//
// Each kind is uniform:
//   dir(config)   → absolute path to the kind's root dir, or null when the
//                   path isn't configured. Resolved at call time so config
//                   reloads are picked up without a server restart.
//   relPath(id)   → path relative to dir() for the file with this id. The
//                   kind owns its on-disk shape — flat files for simple
//                   kinds (`<id>.pem`), nested layout for cert lineages
//                   (`<id>/fullchain.pem`, `live/<id>/privkey.pem`).
//   mode          → file mode used when writing. Conservative for private
//                   keys (0o600), readable for chains / public material
//                   (0o644).
//   walk(dir)     → enumerates existing on-disk files under `dir`,
//                   returning `[{id, fingerprint, size, mtime}]` rows the
//                   manifest endpoint joins together. Cert kinds use the
//                   nested-pair walker; the four simple kinds use flat
//                   walkers. Adding a new kind = one entry here plus,
//                   maybe, a walker variant.
//
// The kind name itself is wire-stable — peers exchange `kind` strings on
// every blob call and on the manifest endpoint. Renaming a kind is a
// cluster-wide compatibility break, so don't.

const sha256OfFile = async path => {
  try {
    const buf = await fs.readFile(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
};

const statSafe = async path => {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
};

const listDirSafe = async dir => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

// Walker for kinds that lay one file per id directly under the kind's
// root dir, named `<id><suffix>`. Used by trusted-ca, trusted-crl,
// credential, lua-plugin.
const walkFlat = async (dir, suffix) => {
  const entries = await listDirSafe(dir);
  const candidates = entries.filter(entry => entry.isFile() && entry.name.endsWith(suffix));
  const rows = await Promise.all(
    candidates.map(async entry => {
      const id = entry.name.slice(0, -suffix.length);
      const filePath = join(dir, entry.name);
      const [stat, fingerprint] = await Promise.all([statSafe(filePath), sha256OfFile(filePath)]);
      if (!stat || !fingerprint) {
        return null;
      }
      return { id, fingerprint, size: stat.size, mtime: stat.mtimeMs };
    })
  );
  return rows.filter(Boolean);
};

// Walker for cert kinds that lay one subdir per id with a known leaf
// inside (`<dir>/<id>/<leafName>`). Used by BYO certs.
const walkNestedPair = async (dir, leafName) => {
  const entries = await listDirSafe(dir);
  const dirs = entries.filter(entry => entry.isDirectory());
  const rows = await Promise.all(
    dirs.map(async entry => {
      const id = entry.name;
      const filePath = join(dir, id, leafName);
      const [stat, fingerprint] = await Promise.all([statSafe(filePath), sha256OfFile(filePath)]);
      if (!stat || !fingerprint) {
        return null;
      }
      return { id, fingerprint, size: stat.size, mtime: stat.mtimeMs };
    })
  );
  return rows.filter(Boolean);
};

// Walker for Let's Encrypt lineages: the same nested-pair shape but
// nested under `<letsencryptDir>/live/`. certbot puts files behind
// versioned `archive/` symlinks; we read the resolved bytes so peers
// receive plain files (their HAProxy doesn't care about symlink
// semantics, only the resolved PEM content).
const walkLeLineage = (root, leafName) => {
  if (!root) {
    return Promise.resolve([]);
  }
  return walkNestedPair(join(root, 'live'), leafName);
};

export const BLOB_KINDS = Object.freeze({
  'trusted-ca': {
    dir: c => c.paths.trustedCasDir,
    relPath: id => `${id}.pem`,
    mode: 0o644,
    walk: dir => walkFlat(dir, '.pem'),
  },
  'trusted-crl': {
    dir: c => c.paths.trustedCrlsDir,
    relPath: id => `${id}.pem`,
    mode: 0o644,
    walk: dir => walkFlat(dir, '.pem'),
  },
  credential: {
    dir: c => c.paths.credentials,
    relPath: id => `${id}.ini`,
    mode: 0o600,
    walk: dir => walkFlat(dir, '.ini'),
  },
  // luaPluginsDirs is an array (operator-whitelist of safe upload roots).
  // The first entry is the canonical writable dir for sync; uploads to
  // additional entries via the local upload endpoint stay local-only.
  'lua-plugin': {
    dir: c => c.paths.luaPluginsDirs?.[0] ?? null,
    relPath: id => `${id}.lua`,
    mode: 0o644,
    walk: dir => walkFlat(dir, '.lua'),
  },
  // BYO certs are <byoCertsDir>/<id>/{fullchain,privkey}.pem. Split into
  // two kinds so the private key gets mode 0o600 while the chain stays
  // 0o644 (HAProxy reads via the supplementary `haproxy` group + perms).
  'byo-cert-fullchain': {
    dir: c => c.paths.byoCertsDir,
    relPath: id => `${id}/fullchain.pem`,
    mode: 0o644,
    walk: dir => walkNestedPair(dir, 'fullchain.pem'),
  },
  'byo-cert-privkey': {
    dir: c => c.paths.byoCertsDir,
    relPath: id => `${id}/privkey.pem`,
    mode: 0o600,
    walk: dir => walkNestedPair(dir, 'privkey.pem'),
  },
  // Let's Encrypt lineages: only the renewal leader actually runs
  // certbot. After every renewal it ships the resolved fullchain +
  // privkey bytes to peers via these kinds. Peers receive plain files
  // (no symlink chain), which their local HAProxy reads identically.
  'le-cert-fullchain': {
    dir: c => c.paths.letsencryptDir,
    relPath: id => `live/${id}/fullchain.pem`,
    mode: 0o644,
    walk: dir => walkLeLineage(dir, 'fullchain.pem'),
  },
  'le-cert-privkey': {
    dir: c => c.paths.letsencryptDir,
    relPath: id => `live/${id}/privkey.pem`,
    mode: 0o600,
    walk: dir => walkLeLineage(dir, 'privkey.pem'),
  },
});

// Resolves the absolute on-disk path for {kind, id} using the kind's
// `dir` + `relPath`, guarded by safePathUnder so a maliciously crafted
// id can't escape the root via traversal.
export const resolveBlobPath = (config, kind, id) => {
  const def = BLOB_KINDS[kind];
  if (!def) {
    return null;
  }
  const dir = def.dir(config);
  if (!dir) {
    return null;
  }
  return safePathUnder(dir, def.relPath(id));
};

// Used by the POST blob handler before writeAtomic — cert kinds store
// files in per-id subdirs (`<byoCertsDir>/example.com/`,
// `<letsencryptDir>/live/example.com/`) that have to exist or the
// rename-into-place step of writeAtomic fails with ENOENT.
export const ensureBlobParentDir = async (config, kind, id) => {
  const filePath = resolveBlobPath(config, kind, id);
  if (!filePath) {
    return null;
  }
  await ensureDir(dirname(filePath));
  return filePath;
};

// Builds the full local manifest by walking every BLOB_KINDS entry.
// Returns a flat array of {kind, id, fingerprint, size, mtime} rows.
// The same shape is consumed by:
//   - peer-sync.js (to compute "what does peer X need that I have?")
//   - the cluster-topology cluster-node satellite UI (cert posture per
//     peer: count of byo + le + trusted-ca rows, expiring etc., once
//     we layer a small expiry probe on top).
//
// Failures inside one kind never block other kinds — the offending kind
// is logged and skipped. This lets the manifest endpoint stay usable on
// a node where (say) /etc/letsencrypt isn't readable.
export const buildLocalManifest = async config => {
  const kinds = Object.entries(BLOB_KINDS)
    .map(([kind, def]) => ({ kind, def, dir: def.dir(config) }))
    .filter(item => item.dir);
  const perKind = await Promise.all(
    kinds.map(async ({ kind, def, dir }) => {
      try {
        const rows = await def.walk(dir);
        return rows.map(row => ({ kind, ...row }));
      } catch (err) {
        log.app.warn('blob walk failed', { kind, dir, error: err.message });
        return [];
      }
    })
  );
  return perKind.flat();
};

// Diff for the sync orchestrator: returns rows from `local` whose
// (kind, id) either doesn't exist on the peer or exists with a different
// fingerprint. "Sender wins" — see peer-sync.js for the directionality
// caveat (we don't try to merge or detect "peer is newer"; the operator
// chooses sync direction by which node they push from).
export const blobsToPush = (local, remote) => {
  const remoteIndex = new Map();
  for (const entry of remote ?? []) {
    remoteIndex.set(`${entry.kind}|${entry.id}`, entry.fingerprint);
  }
  return local.filter(entry => remoteIndex.get(`${entry.kind}|${entry.id}`) !== entry.fingerprint);
};

// Reads the bytes for a local {kind, id} so peer-sync can POST them to
// a peer's blob endpoint. Returns null when the kind is unknown or the
// configured dir doesn't exist.
export const readBlobBody = (config, kind, id) => {
  const filePath = resolveBlobPath(config, kind, id);
  if (!filePath) {
    return Promise.resolve(null);
  }
  return fs.readFile(filePath, 'utf8');
};
