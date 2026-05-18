import { createHash } from 'node:crypto';

import * as audit from './audit.js';
import { blobsToPush, buildLocalManifest, readBlobBody } from './blob-kinds.js';
import { log } from './logger.js';
import * as peerClient from './peer-client.js';
import { loadPeersStore, savePeersStore } from './peers-store.js';

// Orchestrates state + file sync from THIS node to its peers. Fire-and-
// forget: failures are logged + audited + surfaced via lastSyncAt/healthy
// fields on the peer record, but never block the local apply pipeline.
//
// Per-peer flow:
//   1. POST /api/peer/state — push the full state document (+ checksum).
//   2. GET  /api/peer/cert-manifest — list peer's existing blobs with
//      fingerprints.
//   3. Diff against the local manifest (see blob-kinds.js → blobsToPush).
//   4. For each (kind, id) the peer is missing or has at a different
//      fingerprint, POST /api/peer/blob/<kind>/<id>. The blob kinds cover
//      trusted CAs, CRLs, ACME credentials, Lua plugins, BYO cert
//      lineages, and Let's Encrypt cert lineages.
//   5. GET /api/peer/clock — record skew on the peer record for the UI.
//
// Direction: SENDER wins. A push from node-A overwrites differing blobs
// on node-B. If node-B has a newer version (e.g. it ran certbot more
// recently), the operator should push from node-B instead. Future work:
// renewal-leader flag on node.yaml so only one node runs certbot.

export const computeStateChecksum = stateJson => {
  const canonical = JSON.stringify(stateJson, Object.keys(stateJson).sort());
  return createHash('sha256').update(canonical).digest('hex');
};

const computeClockSkew = peerClockIso => {
  const peerMs = new Date(peerClockIso).getTime();
  if (!Number.isFinite(peerMs)) {
    return null;
  }
  return Math.abs(peerMs - Date.now());
};

// Pulls the peer's cert manifest, diffs it against `localManifest`, and
// POSTs each missing-or-different blob to the peer in sequence. Failures
// on individual blobs are logged + counted but never reject the outer
// flow — one bad PEM doesn't tank the whole sync. Returns a summary the
// caller folds into the per-peer audit record.
const syncBlobsToOnePeer = async ({ config, peer, localManifest, timeoutMs }) => {
  let remoteManifest;
  try {
    const response = await peerClient.getCertManifest({
      baseUrl: peer.url,
      token: peer.outboundToken,
      timeoutMs: 10_000,
    });
    remoteManifest = response?.entries ?? [];
  } catch (err) {
    log.app.warn('peer cert-manifest fetch failed', {
      peer: peer.id,
      url: peer.url,
      error: err.message,
      status: err.status ?? null,
    });
    return { pushed: 0, skipped: 0, failed: 1, error: err.message };
  }
  const toSend = blobsToPush(localManifest, remoteManifest);
  // Send blobs in parallel — each call is independently bounded by its own
  // timeout, so worst-case latency is one timeout regardless of count.
  const results = await Promise.all(
    toSend.map(async entry => {
      let body;
      try {
        body = await readBlobBody(config, entry.kind, entry.id);
      } catch (err) {
        log.app.warn('local blob read failed (skipping)', {
          peer: peer.id,
          kind: entry.kind,
          id: entry.id,
          error: err.message,
        });
        return 'failed';
      }
      if (body === null) {
        return 'failed';
      }
      try {
        await peerClient.pushBlob({
          baseUrl: peer.url,
          token: peer.outboundToken,
          kind: entry.kind,
          id: entry.id,
          payload: { body },
          timeoutMs: timeoutMs ?? 60_000,
        });
        return 'pushed';
      } catch (err) {
        log.app.warn('peer blob push failed', {
          peer: peer.id,
          kind: entry.kind,
          id: entry.id,
          error: err.message,
          status: err.status ?? null,
        });
        return 'failed';
      }
    })
  );
  const pushed = results.filter(r => r === 'pushed').length;
  const failed = results.filter(r => r === 'failed').length;
  return { pushed, skipped: localManifest.length - toSend.length, failed };
};

