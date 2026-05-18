import { promises as fs } from 'node:fs';

import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { errorResponse } from '../lib/api-response.js';
import { ensureDir, fileExists, safePathUnder, writeAtomic } from '../lib/files.js';
import { log } from '../lib/logger.js';
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
    res.status(401).json(errorResponse(req, 'cluster.peer.tokenMissing'));
    return;
  }
  const token = header.slice(7).trim();
  if (token.length === 0) {
    res.status(401).json(errorResponse(req, 'cluster.peer.tokenMissing'));
    return;
  }
  try {
    const store = await loadPeersStore(config.paths.peersStore);
    const tokenEntry = findInboundTokenEntry(store, token);
    if (!tokenEntry) {
      res.status(401).json(errorResponse(req, 'cluster.peer.tokenUnknown'));
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
      log.api.debug('inbound token usage bump failed (non-fatal)', { error: err.message })
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

  /**
   * @swagger
   * /api/peers:
   *   get:
   *     summary: List configured cluster peers
   *     description: Returns the outbound peer list — every node this one knows how to push state to. Outbound tokens are redacted in the response.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Peer list (tokens redacted)
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: string, example: 'peer-a1b2c3d4e5f6' }
   *                   url: { type: string, format: 'uri' }
   *                   name: { type: string }
   *                   addedAt: { type: string, format: 'date-time' }
   *                   lastSyncAt: { type: string, format: 'date-time', nullable: true }
   */
  router.get('/peers', async (req, res, next) => {
    log.api.debug('GET /peers', { ip: req.ip });
    try {
      const store = await loadPeersStore(config.paths.peersStore);
      res.set('cache-control', 'no-store').json(store.peers.map(sanitizePeerForExport));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/peers:
   *   post:
   *     summary: Add a cluster peer (paste-pairing)
   *     description: |
   *       Operator pastes the peer's URL and an inbound token that the peer minted (on its own "My inbound tokens" card). No handshake — pairing is unidirectional per setup. To make the OTHER node able to call this one, repeat this flow on the peer using a token THIS node minted.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [url, name, token]
   *             properties:
   *               url: { type: string, format: 'uri', example: 'https://haproxy-s2-n2.example.com:8099' }
   *               name: { type: string, description: 'Friendly label for this peer' }
   *               token: { type: string, minLength: 16, description: 'Raw inbound token minted on the peer' }
   *     responses:
   *       200:
   *         description: Peer added
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 peer: { type: object }
   *       400: { description: 'Missing/invalid fields', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
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
    log.api.info('POST /peers', { ip: req.ip, actor, url, name });
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

  /**
   * @swagger
   * /api/peers/{id}:
   *   delete:
   *     summary: Remove a cluster peer
   *     description: Removes the peer record. Does NOT revoke the token on the OTHER side — to fully cut sync, revoke the inbound token the OTHER node minted (on that node's "My inbound tokens" card).
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, pattern: '^peer-[a-f0-9]{12}$' }
   *     responses:
   *       200: { description: 'Peer removed', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Invalid peer id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/peers/:id', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_PEER_ID.test(id)) {
      res.status(400).json({ error: 'invalid peer id' });
      return;
    }
    log.api.info('DELETE /peers/:id', { ip: req.ip, actor, id });
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

  /**
   * @swagger
   * /api/peers/{id}/sync-now:
   *   post:
   *     summary: Push current state to all peers immediately
   *     description: Bypasses the periodic sync scheduler — re-pushes the local state document to every configured peer. The `id` path param is currently informational only (the implementation pushes to all peers, not just the one named); future work may scope this.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Push completed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *               additionalProperties: true
   *       400: { description: 'Invalid peer id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       409: { description: 'No local state to push', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/peers/:id/sync-now', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_PEER_ID.test(id)) {
      res.status(400).json({ error: 'invalid peer id' });
      return;
    }
    log.api.info('POST /peers/:id/sync-now', { ip: req.ip, actor, id });
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

  /**
   * @swagger
   * /api/peers/drift:
   *   get:
   *     summary: Drift report — local state checksum vs. each peer's
   *     description: Fetches `/api/peer/state-checksum` from every configured peer and compares to the local state checksum. Lets the UI flag peers that need a sync push.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Drift report (one entry per peer)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 peers: { type: array, items: { type: object } }
   *       409: { description: 'No local state', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/peers/drift', async (req, res, next) => {
    log.api.debug('GET /peers/drift', { ip: req.ip });
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

  /**
   * @swagger
   * /api/peers/inbound-tokens:
   *   get:
   *     summary: List inbound tokens this node accepts
   *     description: Returns every inbound token minted on this node (id + label + dates + lastUsedAt). Raw token values are NEVER exposed — those are only returned at mint time.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     responses:
   *       200:
   *         description: Inbound token list
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id: { type: string, pattern: '^tk-[a-f0-9]{12}$' }
   *                   label: { type: string }
   *                   mintedAt: { type: string, format: 'date-time' }
   *                   lastUsedAt: { type: string, format: 'date-time', nullable: true }
   *                   lastUsedBy: { type: string, nullable: true }
   *                   tokenPreview: { type: string, description: 'First few chars only' }
   */
  router.get('/peers/inbound-tokens', async (req, res, next) => {
    log.api.debug('GET /peers/inbound-tokens', { ip: req.ip });
    try {
      const store = await loadPeersStore(config.paths.peersStore);
      res
        .set('cache-control', 'no-store')
        .json(store.inboundTokens.map(sanitizeInboundTokenForExport));
    } catch (err) {
      next(err);
    }
  });

  /**
   * @swagger
   * /api/peers/inbound-tokens:
   *   post:
   *     summary: Mint an inbound token
   *     description: Generates a fresh inbound token. The response includes the raw token — this is the ONLY time it's returned. Paste it into the peer's "Add peer" modal so that peer can call us. Auto-generates a label if one isn't provided.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label: { type: string, description: 'Friendly label. Auto-generated when omitted.' }
   *     responses:
   *       200:
   *         description: Token minted; raw value returned once
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id: { type: string }
   *                 token: { type: string, description: 'Raw token — only returned at mint time' }
   *                 label: { type: string }
   *                 mintedAt: { type: string, format: 'date-time' }
   *       400: { description: 'Label not a string', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/peers/inbound-tokens', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { label } = req.body ?? {};
    if (label !== undefined && typeof label !== 'string') {
      res.status(400).json({ error: 'label must be a string if provided' });
      return;
    }
    log.api.info('POST /peers/inbound-tokens', { ip: req.ip, actor });
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

  /**
   * @swagger
   * /api/peers/inbound-tokens/{id}:
   *   patch:
   *     summary: Rename an inbound token
   *     description: Updates the label only. The token's secret value is unchanged.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, pattern: '^tk-[a-f0-9]{12}$' }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [label]
   *             properties:
   *               label: { type: string, minLength: 1 }
   *     responses:
   *       200:
   *         description: Token renamed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id: { type: string }
   *                 label: { type: string }
   *                 mintedAt: { type: string, format: 'date-time' }
   *                 lastUsedAt: { type: string, format: 'date-time', nullable: true }
   *       400: { description: 'Invalid id / empty label', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Token not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
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
    log.api.info('PATCH /peers/inbound-tokens/:id', { ip: req.ip, actor, id });
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

  /**
   * @swagger
   * /api/peers/inbound-tokens/{id}:
   *   delete:
   *     summary: Revoke an inbound token
   *     description: Removes the token. Any peer currently using it will start getting 401 responses on its next sync attempt.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *       - CookieAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, pattern: '^tk-[a-f0-9]{12}$' }
   *     responses:
   *       200: { description: 'Token revoked', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Invalid id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.delete('/peers/inbound-tokens/:id', async (req, res, next) => {
    const actor = PEER_ACTOR(req);
    const { id } = req.params;
    if (!SAFE_TOKEN_ID.test(id)) {
      res.status(400).json({ error: 'invalid token id' });
      return;
    }
    log.api.info('DELETE /peers/inbound-tokens/:id', { ip: req.ip, actor, id });
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

  /**
   * @swagger
   * /api/peer/clock:
   *   get:
   *     summary: Peer-to-peer clock probe
   *     description: |
   *       Returns this node's wall-clock + monotonic timestamps. Called by paired peers to measure clock skew before pushing state. Authenticated with a raw inbound token in the `Authorization: Bearer …` header — NOT a `pp_<keyId>.<secret>` token. Paired peers also send `X-Patchpanel-Node-Name` for audit attribution.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: Clock snapshot
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 time: { type: string, format: 'date-time' }
   *                 monotonic: { type: integer, description: 'performance.now() rounded to int (ms)' }
   *       401: { description: 'Bad/missing inbound token', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/peer/clock', peerAuth(config), (req, res) => {
    log.api.debug('GET /peer/clock', { caller: req.peerIdentity?.callerName ?? null });
    res.json({ time: new Date().toISOString(), monotonic: Math.round(performance.now()) });
  });

  /**
   * @swagger
   * /api/peer/state-checksum:
   *   get:
   *     summary: Local state checksum (peer-to-peer)
   *     description: Returns a deterministic checksum of this node's state document. Paired peers compare this to their own to detect drift before deciding to pull or push. Same inbound-token auth as `/api/peer/clock`.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: Checksum (null when state is uninitialized)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 checksum: { type: string, nullable: true }
   *       401: { description: 'Bad/missing inbound token', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.get('/peer/state-checksum', peerAuth(config), async (req, res, next) => {
    log.api.debug('GET /peer/state-checksum', { caller: req.peerIdentity?.callerName ?? null });
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

  /**
   * @swagger
   * /api/peer/state:
   *   post:
   *     summary: Receive a state push from a paired peer
   *     description: Apply pipeline entry point for incoming peer-pushed state. Runs the full `applyState` flow (render → validate → swap → reload → snapshot). Audit entry records the actor as `peer:<token-label-or-id>`. Same inbound-token auth as other `/api/peer/*` endpoints.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [state]
   *             properties:
   *               state: { $ref: '#/components/schemas/StateDoc' }
   *               checksum: { type: string, description: 'Sender-computed checksum (optional, for tracing)' }
   *     responses:
   *       200: { description: 'Apply succeeded', content: { application/json: { schema: { $ref: '#/components/schemas/Success' } } } }
   *       400: { description: 'Missing state body', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Bad/missing inbound token', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       422: { description: 'State failed Zod validation', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       502: { description: 'haproxy -c failed on the pushed state; rolled back', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
  router.post('/peer/state', peerAuth(config), async (req, res, next) => {
    const actor = peerActor(req);
    const { state, checksum } = req.body ?? {};
    if (!state || typeof state !== 'object') {
      res.status(400).json({ error: 'state body is required' });
      return;
    }
    log.api.info('POST /peer/state', { from: actor, checksum });
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

  /**
   * @swagger
   * /api/peer/blob/{kind}/{id}:
   *   get:
   *     summary: Fetch a sync blob from this node
   *     description: |
   *       Cluster-sync read endpoint — paired peers pull non-state files (trusted CA bundles, CRLs, ACME credentials, Lua plugins) via this route. Each kind maps to a whitelisted directory under config.paths; arbitrary kinds are rejected.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: kind
   *         required: true
   *         schema: { type: string, enum: [trusted-ca, trusted-crl, credential, lua-plugin] }
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, pattern: '^[a-zA-Z0-9._-]{1,128}$' }
   *     responses:
   *       200:
   *         description: Blob bytes
   *         content:
   *           text/plain:
   *             schema: { type: string }
   *       400: { description: 'Unknown kind / invalid id', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Bad/missing inbound token', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       404: { description: 'Blob not found', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       500: { description: 'Target directory not configured', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
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

  /**
   * @swagger
   * /api/peer/blob/{kind}/{id}:
   *   post:
   *     summary: Receive a sync blob from a paired peer
   *     description: |
   *       Cluster-sync write endpoint. Writes the blob to the whitelisted directory for `kind` (mode 0600 for credentials, 0644 for everything else). Body is `{body: "..."}` — file bytes as a UTF-8 string.
   *     tags: [Configuration]
   *     security:
   *       - BearerAuth: []
   *     parameters:
   *       - in: path
   *         name: kind
   *         required: true
   *         schema: { type: string, enum: [trusted-ca, trusted-crl, credential, lua-plugin] }
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, pattern: '^[a-zA-Z0-9._-]{1,128}$' }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [body]
   *             properties:
   *               body: { type: string, description: 'Raw file contents (PEM, INI, Lua)' }
   *     responses:
   *       200:
   *         description: Blob written
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok: { type: boolean, example: true }
   *                 path: { type: string }
   *       400: { description: 'Unknown kind / invalid id / missing body', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       401: { description: 'Bad/missing inbound token', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   *       500: { description: 'Target directory not configured', content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }
   */
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
