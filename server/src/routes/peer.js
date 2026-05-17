import { promises as fs } from 'node:fs';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { ensureDir, fileExists, safePathUnder, writeAtomic } from '../lib/files.js';
import * as logger from '../lib/logger.js';
import { computeStateChecksum, probeDrift, pushStateToAllPeers } from '../lib/peer-sync.js';
import {
  createInboundToken,
  createPeerEntry,
  findInboundTokenEntry,
  inboundTokenMintResponse,
  loadPeersStore,
  markInboundTokenUsed,
  sanitizeInboundTokenForExport,
  sanitizePeerForExport,
  updatePeersStore,
} from '../lib/peers-store.js';
import { loadState } from '../lib/state.js';

// Cluster peer + inbound-token management.
//
//   GET    /api/peers                          — list configured peers
//   POST   /api/peers                          — add peer { url, name, token }
//   DELETE /api/peers/:id                      — remove peer
//   POST   /api/peers/:id/sync-now             — manual sync push to this peer
//   GET    /api/peers/drift                    — drift report (every peer)
//   POST   /api/peers/inbound-tokens           — mint a new inbound token
//   GET    /api/peers/inbound-tokens           — list inbound tokens (no raw)
//   PATCH  /api/peers/inbound-tokens/:id       — rename label
//   DELETE /api/peers/inbound-tokens/:id       — revoke
//
//   Peer-to-peer (bearer-token auth — paired peers call these):
//   GET    /api/peer/clock
//   GET    /api/peer/state-checksum
//   POST   /api/peer/state
//   GET    /api/peer/blob/:kind/:id
//   POST   /api/peer/blob/:kind/:id
//
// No handshake. Pairing is purely operator-paste: mint a token on Node B,
// paste Node B's URL + that token into Node A's "Add peer" form. Run twice
// (once on each node) for bidirectional sync.

// Blob kinds we accept on the peer cert-sync channel. Each maps to a
// destination directory in the local config. Whitelist-only to prevent
// arbitrary file writes through this endpoint.
const BLOB_KINDS = Object.freeze({
  'trusted-ca': { dirKey: 'trustedCasDir', suffix: '.pem', mode: 0o644 },
  'trusted-crl': { dirKey: 'trustedCrlsDir', suffix: '.pem', mode: 0o644 },
  credential: { dirKey: 'credentials', suffix: '.ini', mode: 0o600 },
  'lua-plugin': { dirKey: 'luaPluginsDir', suffix: '.lua', mode: 0o644 },
});

// Bearer-token middleware for incoming peer API calls. Looks up the token
// in the flat inboundTokens[] set. Peer identity is purely informational —
// X-Patchpanel-Node-Name header is captured for audit logging via
// req.peerIdentity. No per-peer auth coupling.
const peerAuth = config => async (req, res, next) => {
  const header = req.get('authorization') ?? '';
  // No regex — startsWith + slice avoids any polynomial-redos surface on a
  // header where the token portion is operator-controlled in length.
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }
  const token = header.slice(7).trim();
  if (token.length === 0) {
    res.status(401).json({ error: 'missing bearer token' });
    return;
  }
  try {
    const store = await loadPeersStore(config.paths.peersStore);
    const tokenEntry = findInboundTokenEntry(store, token);
    if (!tokenEntry) {
      res.status(401).json({ error: 'unknown bearer token' });
      return;
    }
    const callerName = req.get('x-patchpanel-node-name') ?? null;
    req.peerIdentity = {
      tokenId: tokenEntry.id,
      tokenLabel: tokenEntry.label,
      callerName,
      callerIp: req.ip,
    };
    // Fire-and-forget lastUsedAt bump. We don't await — if the file is
    // briefly contended, the next call will re-bump.
    updatePeersStore(config.paths.peersStore, store2 =>
      markInboundTokenUsed(store2, tokenEntry.id, callerName ?? req.ip)
    ).catch(err =>
      logger.debug('inbound token usage bump failed (non-fatal)', { error: err.message })
    );
    next();
  } catch (err) {
    next(err);
  }
};

const SAFE_BLOB_ID = /^[a-zA-Z0-9._-]{1,128}$/u;
const SAFE_TOKEN_ID = /^tk-[a-f0-9]{12}$/u;
const SAFE_PEER_ID = /^peer-[a-f0-9]{12}$/u;
const PEER_ACTOR = req => req.user?.id ?? null;
const peerActor = req => `peer:${req.peerIdentity?.tokenLabel ?? req.peerIdentity?.tokenId}`;

