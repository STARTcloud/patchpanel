import { createConnection } from 'node:net';

const DEFAULT_TIMEOUT_MS = 10_000;

const send = (socketPath, command, timeoutMs) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy(new Error(`stats socket timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('connect', () => {
      socket.write(`${command}\n`);
    });
    socket.on('data', chunk => {
      chunks.push(chunk);
    });
    socket.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.once('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });

const parseStatRow = (header, line) => {
  const values = line.split(',');
  const record = {};
  for (let i = 0; i < header.length; i += 1) {
    record[header[i]] = values[i] ?? '';
  }
  return record;
};

export const showStat = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show stat', timeoutMs);
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const headerLine = lines[0].replace(/^#\s*/u, '');
  const header = headerLine.split(',');
  return lines.slice(1).map(line => parseStatRow(header, line));
};

export const showInfo = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show info', timeoutMs);
  const record = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    record[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return record;
};

export const setServerState = (socketPath, backend, server, state) => {
  if (!['ready', 'drain', 'maint'].includes(state)) {
    throw new Error(`invalid server state: ${state}`);
  }
  return send(socketPath, `set server ${backend}/${server} state ${state}`, DEFAULT_TIMEOUT_MS);
};

export const setServerWeight = (socketPath, backend, server, weight) => {
  if (!Number.isInteger(weight) || weight < 0 || weight > 256) {
    throw new Error(`invalid server weight: ${weight}`);
  }
  return send(socketPath, `set server ${backend}/${server} weight ${weight}`, DEFAULT_TIMEOUT_MS);
};

const SESSION_FIELD_RE = /(?<key>[a-zA-Z_]+)=(?<value>(?:"[^"]*"|\[[^\]]*\]|[^\s]+))/gu;
// Fallback for v6 addresses in formats like "[2001:db8::1]:443" anywhere in
// the session block — HAProxy 3.x sometimes only emits the source in a
// `[v6]:port` literal on a continuation line without a `src=` prefix.
const ADDR_PORT_RE =
  /(?<v4>(?<v4addr>\d+\.\d+\.\d+\.\d+):(?<v4port>\d+))|(?<v6>\[(?<v6addr>[0-9a-fA-F:]+)\]:(?<v6port>\d+))/u;

const parseSessionLine = line => {
  const sessionIdMatch = line.match(/^(?<id>0x[0-9a-fA-F]+):/u);
  const session = sessionIdMatch
    ? { sessionId: sessionIdMatch.groups.id, raw: line }
    : { raw: line };
  let match;

  while ((match = SESSION_FIELD_RE.exec(line)) !== null) {
    const { key, value } = match.groups;
    const cleaned = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    session[key] = cleaned;
  }
  if (!session.src && session.source) {
    session.src = session.source;
  }
  if (!session.fe && session.frontend) {
    session.fe = session.frontend;
  }
  if (!session.be && session.backend) {
    session.be = session.backend;
  }
  if (!session.src) {
    const fallback = line.match(ADDR_PORT_RE);
    if (fallback) {
      session.src =
        fallback.groups.v4 ??
        (fallback.groups.v6 ? `[${fallback.groups.v6addr}]:${fallback.groups.v6port}` : null);
    }
  }
  return session;
};

const parseSourceAddress = src => {
  if (!src) {
    return null;
  }
  // src looks like "10.0.0.1:54321" or "[2001:db8::1]:54321"
  const v6 = src.match(/^\[(?<addr>[0-9a-fA-F:]+)\]:(?<port>\d+)$/u);
  if (v6) {
    return { ip: v6.groups.addr, port: Number(v6.groups.port), family: 'inet6' };
  }
  const v4 = src.match(/^(?<addr>\d+\.\d+\.\d+\.\d+):(?<port>\d+)$/u);
  if (v4) {
    return { ip: v4.groups.addr, port: Number(v4.groups.port), family: 'inet' };
  }
  return { ip: src, port: null, family: 'unknown' };
};

export const showSessions = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show sess all', timeoutMs);
  const sessions = [];
  let current = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('0x') && line.includes(':')) {
      if (current) {
        sessions.push(parseSessionLine(current));
      }
      current = line;
    } else if (line.startsWith(' ') || line.startsWith('\t')) {
      current += ` ${line.trim()}`;
    }
  }
  if (current) {
    sessions.push(parseSessionLine(current));
  }
  // Per-session output also returns the raw block so the UI can offer a
  // "show raw" toggle when fields didn't parse (HAProxy session output
  // varies subtly between minor versions).
  return sessions.map(s => ({
    ...s,
    sourceParsed: parseSourceAddress(s.src),
  }));
};

export const showSessionsSummary = async (socketPath, opts) => {
  const sessions = await showSessions(socketPath, opts);
  const byClient = new Map();
  const byFrontend = new Map();
  const byBackend = new Map();
  for (const session of sessions) {
    const ip = session.sourceParsed?.ip ?? 'unknown';
    byClient.set(ip, (byClient.get(ip) ?? 0) + 1);
    if (session.fe) {
      byFrontend.set(session.fe, (byFrontend.get(session.fe) ?? 0) + 1);
    }
    if (session.be) {
      byBackend.set(session.be, (byBackend.get(session.be) ?? 0) + 1);
    }
  }
  const toSorted = m =>
    [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  return {
    totalSessions: sessions.length,
    topClients: toSorted(byClient).slice(0, 20),
    topFrontends: toSorted(byFrontend),
    topBackends: toSorted(byBackend),
    sessions,
  };
};

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/u;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9_.:/-]+$/u;

const assertSafeId = (value, label) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
};

const assertSafeKey = (value, label) => {
  if (typeof value !== 'string' || !SAFE_KEY_PATTERN.test(value)) {
    throw new Error(`invalid ${label}: ${value}`);
  }
};

export const showErrors = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show errors', timeoutMs);
  return { raw };
};

export const showResolvers = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show resolvers', timeoutMs);
  return { raw };
};

const parseTableHeader = headerLine => {
  // e.g. "# table: my_tbl, type: ip, size:200000, used:42"
  const cleaned = headerLine.replace(/^#\s*/u, '');
  const out = {};
  for (const pair of cleaned.split(',')) {
    const [k, v] = pair.split(':').map(s => (s ?? '').trim());
    if (k) {
      out[k] = v ?? '';
    }
  }
  return out;
};

const parseTableRow = line => {
  // e.g. "0x7f...: key=10.0.0.1 use=0 exp=29498 http_req_rate(10000)=5"
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const entry = { raw: trimmed, fields: {} };
  for (const pair of trimmed.split(/\s+/u)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const k = pair.slice(0, eq);
    const v = pair.slice(eq + 1);
    entry.fields[k] = v;
  }
  return entry;
};

export const showTables = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show table', timeoutMs);
  const tables = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('# table:')) {
      tables.push(parseTableHeader(line));
    }
  }
  return { tables };
};

export const showTable = async (socketPath, name, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeId(name, 'table name');
  const raw = await send(socketPath, `show table ${name}`, timeoutMs);
  let header = null;
  const entries = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('# table:')) {
      header = parseTableHeader(line);
      continue;
    }
    if (line.startsWith('#') || line.trim().length === 0) {
      continue;
    }
    const entry = parseTableRow(line);
    if (entry) {
      entries.push(entry);
    }
  }
  return { name, header, entries };
};

export const clearTable = (
  socketPath,
  name,
  key = null,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) => {
  assertSafeId(name, 'table name');
  if (key !== null) {
    assertSafeKey(key, 'table key');
  }
  const cmd = key === null ? `clear table ${name}` : `clear table ${name} key ${key}`;
  return send(socketPath, cmd, timeoutMs);
};

// HAProxy 3.x `show acl` / `show map` output looks like:
//   # id (file) description
//   0 () acl 'host_assistant' file '/etc/haproxy/haproxy.cfg' line 187
//   1 (/etc/haproxy/trusted.lst) loaded from file
// File-backed entries put the path inside the parens; inline entries leave
// the parens empty and put the source description (`acl 'X' file '<cfg>'
// line N`) after them. Both are captured here so the UI can render a useful
// label even when the file column is empty.
const parseAclMapList = raw => {
  const items = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^(?<id>\d+)\s*\((?<file>[^)]*)\)(?:\s+(?<description>.*))?$/u);
    if (match) {
      items.push({
        id: Number(match.groups.id),
        file: match.groups.file ?? '',
        description: (match.groups.description ?? '').trim(),
      });
    }
  }
  return items;
};

