import * as haproxyStats from './haproxy-stats.js';
import * as keepalivedControl from './keepalived-control.js';
import { loadNodeConfig } from './node-config.js';
import { loadState } from './state.js';

// Assembles the "what's happening on this node right now" snapshot used
// by the cross-cluster topology view. Each block degrades independently
// — if HAProxy is down but keepalived is up, the keepalived block still
// returns; the haproxy block reports its own error. Net effect: a peer
// snapshot endpoint always returns a 200 with a structured body, so the
// aggregator on the calling side can render partial state without
// special-casing entire-peer failures.
//
// Read-only — never mutates state. Safe to call from the peer-to-peer
// endpoint (peerAuth) and from any local-side aggregator that wants the
// same data shape.

const buildNodeBlock = async config => {
  try {
    const nodeConfig = await loadNodeConfig(config.paths.nodeConfig);
    return {
      nodeId: nodeConfig.nodeId,
      vrrp: nodeConfig.vrrp ?? {},
    };
  } catch (err) {
    return { nodeId: null, vrrp: {}, error: err.message };
  }
};

const buildHaproxyBlock = async config => {
  try {
    const info = await haproxyStats.showInfo(config.paths.haproxyStatsSocket);
    return {
      ok: true,
      alive: true,
      // Subset of `show info` fields that drive the cluster-node card.
      // Everything is a Number-or-zero so the UI never has to special-case
      // missing/non-numeric strings from older HAProxy versions.
      info: {
        Version: info.Version ?? null,
        Uptime: info.Uptime ?? null,
        CurrConns: Number(info.CurrConns) || 0,
        Maxconn: Number(info.Maxconn) || 0,
        Idle_pct: Number(info.Idle_pct) || 0,
        ConnRate: Number(info.ConnRate) || 0,
        SessRate: Number(info.SessRate) || 0,
        CumReq: Number(info.CumReq) || 0,
        CumConns: Number(info.CumConns) || 0,
        Nbthread: Number(info.Nbthread) || 0,
      },
    };
  } catch (err) {
    return { ok: false, alive: false, error: err.message };
  }
};

const buildKeepalivedBlock = async config => {
  try {
    const installed = await keepalivedControl.isInstalled({
      keepalivedBin: config.paths.keepalivedBin,
    });
    const strategy = await keepalivedControl.getStrategy();
    const alive = installed
      ? await keepalivedControl.isAlive({ pidPath: config.paths.keepalivedPidFile })
      : false;
    // VRRP instances come from state.json — failing to load state is
    // non-fatal for this block; we just report empty instances.
    const state = await loadState(config.paths.state).catch(() => null);
    const instances = (state?.keepalived?.instances ?? []).map(inst => ({
      id: inst.id,
      name: inst.name,
      vip: inst.vip,
      // MASTER/BACKUP per-instance state still needs a SIGUSR2 +
      // /tmp/keepalived.data parse (or DBus). Left null here; UI
      // consumers treat null as "unknown."
      state: null,
      holding: null,
    }));
    return { ok: true, installed, alive, strategy, instances };
  } catch (err) {
    return { ok: false, error: err.message };
  }
};

export const buildLocalSnapshot = async config => {
  const [node, haproxy, keepalived] = await Promise.all([
    buildNodeBlock(config),
    buildHaproxyBlock(config),
    buildKeepalivedBlock(config),
  ]);
  return {
    ts: new Date().toISOString(),
    node,
    haproxy,
    keepalived,
  };
};
