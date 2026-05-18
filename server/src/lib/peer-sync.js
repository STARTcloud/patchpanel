import { createHash } from 'node:crypto';

import * as audit from './audit.js';
import { log } from './logger.js';
import * as peerClient from './peer-client.js';
import { loadPeersStore, savePeersStore } from './peers-store.js';

// Orchestrates state + cert sync from THIS node to its peers. Fire-and-
// forget: failures are logged + audited + surfaced via lastSyncAt/healthy
// fields on the peer record, but never block the local apply pipeline.
//
// The bundle we push to peers:
//   { state: <state.json>, checksum: <sha256 hex>, renderedOutput: {...} }
//
// The receiving peer applies state (which re-renders cfg locally), then
// pulls any cert blobs whose fingerprints differ via the GET blob endpoint.
// Cert blobs are NOT bundled into the state push — too large; lazy-fetched.

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

// Push state + rendered output bundle to one peer. Returns updated peer
// record (with refreshed lastSyncAt / clockSkewMs / healthy).
const pushToPeer = async ({ peer, bundle, timeoutMs }) => {
  try {
    await peerClient.pushState({
      baseUrl: peer.url,
      token: peer.outboundToken,
      bundle,
      timeoutMs,
    });
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
  // Push to all peers in parallel. Each pushToPeer call is bounded by its
  // own timeout (60s), so worst-case latency is one timeout regardless of
  // peer count. pushToPeer never rejects — failures are surfaced via the
  // healthy flag on the returned record.
  const next = await Promise.all(
    store.peers.map(peer => pushToPeer({ peer, bundle, timeoutMs: 60_000 }))
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