export const showAcls = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show acl', timeoutMs);
  return { acls: parseAclMapList(raw) };
};

export const showMaps = async (socketPath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const raw = await send(socketPath, 'show map', timeoutMs);
  return { maps: parseAclMapList(raw) };
};

// HAProxy expects `show acl #N` (with the `#` prefix) when referring to a
// numeric runtime id, or `show acl /path/to/file` when referring to a file
// path. Without the `#`, the socket replies with
// `Unknown ACL identifier. Please use #<id> or <file>.` Same rule applies to
// `show map`, `add acl`, `del acl`, `add map`, `del map`.
const NUMERIC_REF = /^\d+$/u;

const formatRef = ref => (NUMERIC_REF.test(ref) ? `#${ref}` : ref);

const parseAclEntries = raw => {
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^(?<id>0x[0-9a-fA-F]+)\s+(?<value>.*)$/u);
    if (match) {
      entries.push({ id: match.groups.id, value: match.groups.value });
    } else {
      entries.push({ id: null, value: trimmed });
    }
  }
  return entries;
};

const parseMapEntries = raw => {
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^(?<id>0x[0-9a-fA-F]+)\s+(?<key>\S+)\s+(?<value>.*)$/u);
    if (match) {
      entries.push({ id: match.groups.id, key: match.groups.key, value: match.groups.value });
    }
  }
  return entries;
};

