import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';

import yaml from 'js-yaml';
import { z } from 'zod';

import { ensureDir, fileExists, writeAtomic } from './files.js';
import * as logger from './logger.js';

// Per-node identity. Never syncs between cluster peers. Lives at
// `config.paths.nodeConfig` (default `/etc/patchpanel/node.yaml`).
//
// Shape:
//   nodeId: string                      ← human label for this box
//   vrrp:
//     <keepalivedInstanceId>:
//       priority: int (1..255)
//       state: MASTER | BACKUP          ← initial-state hint; VRRP elects by priority
//       interface: string (NIC name)
//
// If a keepalived instance defined in state has no entry in this map, the
// renderer skips emitting a vrrp_instance block for it on this node — i.e.
// "this node doesn't participate in that VIP."

const NodeVrrpEntrySchema = z.object({
  priority: z.number().int().min(1).max(255).default(100),
  state: z.enum(['MASTER', 'BACKUP']).default('BACKUP'),
  interface: z.string().min(1),
});

export const NodeConfigSchema = z.object({
  nodeId: z.string().min(1).max(128),
  vrrp: z.record(z.string(), NodeVrrpEntrySchema).default({}),
});

const defaultNodeConfig = () => ({
  nodeId: hostname() || 'patchpanel-node',
  vrrp: {},
});

export const loadNodeConfig = async path => {
  if (!path) {
    throw new Error('paths.nodeConfig is not configured');
  }
  if (!(await fileExists(path))) {
    return defaultNodeConfig();
  }
  const raw = await fs.readFile(path, 'utf8');
  if (raw.trim().length === 0) {
    return defaultNodeConfig();
  }
  const parsed = yaml.load(raw);
  const result = NodeConfigSchema.safeParse(parsed);
  if (!result.success) {
    logger.warning('node.yaml failed schema validation; using defaults', {
      path,
      issues: result.error.issues,
    });
    return defaultNodeConfig();
  }
  return result.data;
};

export const saveNodeConfig = async (path, candidate) => {
  if (!path) {
    throw new Error('paths.nodeConfig is not configured');
  }
  const parsed = NodeConfigSchema.parse(candidate);
  const body = yaml.dump(parsed, { lineWidth: 120, noRefs: true, sortKeys: false });
  // Ensure parent dir exists (postinst usually creates /etc/patchpanel but
  // we shouldn't assume; mode 0o644 matches config.yaml).
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) {
    await ensureDir(dir);
  }
  await writeAtomic(path, body, { mode: 0o644 });
  logger.info('node.yaml persisted', { path, nodeId: parsed.nodeId });
  return parsed;
};

export const initNodeConfigIfMissing = async path => {
  if (await fileExists(path)) {
    return loadNodeConfig(path);
  }
  const seed = defaultNodeConfig();
  await saveNodeConfig(path, seed);
  return seed;
};