export const peerRouter = config => {
  const router = Router();

  // ---------------- peer list management ----------------

  router.get('/peers', async (req, res, next) => {
    logger.debug('GET /peers', { ip: req.ip });
    try {
      const store = await loadPeersStore(config.paths.peersStore);
      res.set('cache-control', 'no-store').json(store.peers.map(sanitizePeerForExport));
    } catch (err) {
      next(err);
    }
  });

  router.post('/peers', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { url, name, token } = req.body ?? {};
    if (typeof url !== 'string' || url.length === 0) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    if (typeof name !== 'string' || name.length === 0) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (typeof token !== 'string' || token.length < 16) {
      res.status(400).json({ error: "token is required (paste from peer's inbound-tokens list)" });
      return;
    }
    logger.info('POST /peers', { ip: req.ip, actor, url, name });
    try {
      const peer = createPeerEntry({ url, name, outboundToken: token });
      await updatePeersStore(config.paths.peersStore, store => ({
        ...store,
        peers: [...store.peers, peer],
      }));
      audit.record({
        actor,
        category: 'cluster',
        action: 'peer-add',
        target: peer.id,
        outcome: 'ok',
        details: { url, name },
      });
      res.json({ ok: true, peer: sanitizePeerForExport(peer) });
    } catch (err) {
      audit.record({
        actor,
        category: 'cluster',
        action: 'peer-add',
        outcome: 'error',
        details: { url, name, error: err.message },
      });
      next(err);
    }
  });

  router.delete('/peers/:id', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_PEER_ID.test(id)) {
      res.status(400).json({ error: 'invalid peer id' });
      return;
    }
    logger.info('DELETE /peers/:id', { ip: req.ip, actor, id });
    try {
      await updatePeersStore(config.paths.peersStore, store => ({
        ...store,
        peers: store.peers.filter(p => p.id !== id),
      }));
      audit.record({
        actor,
        category: 'cluster',
        action: 'peer-remove',
        target: id,
        outcome: 'ok',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/peers/:id/sync-now', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_PEER_ID.test(id)) {
      res.status(400).json({ error: 'invalid peer id' });
      return;
    }
    logger.info('POST /peers/:id/sync-now', { ip: req.ip, actor, id });
    try {
      const state = await loadState(config.paths.state);
      if (!state) {
        res.status(409).json({ error: 'no local state to push' });
        return;
      }
      const result = await pushStateToAllPeers(config, state, {});
      audit.record({
        actor,
        category: 'cluster',
        action: 'sync-now',
        target: id,
        outcome: 'ok',
        details: result,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  router.get('/peers/drift', async (req, res, next) => {
    logger.debug('GET /peers/drift', { ip: req.ip });
    try {
      const state = await loadState(config.paths.state);
      if (!state) {
        res.status(409).json({ error: 'no local state' });
        return;
      }
      const report = await probeDrift(config, state);
      res.set('cache-control', 'no-store').json({ peers: report });
    } catch (err) {
      next(err);
    }
  });

  // ---------------- inbound tokens (this node mints, accepts) ----------------

  router.get('/peers/inbound-tokens', async (req, res, next) => {
    logger.debug('GET /peers/inbound-tokens', { ip: req.ip });
    try {
      const store = await loadPeersStore(config.paths.peersStore);
      res
        .set('cache-control', 'no-store')
        .json(store.inboundTokens.map(sanitizeInboundTokenForExport));
    } catch (err) {
      next(err);
    }
  });

  router.post('/peers/inbound-tokens', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { label } = req.body ?? {};
    if (label !== undefined && typeof label !== 'string') {
      res.status(400).json({ error: 'label must be a string if provided' });
      return;
    }
    logger.info('POST /peers/inbound-tokens', { ip: req.ip, actor });
    try {
      const entry = createInboundToken({ label, mintedBy: actor });
      await updatePeersStore(config.paths.peersStore, store => ({
        ...store,
        inboundTokens: [...store.inboundTokens, entry],
      }));
      audit.record({
        actor,
        category: 'cluster',
        action: 'inbound-token-mint',
        target: entry.id,
        outcome: 'ok',
        details: { label: entry.label },
      });
      // One-time exposure of the raw token in the mint response.
      res.json(inboundTokenMintResponse(entry));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/peers/inbound-tokens/:id', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_TOKEN_ID.test(id)) {
      res.status(400).json({ error: 'invalid token id' });
      return;
    }
    const { label } = req.body ?? {};
    if (typeof label !== 'string' || label.trim().length === 0) {
      res.status(400).json({ error: 'label is required (non-empty string)' });
      return;
    }
    logger.info('PATCH /peers/inbound-tokens/:id', { ip: req.ip, actor, id });
    try {
      let updated = null;
      await updatePeersStore(config.paths.peersStore, store => ({
        ...store,
        inboundTokens: store.inboundTokens.map(t => {
          if (t.id !== id) {
            return t;
          }
          updated = { ...t, label: label.trim() };
          return updated;
        }),
      }));
      if (!updated) {
        res.status(404).json({ error: 'token not found' });
        return;
      }
      audit.record({
        actor,
        category: 'cluster',
        action: 'inbound-token-rename',
        target: id,
        outcome: 'ok',
        details: { label: updated.label },
      });
      res.json(sanitizeInboundTokenForExport(updated));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/peers/inbound-tokens/:id', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_TOKEN_ID.test(id)) {
      res.status(400).json({ error: 'invalid token id' });
      return;
    }
    logger.info('DELETE /peers/inbound-tokens/:id', { ip: req.ip, actor, id });
    try {
      await updatePeersStore(config.paths.peersStore, store => ({
        ...store,
        inboundTokens: store.inboundTokens.filter(t => t.id !== id),
      }));
      audit.record({
        actor,
        category: 'cluster',
        action: 'inbound-token-revoke',
        target: id,
        outcome: 'ok',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---------------- peer-to-peer authenticated endpoints ----------------

  router.get('/peer/clock', peerAuth(config), (req, res) => {
    logger.debug('GET /peer/clock', { caller: req.peerIdentity?.callerName ?? null });
    res.json({ time: new Date().toISOString(), monotonic: Math.round(performance.now()) });
  });

  router.get('/peer/state-checksum', peerAuth(config), async (req, res, next) => {
    logger.debug('GET /peer/state-checksum', { caller: req.peerIdentity?.callerName ?? null });
    try {
      const state = await loadState(config.paths.state);
      if (!state) {
        res.json({ checksum: null });
        return;
      }
      res.json({ checksum: computeStateChecksum(state) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/peer/state', peerAuth(config), async (req, res, next) => {
    const actor = peerActor(req);
    const { state, checksum } = req.body ?? {};
    if (!state || typeof state !== 'object') {
      res.status(400).json({ error: 'state body is required' });
      return;
    }
    logger.info('POST /peer/state', { from: actor, checksum });
    try {
      const { applyState } = await import('../lib/apply-state.js');
      await applyState(config, state, { editor: actor, reason: 'peer-sync' });
      audit.record({
        actor,
        category: 'cluster',
        action: 'sync-receive',
        outcome: 'ok',
        details: { from: req.peerIdentity?.callerName ?? null, checksum },
      });
      res.json({ ok: true });
    } catch (err) {
      audit.record({
        actor,
        category: 'cluster',
        action: 'sync-receive',
        outcome: 'error',
        details: { from: req.peerIdentity?.callerName ?? null, error: err.message },
      });
      next(err);
    }
  });

  router.get('/peer/blob/:kind/:id', peerAuth(config), async (req, res, next) => {
    const { kind, id } = req.params;
    const kindDef = BLOB_KINDS[kind];
    if (!kindDef) {
      res.status(400).json({ error: `unknown blob kind: ${kind}` });
      return;
    }
    if (!SAFE_BLOB_ID.test(id)) {
      res.status(400).json({ error: 'invalid blob id' });
      return;
    }
    const dir = config.paths[kindDef.dirKey];
    if (!dir) {
      res.status(500).json({ error: `paths.${kindDef.dirKey} is not configured` });
      return;
    }
    let filePath;
    try {
      filePath = safePathUnder(dir, `${id}${kindDef.suffix}`);
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!(await fileExists(filePath))) {
      res.status(404).json({ error: 'blob not found' });
      return;
    }
    try {
      const body = await fs.readFile(filePath, 'utf8');
      res.set('content-type', 'text/plain; charset=utf-8').send(body);
    } catch (err) {
      next(err);
    }
  });

  router.post('/peer/blob/:kind/:id', peerAuth(config), async (req, res, next) => {
    const { kind, id } = req.params;
    const kindDef = BLOB_KINDS[kind];
    if (!kindDef) {
      res.status(400).json({ error: `unknown blob kind: ${kind}` });
      return;
    }
    if (!SAFE_BLOB_ID.test(id)) {
      res.status(400).json({ error: 'invalid blob id' });
      return;
    }
    const body = typeof req.body?.body === 'string' ? req.body.body : null;
    if (!body) {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    const dir = config.paths[kindDef.dirKey];
    if (!dir) {
      res.status(500).json({ error: `paths.${kindDef.dirKey} is not configured` });
      return;
    }
    await ensureDir(dir);
    let filePath;
    try {
      filePath = safePathUnder(dir, `${id}${kindDef.suffix}`);
    } catch (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    try {
      await writeAtomic(filePath, body, { mode: kindDef.mode });
      audit.record({
        actor: peerActor(req),
        category: 'cluster',
        action: 'blob-receive',
        target: `${kind}/${id}`,
        outcome: 'ok',
      });
      res.json({ ok: true, path: filePath });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
