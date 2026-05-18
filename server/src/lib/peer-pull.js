import { dirname } from 'node:path';

import { applyState } from './apply-state.js';
import * as audit from './audit.js';
import {
  BLOB_KINDS,
  buildLocalManifest,
  ensureBlobParentDir,
  resolveBlobPath,
} from './blob-kinds.js';
import { ensureDir, writeAtomic } from './files.js';
import { log } from './logger.js';
import { loadNodeConfig } from './node-config.js';
import * as peerClient from './peer-client.js';
import { computeStateChecksum } from './peer-sync.js';
import { loadPeersStore } from './peers-store.js';
import { loadState } from './state.js';

const PULL_LOCK = Symbol('peer-pull-tick-lock');

let lastPullResult = null;

export const getLastPullResult = () => lastPullResult;

const findUpstreamPeer = async (config, pullFromPeerId) => {
  if (!pullFromPeerId) {
    return null;
  }
  const store = await loadPeersStore(config.paths.peersStore);
  return store.peers.find(p => p.id === pullFromPeerId) ?? null;
};

const pullBlobsFromUpstream = async (config, upstream) => {
  let remoteManifest;
  try {
    const response = await peerClient.getCertManifest({
      baseUrl: upstream.url,
      token: upstream.outboundToken,
      timeoutMs: 10_000,
    });
    remoteManifest = response?.entries ?? [];
  } catch (err) {
    log.app.warn('peer-pull cert-manifest fetch failed', {
      upstream: upstream.id,
      error: err.message,
    });
    return { pulled: 0, skipped: 0, failed: 1, error: err.message };
  }
  const localManifest = await buildLocalManifest(config);
  const localIndex = new Map();
  for (const entry of localManifest) {
    localIndex.set(`${entry.kind}|${entry.id}`, entry.fingerprint);
  }
  const toPull = remoteManifest.filter(entry => {
    if (!BLOB_KINDS[entry.kind]) {
      return false;
    }
    return localIndex.get(`${entry.kind}|${entry.id}`) !== entry.fingerprint;
  });
  const results = await Promise.all(
    toPull.map(async entry => {
      const def = BLOB_KINDS[entry.kind];
      let body;
      try {
        body = await peerClient.getBlob({
          baseUrl: upstream.url,
          token: upstream.outboundToken,
          kind: entry.kind,
          id: entry.id,
          timeoutMs: 60_000,
        });
      } catch (err) {
        log.app.warn('peer-pull blob fetch failed', {
          upstream: upstream.id,
          kind: entry.kind,
          id: entry.id,
          error: err.message,
        });
        return 'failed';
      }
      if (typeof body !== 'string') {
        return 'failed';
      }
      let filePath;
      try {
        filePath = await ensureBlobParentDir(config, entry.kind, entry.id);
      } catch (err) {
        log.app.warn('peer-pull ensureBlobParentDir failed', {
          upstream: upstream.id,
          kind: entry.kind,
          id: entry.id,
          error: err.message,
        });
        return 'failed';
      }
      if (!filePath) {
        filePath = resolveBlobPath(config, entry.kind, entry.id);
      }
      if (!filePath) {
        return 'failed';
      }
      try {
        await ensureDir(dirname(filePath));
        await writeAtomic(filePath, body, { mode: def.mode });
        audit.record({
          actor: `peer-pull:${upstream.id}`,
          category: 'cluster',
          action: 'blob-pull',
          target: `${entry.kind}/${entry.id}`,
          outcome: 'ok',
        });
        return 'pulled';
      } catch (err) {
        log.app.warn('peer-pull blob write failed', {
          upstream: upstream.id,
          kind: entry.kind,
          id: entry.id,
          error: err.message,
        });
        return 'failed';
      }
    })
  );
  const pulled = results.filter(r => r === 'pulled').length;
  const failed = results.filter(r => r === 'failed').length;
  return { pulled, skipped: remoteManifest.length - toPull.length, failed };
};

const peerPullActor = upstream => `peer-pull:${upstream.id}`;

