// Parse the stderr emitted by `haproxy -c -f <cfg>` and turn each diagnostic
// line into a structured hint. When a candidate state document is available
// we also resolve the named HAProxy entity (backend, server) back to a
// patchpanel state id so the UI can offer a quick-fix link.
//
// Example diagnostic lines we handle:
//   [ALERT] (123) : config : parsing [/tmp/haproxy.cfg:42] : 'use_backend' : unknown backend 'foo' referenced.
//   [ALERT] (123) : config : parsing [/tmp/haproxy.cfg:88] : Proxy 'be_default' : in 'server' line, server 'srv1' has no port.
//   [WARNING] (123) : config : parsing [/tmp/haproxy.cfg:55] : 'server' line missing for backend 'foo'.

const LINE_RE =
  /^\[(?<severity>ALERT|WARNING|NOTICE)\]\s+(?:\(\d+\)\s+:\s+)?config\s+:\s+parsing\s+\[(?<file>[^:\]]+):(?<line>\d+)\]\s+:\s+(?<rest>.+)$/u;

const ENTITY_PATTERNS = Object.freeze([
  { kind: 'backend', re: /\bbackend\s+'(?<name>[^']+)'/u },
  { kind: 'frontend', re: /\bfrontend\s+'(?<name>[^']+)'/u },
  { kind: 'server', re: /\bserver\s+'(?<name>[^']+)'/u },
  { kind: 'proxy', re: /\bProxy\s+'(?<name>[^']+)'/u },
  { kind: 'acl', re: /\bacl\s+'(?<name>[^']+)'/u },
]);

const findEntity = rest => {
  for (const { kind, re } of ENTITY_PATTERNS) {
    const match = rest.match(re);
    if (match) {
      return { kind, name: match.groups.name };
    }
  }
  return null;
};

const resolveBackendByName = (state, name) => {
  const found = state?.backends?.find(b => b.name === name);
  return found ? { kind: 'backend', id: found.id, label: found.name } : null;
};

const resolveServerByName = (state, name) => {
  for (const backend of state?.backends ?? []) {
    const server = backend.servers?.find(s => s.name === name);
    if (server) {
      return { kind: 'server', backendId: backend.id, serverName: server.name };
    }
  }
  return null;
};

const resolveAclByName = (state, name) => {
  const found = (state?.acls ?? []).find(a => a.name === name);
  return found ? { kind: 'acl', id: found.id, label: found.name } : null;
};

const resolveEntity = (state, entity) => {
  if (!entity || !state) {
    return null;
  }
  if (entity.kind === 'backend' || entity.kind === 'proxy') {
    return resolveBackendByName(state, entity.name);
  }
  if (entity.kind === 'server') {
    return resolveServerByName(state, entity.name);
  }
  if (entity.kind === 'acl') {
    return resolveAclByName(state, entity.name);
  }
  return null;
};

export const parseValidationOutput = (stderr, state = null) => {
  if (!stderr || typeof stderr !== 'string') {
    return [];
  }
  const hints = [];
  for (const raw of stderr.split('\n')) {
    const match = raw.match(LINE_RE);
    if (!match) {
      continue;
    }
    const { severity, line, rest } = match.groups;
    const entity = findEntity(rest);
    const ref = resolveEntity(state, entity);
    hints.push({
      severity,
      line: Number(line),
      message: rest.trim(),
      entity: entity ?? null,
      ref,
      raw: raw.trim(),
    });
  }
  return hints;
};