// Push state + manifest-diff blob set to one peer. Returns updated peer
// record (with refreshed lastSyncAt / clockSkewMs / healthy).
const pushToPeer = async ({ config, peer, bundle, localManifest, timeoutMs }) => {
  try {
    await peerClient.pushState({
      baseUrl: peer.url,
      token: peer.outboundToken,
      bundle,
      timeoutMs,
    });
    // Blob sync runs after state push so the receiver has already
    // applied the new state (which references whatever certs/luas/etc.
    // we're about to ship). If state apply itself rejected the push,
    // we never reach this line — peer-state is unchanged and there's
    // no reason to mutate its on-disk blobs.
    const blobSummary = await syncBlobsToOnePeer({
      config,
      peer,
      localManifest,
      timeoutMs,
    });
    if (blobSummary.pushed > 0 || blobSummary.failed > 0) {
      audit.record({
        actor: null,
        category: 'cluster',
        action: 'sync-blobs',
        target: peer.id,
        outcome: blobSummary.failed === 0 ? 'ok' : 'error',
        details: { url: peer.url, ...blobSummary },
      });
    }
    let clockSkew = null;
    try {
      const clock = await peerClient.getClock({
        baseUrl: peer.url,
        token: peer.outboundToken,
        timeoutMs: 5000,
      });
      clockSkew = computeClockSkew(clock?.time);
    } catch (err) {
      log.app.debug('peer clock probe failed (non-fatal)', { peer: peer.id, error: err.message });
    }
    return {
      ...peer,
      lastSyncAt: new Date().toISOString(),
      clockSkewMs: clockSkew,
      healthy: true,
    };
  } catch (err) {
    log.app.warn('peer state push failed', {
      peer: peer.id,
      url: peer.url,
      error: err.message,
      status: err.status ?? null,
    });
    audit.record({
      actor: null,
      category: 'cluster',
      action: 'sync-push',
      target: peer.id,
      outcome: 'error',
      details: { url: peer.url, error: err.message, status: err.status ?? null },
    });
    return { ...peer, healthy: false };
  }
};

export const pushStateToAllPeers = async (config, stateJson, renderedOutput) => {
  const store = await loadPeersStore(config.paths.peersStore);
  if (store.peers.length === 0) {
    return { pushed: [], failed: [] };
  }
  const checksum = computeStateChecksum(stateJson);
  const bundle = { state: stateJson, checksum, renderedOutput };
  // Build the local manifest ONCE per fanout rather than per peer — the
  // walk hits sha256 over every cert/lua/credential on disk, so doing it
  // N times for N peers wastes CPU on a re-pushed config. Manifest is
  // immutable for the duration of this call.
  const localManifest = await buildLocalManifest(config);
  // Push to all peers in parallel. Each pushToPeer call is bounded by its
  // own timeout (60s for state, +10s for manifest, +60s for blob pushes
  // worst-case), so worst-case latency is bounded regardless of peer
  // count. pushToPeer never rejects — failures are surfaced via the
  // healthy flag on the returned record.
  const next = await Promise.all(
    store.peers.map(peer => pushToPeer({ config, peer, bundle, localManifest, timeoutMs: 60_000 }))
  );
  const pushed = [];
  const failed = [];
  for (let i = 0; i < next.length; i += 1) {
    const updated = next[i];
    if (updated.healthy) {
      pushed.push(updated.id);
      audit.record({
        actor: null,
        category: 'cluster',
        action: 'sync-push',
        target: updated.id,
        outcome: 'ok',
        details: { url: updated.url, checksum: checksum.slice(0, 16) },
      });
    } else {
      failed.push(updated.id);
    }
  }
  await savePeersStore(config.paths.peersStore, { ...store, peers: next });
  return { pushed, failed };
};

const probeOnePeer = async (peer, localChecksum) => {
  try {
    const remote = await peerClient.getStateChecksum({
      baseUrl: peer.url,
      token: peer.outboundToken,
      timeoutMs: 5000,
    });
    const remoteChecksum = remote?.checksum ?? null;
    return {
      peerId: peer.id,
      peerName: peer.name,
      peerUrl: peer.url,
      matches: remoteChecksum === localChecksum,
      localChecksum,
      remoteChecksum,
    };
  } catch (err) {
    return {
      peerId: peer.id,
      peerName: peer.name,
      peerUrl: peer.url,
      matches: null,
      error: err.message,
      status: err.status ?? null,
    };
  }
};

// Compare local state checksum against every peer; flag drift. Peers are
// probed in parallel — each call has its own 5s timeout, so the report
// resolves in worst-case one timeout regardless of peer count.
export const probeDrift = async (config, localStateJson) => {
  const store = await loadPeersStore(config.paths.peersStore);
  if (store.peers.length === 0) {
    return [];
  }
  const localChecksum = computeStateChecksum(localStateJson);
  return Promise.all(store.peers.map(peer => probeOnePeer(peer, localChecksum)));
};