const pullStateFromUpstream = async (config, upstream) => {
  let payload;
  try {
    payload = await peerClient.getPeerState({
      baseUrl: upstream.url,
      token: upstream.outboundToken,
      timeoutMs: 30_000,
    });
  } catch (err) {
    log.app.warn('peer-pull state fetch failed', {
      upstream: upstream.id,
      error: err.message,
    });
    audit.record({
      actor: peerPullActor(upstream),
      category: 'cluster',
      action: 'sync-pull',
      outcome: 'error',
      details: { upstream: upstream.id, url: upstream.url, error: err.message },
    });
    return { ok: false, error: err.message, applied: false };
  }
  if (!payload?.state) {
    return { ok: true, applied: false, reason: 'upstream-state-empty' };
  }
  const localState = await loadState(config.paths.state).catch(() => null);
  const localChecksum = localState ? computeStateChecksum(localState) : null;
  if (localChecksum && payload.checksum && localChecksum === payload.checksum) {
    return { ok: true, applied: false, reason: 'checksums-match', checksum: payload.checksum };
  }
  try {
    await applyState(config, payload.state, {
      editor: peerPullActor(upstream),
      reason: 'peer-pull',
    });
    audit.record({
      actor: peerPullActor(upstream),
      category: 'cluster',
      action: 'sync-pull',
      outcome: 'ok',
      details: {
        upstream: upstream.id,
        url: upstream.url,
        remoteChecksum: payload.checksum,
        localChecksumBefore: localChecksum,
      },
    });
    return { ok: true, applied: true, checksum: payload.checksum };
  } catch (err) {
    log.app.warn('peer-pull apply failed', { upstream: upstream.id, error: err.message });
    audit.record({
      actor: peerPullActor(upstream),
      category: 'cluster',
      action: 'sync-pull',
      outcome: 'error',
      details: { upstream: upstream.id, url: upstream.url, error: err.message },
    });
    return { ok: false, error: err.message, applied: false };
  }
};

const recordPullResult = result => {
  lastPullResult = { ...result, ts: new Date().toISOString() };
  return result;
};

export const runOnePullTick = async config => {
  if (config[PULL_LOCK]) {
    return { skipped: 'in-progress' };
  }
  config[PULL_LOCK] = true;
  try {
    const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
    const { sync } = nodeConfig;
    if (!sync || sync.pullEnabled !== true) {
      return recordPullResult({ skipped: 'pull-disabled' });
    }
    if (!sync.pullFromPeerId) {
      return recordPullResult({ skipped: 'no-upstream-configured' });
    }
    const upstream = await findUpstreamPeer(config, sync.pullFromPeerId);
    if (!upstream) {
      log.app.warn('peer-pull upstream peer not found in peers store', {
        pullFromPeerId: sync.pullFromPeerId,
      });
      return recordPullResult({
        skipped: 'upstream-not-paired',
        pullFromPeerId: sync.pullFromPeerId,
      });
    }
    const stateResult = await pullStateFromUpstream(config, upstream);
    let blobResult = null;
    if (stateResult.ok) {
      blobResult = await pullBlobsFromUpstream(config, upstream);
      if (blobResult.pulled > 0 || blobResult.failed > 0) {
        audit.record({
          actor: peerPullActor(upstream),
          category: 'cluster',
          action: 'pull-blobs',
          target: upstream.id,
          outcome: blobResult.failed === 0 ? 'ok' : 'error',
          details: { upstream: upstream.id, url: upstream.url, ...blobResult },
        });
      }
    }
    return recordPullResult({
      upstream: { id: upstream.id, name: upstream.name, url: upstream.url },
      state: stateResult,
      blobs: blobResult,
    });
  } finally {
    config[PULL_LOCK] = false;
  }
};

export const startPullLoop = config => {
  let timer = null;
  let stopped = false;
  let currentIntervalMs = null;

  const tick = async () => {
    if (stopped) {
      return;
    }
    try {
      const result = await runOnePullTick(config);
      if (result?.upstream) {
        log.app.debug('peer-pull tick complete', result);
      }
    } catch (err) {
      log.app.warn('peer-pull tick threw', { error: err.message });
    }
    if (stopped) {
      return;
    }
    let intervalMs = currentIntervalMs ?? 60_000;
    try {
      const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
      const sec = nodeConfig.sync?.pullIntervalSeconds ?? 60;
      intervalMs = Math.max(10_000, sec * 1000);
    } catch {
      // keep previous interval on read failure
    }
    currentIntervalMs = intervalMs;
    timer = setTimeout(tick, intervalMs);
  };

  setTimeout(tick, 5_000);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
};
