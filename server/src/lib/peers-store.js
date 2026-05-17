import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { z } from 'zod';

import { ensureDir, fileExists, writeAtomic } from './files.js';
import * as logger from './logger.js';

// peers.json — per-node store of cluster relationships. Never synced
// between nodes. Mode 0o600 because it carries bearer tokens for the peer
// API.
//
// Two independent lists:
//
//   inboundTokens: [{ id, token, label?, mintedAt, mintedBy,
//                     lastUsedAt?, lastUsedBy? }]
//     Tokens THIS node mints and accepts as bearer tokens on incoming
//     peer API calls. Operator hands one to a peer (via copy-paste OOB);
//     that peer stores it as an outbound token and presents it back.
//     Long-lived, revocable individually by id. No expiry by default.
//
//   peers: [{ id, name, url, outboundToken, addedAt, lastSyncAt?,
//             clockSkewMs?, healthy }]
//     Peers THIS node knows how to PUSH to. outboundToken is whatever the
//     other node minted on their side and the operator pasted here.
//     There is no "inboundToken" field on a peer — incoming auth is checked
//     against the flat inboundTokens[] set, not per-peer.
//
// To pair Node A ↔ Node B bidirectionally:
//   1. Node B mints an inbound token T_B (POST /api/peers/inbound-tokens)
//   2. Operator pastes Node B's URL + T_B into Node A → A's peers[] grows
//   3. Node A mints an inbound token T_A
//   4. Operator pastes Node A's URL + T_A into Node B → B's peers[] grows
// Each direction is independent. No handshake protocol.

const InboundTokenSchema = z.object({
  id: z.string().min(1),
  token: z.string().min(16),
  label: z.string().max(128).nullable().default(null),
  mintedAt: z.string().datetime({ offset: true }),
  mintedBy: z.string().nullable().default(null),
  lastUsedAt: z.string().datetime({ offset: true }).nullable().default(null),
  lastUsedBy: z.string().max(256).nullable().default(null),
});

const PeerEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(128),
  url: z.string().url(),
  outboundToken: z.string().min(16),
  addedAt: z.string().datetime({ offset: true }),
  lastSyncAt: z.string().datetime({ offset: true }).nullable().default(null),
  clockSkewMs: z.number().int().nullable().default(null),
  healthy: z.boolean().default(true),
});

const PeersStoreSchema = z.object({
  inboundTokens: z.array(InboundTokenSchema).default([]),
  peers: z.array(PeerEntrySchema).default([]),
});

const emptyStore = () => ({ inboundTokens: [], peers: [] });

const dirOf = path => path.slice(0, path.lastIndexOf('/'));

export const loadPeersStore = async path => {
  if (!path) {
    throw new Error('paths.peersStore is not configured');
  }
  if (!(await fileExists(path))) {
    return emptyStore();
  }
  const raw = await fs.readFile(path, 'utf8');
  if (raw.trim().length === 0) {
    return emptyStore();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warning('peers.json parse failed; treating as empty', { path, error: err.message });
    return emptyStore();
  }
  const result = PeersStoreSchema.safeParse(parsed);
  if (!result.success) {
    logger.warning('peers.json failed schema validation; treating as empty', {
      path,
      issues: result.error.issues,
    });
    return emptyStore();
  }
  return result.data;
};

export const savePeersStore = async (path, candidate) => {
  if (!path) {
    throw new Error('paths.peersStore is not configured');
  }
  const parsed = PeersStoreSchema.parse(candidate);
  const body = `${JSON.stringify(parsed, null, 2)}\n`;
  const dir = dirOf(path);
  if (dir) {
    await ensureDir(dir);
  }
  await writeAtomic(path, body, { mode: 0o600 });
  return parsed;
};

export const updatePeersStore = async (path, mutator) => {
  const current = await loadPeersStore(path);
  const next = await mutator(current);
  return savePeersStore(path, next);
};

// Token + id helpers. Tokens stay user-meaningful (32 random bytes hex);
// ids are short opaque strings used for revocation URLs.
export const mintToken = () => randomBytes(32).toString('hex');
const mintTokenId = () => `tk-${randomBytes(6).toString('hex')}`;
const mintPeerId = () => `peer-${randomBytes(6).toString('hex')}`;
const autoLabel = () => `token-${randomBytes(2).toString('hex')}`;

export const createInboundToken = ({ label = null, mintedBy = null } = {}) => ({
  id: mintTokenId(),
  token: mintToken(),
  label: label && label.trim().length > 0 ? label.trim() : autoLabel(),
  mintedAt: new Date().toISOString(),
  mintedBy,
  lastUsedAt: null,
  lastUsedBy: null,
});

export const createPeerEntry = ({ url, name, outboundToken }) => ({
  id: mintPeerId(),
  name,
  url,
  outboundToken,
  addedAt: new Date().toISOString(),
  lastSyncAt: null,
  clockSkewMs: null,
  healthy: true,
});

// Bearer-token lookup for incoming peer API calls. Returns the matching
// token entry or null. Caller can call recordInboundTokenUse to bump
// lastUsedAt / lastUsedBy after success.
export const findInboundTokenEntry = (store, token) => {
  if (!token) {
    return null;
  }
  return store.inboundTokens.find(t => t.token === token) ?? null;
};

// Fire-and-forget tracking — updates lastUsedAt / lastUsedBy on the matching
// token. Caller's mutator runs inside updatePeersStore.
export const markInboundTokenUsed = (store, tokenId, usedBy) => {
  const now = new Date().toISOString();
  return {
    ...store,
    inboundTokens: store.inboundTokens.map(t =>
      t.id === tokenId ? { ...t, lastUsedAt: now, lastUsedBy: usedBy ?? null } : t
    ),
  };
};

// Strip secrets from peer entries when serving them to UI callers. The
// outboundToken stays local — UI doesn't need it; only the server uses it
// to make outbound calls.
export const sanitizePeerForExport = peer => ({
  id: peer.id,
  name: peer.name,
  url: peer.url,
  addedAt: peer.addedAt,
  lastSyncAt: peer.lastSyncAt,
  clockSkewMs: peer.clockSkewMs,
  healthy: peer.healthy,
});

// Inbound tokens — list-view shape NEVER exposes the raw token. Operator
// got the token on the mint response (one-time copy banner). For visual
// disambiguation in the list we surface the first 8 hex chars only.
// Rotation = revoke + mint fresh; "I forgot to copy" is the same path.
export const sanitizeInboundTokenForExport = entry => ({
  id: entry.id,
  label: entry.label,
  tokenPreview: entry.token.slice(0, 8),
  mintedAt: entry.mintedAt,
  mintedBy: entry.mintedBy,
  lastUsedAt: entry.lastUsedAt,
  lastUsedBy: entry.lastUsedBy,
});

// The mint response — one-time exposure of the raw token alongside the id
// and metadata. Caller copies the token immediately; subsequent GETs never
// return it.
export const inboundTokenMintResponse = entry => ({
  id: entry.id,
  token: entry.token,
  label: entry.label,
  mintedAt: entry.mintedAt,
});
