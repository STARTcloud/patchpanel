import { networkInterfaces } from 'node:os';

// Drop interface name patterns that are useless for binding HAProxy. The
// vast majority of these are virtual ethernet pairs created by container
// runtimes / overlay networks — their addresses are link-local IPv6 only
// and pointing HAProxy at them is never what the operator wants.
const DROP_NAME =
  /^(?:veth|br-[a-f0-9]+|cni|lxc|weave|flannel|cilium|cali|fwbr|fwln|fwpr|tap|tun|vnet|tailscale|nodebr|cni-podman)/iu;

// Recognize physical / management NICs vs container bridges so the picker
// can group them visually. Anything that passes the DROP filter but isn't
// in one of these patterns falls into "Other".
const PUBLIC_NIC =
  /^(?:eth|enp|eno|ens|em|wlan|wlp|wlo|bond|bridge[0-9]+|br[0-9]+|lan|wan|management)/iu;
const CONTAINER_BRIDGE = /^(?:docker[0-9]*|hassio|podman[0-9]*|br-[a-zA-Z][a-zA-Z0-9_-]*)$/iu;

// IPv4 APIPA range — addresses self-assigned when DHCP fails. Almost never
// what you want to bind to.
const isApipa = ip => ip.startsWith('169.254.');

// Loopback addresses — surfaced as sentinels in the UI instead, so we don't
// duplicate them in the per-interface list.
const isLoopback = (ip, family) => {
  if (family === 'ipv4') {
    return ip.startsWith('127.');
  }
  return ip === '::1';
};

const familyOf = entry => {
  // Node 18+ reports family as 'IPv4'/'IPv6'; older sometimes 4/6 numerics.
  const raw = String(entry.family).toLowerCase();
  if (raw === 'ipv4' || raw === '4') {
    return 'ipv4';
  }
  return 'ipv6';
};

const scopeOf = entry => {
  const family = familyOf(entry);
  if (family === 'ipv6' && entry.address.toLowerCase().startsWith('fe80')) {
    return 'link';
  }
  if (entry.internal) {
    return 'host';
  }
  return 'global';
};

const classifyInterface = name => {
  if (DROP_NAME.test(name)) {
    return 'drop';
  }
  if (PUBLIC_NIC.test(name)) {
    return 'public';
  }
  if (CONTAINER_BRIDGE.test(name)) {
    return 'bridge';
  }
  return 'other';
};

const bucketForClassification = classification => {
  if (classification === 'drop') {
    return 'filtered';
  }
  if (classification === 'public') {
    return 'public';
  }
  if (classification === 'bridge') {
    return 'bridge';
  }
  return 'other';
};

// Decide whether one (name, entry) pair survives the filters, and which
// bucket it lands in if so. Returns one of:
//   { kind: 'keep',  bucket, record }   — kept, surface in this group
//   { kind: 'drop' }                    — silently dropped (APIPA / loopback)
//   { kind: 'count' }                   — counted in `filtered` but not surfaced
const evaluateEntry = ({ name, entry, classification, showFiltered }) => {
  const family = familyOf(entry);
  if (isApipa(entry.address) || isLoopback(entry.address, family)) {
    return { kind: 'drop' };
  }
  const scope = scopeOf(entry);
  if (scope === 'link' && !showFiltered) {
    return { kind: 'count' };
  }
  const record = {
    ip: entry.address,
    interface: name,
    family,
    scope,
    cidr: entry.cidr ?? null,
  };
  return { kind: 'keep', bucket: bucketForClassification(classification), record };
};

const buildGroups = (buckets, showFiltered) => {
  const groups = [];
  if (buckets.public.length > 0 || buckets.other.length > 0) {
    groups.push({
      label: "This node's interfaces",
      addresses: [...buckets.public, ...buckets.other],
    });
  }
  if (buckets.bridge.length > 0) {
    groups.push({ label: 'Container bridges', addresses: buckets.bridge });
  }
  if (showFiltered && buckets.filtered.length > 0) {
    groups.push({ label: 'Filtered (virtual / overlay)', addresses: buckets.filtered });
  }
  return groups;
};

export const enumerateInterfaces = ({ showFiltered = false } = {}) => {
  const raw = networkInterfaces();
  const buckets = { public: [], bridge: [], other: [], filtered: [] };
  let droppedCount = 0;

  for (const [name, entries] of Object.entries(raw)) {
    const classification = classifyInterface(name);
    if (classification === 'drop' && !showFiltered) {
      droppedCount += (entries ?? []).length;
      continue;
    }
    for (const entry of entries ?? []) {
      const result = evaluateEntry({ name, entry, classification, showFiltered });
      if (result.kind === 'count') {
        droppedCount += 1;
      } else if (result.kind === 'keep') {
        buckets[result.bucket].push(result.record);
      }
    }
  }

  return {
    groups: buildGroups(buckets, showFiltered),
    filtered: droppedCount,
  };
};