export const showAclEntries = async (socketPath, ref, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeKey(ref, 'acl ref');
  const raw = await send(socketPath, `show acl ${formatRef(ref)}`, timeoutMs);
  return { entries: parseAclEntries(raw) };
};

export const showMapEntries = async (socketPath, ref, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeKey(ref, 'map ref');
  const raw = await send(socketPath, `show map ${formatRef(ref)}`, timeoutMs);
  return { entries: parseMapEntries(raw) };
};

export const addAclEntry = (socketPath, ref, value, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeKey(ref, 'acl ref');
  assertSafeKey(value, 'acl value');
  return send(socketPath, `add acl ${formatRef(ref)} ${value}`, timeoutMs);
};

export const delAclEntry = (socketPath, ref, value, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeKey(ref, 'acl ref');
  assertSafeKey(value, 'acl value');
  return send(socketPath, `del acl ${formatRef(ref)} ${value}`, timeoutMs);
};

export const addMapEntry = (
  socketPath,
  ref,
  key,
  value,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) => {
  assertSafeKey(ref, 'map ref');
  assertSafeKey(key, 'map key');
  // Value can contain spaces — caller is trusted but we sanitize control characters.
  if (typeof value !== 'string' || /[\r\n\0]/u.test(value)) {
    throw new Error('invalid map value');
  }
  return send(socketPath, `add map ${formatRef(ref)} ${key} ${value}`, timeoutMs);
};

export const delMapEntry = (socketPath, ref, key, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeKey(ref, 'map ref');
  assertSafeKey(key, 'map key');
  return send(socketPath, `del map ${formatRef(ref)} ${key}`, timeoutMs);
};

export const enableFrontend = (socketPath, name, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeId(name, 'frontend name');
  return send(socketPath, `enable frontend ${name}`, timeoutMs);
};

export const disableFrontend = (socketPath, name, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  assertSafeId(name, 'frontend name');
  return send(socketPath, `disable frontend ${name}`, timeoutMs);
};

export const shutdownSession = (socketPath, id, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (typeof id !== 'string' || !/^0x[0-9a-fA-F]+$/u.test(id)) {
    throw new Error(`invalid session id: ${id}`);
  }
  return send(socketPath, `shutdown session ${id}`, timeoutMs);
};

export const setMaxconnFrontend = (socketPath, name, max) => {
  assertSafeId(name, 'frontend name');
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`invalid maxconn: ${max}`);
  }
  return send(socketPath, `set maxconn frontend ${name} ${max}`, DEFAULT_TIMEOUT_MS);
};

export const setMaxconnGlobal = (socketPath, max) => {
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`invalid maxconn: ${max}`);
  }
  return send(socketPath, `set maxconn global ${max}`, DEFAULT_TIMEOUT_MS);
};

export const clearCounters = socketPath =>
  send(socketPath, 'clear counters all', DEFAULT_TIMEOUT_MS);
