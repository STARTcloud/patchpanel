import PropTypes from 'prop-types';
import { useMemo } from 'react';
import { Badge, Dropdown, Table } from 'react-bootstrap';
import { Link } from 'react-router';

import { stateDocShape } from '../prop-shapes.js';

// Discoverability panel for the lf-file editor. Scans the current body for
// `%[token]` references, classifies each one, and reports whether the rest
// of the state graph has the supporting configuration so the token will
// actually be populated by HAProxy at serve time.
//
// Tokens fall into four buckets:
//   - built-in fetches (always work; no setup required)
//   - global directive (unique-id-format etc.)
//   - per-frontend capture (capture.req.hdr(N) needs N+1 captures on each
//     frontend that inherits the defaults block we're editing)
//   - rule set-var (var(SCOPE.NAME) needs a matching set-var rule on a
//     frontend that inherits the defaults block)
//
// "Consumer frontends" = state.frontends filtered to those whose
// `fromDefaults` field points at the defaults block being edited. That's
// the population that will actually serve error pages from this block.

const BUILTIN_TOKENS = new Set([
  'src',
  'dst',
  'date',
  'path',
  'url',
  'url_dec',
  'url_param',
  'method',
  'status',
  'base',
  'query',
  'pathq',
  'rt',
  'fe_name',
  'be_name',
  'srv_name',
  'be_server',
  'so_id',
  'ssl_fc',
  'ssl_fc_protocol',
  'ssl_fc_cipher',
  'ssl_fc_sni',
  'ssl_fc_alpn',
  'ssl_fc_session_id',
  'ssl_c_s_dn',
  'ssl_c_i_dn',
  'ssl_c_verify',
  'http_first_req',
  'last_rule_file',
  'last_rule_line',
  'body',
  'body_len',
  'req.len',
  'req.ver',
  'req.uri',
  'req.hdrs',
  'res.ver',
  'res.status',
  'res.hdrs',
  'cur_server',
  'cur_session',
  'unique-id',
  'ID',
]);

const PAREN_BUILTINS = new Set([
  'hdr',
  'req.hdr',
  'req.cook',
  'req.fhdr',
  'res.hdr',
  'res.cook',
  'res.fhdr',
  'cook',
  'cookie',
  'urlp',
  'urlp_val',
  'urlp_reg',
  'be_id_eq',
  'env',
]);

const TOKEN_RE = /%\[(?<token>[^\]]+)\]/gu;

const classifyToken = token => {
  const trimmed = token.trim();
  if (trimmed === 'unique-id' || trimmed === 'ID') {
    return { kind: 'unique-id', raw: trimmed };
  }
  if (BUILTIN_TOKENS.has(trimmed)) {
    return { kind: 'builtin', raw: trimmed };
  }
  const captureReq = trimmed.match(/^capture\.req\.hdr\((?<slot>\d+)\)$/u);
  if (captureReq) {
    return { kind: 'capture-req', raw: trimmed, slot: Number(captureReq.groups.slot) };
  }
  const captureRes = trimmed.match(/^capture\.res\.hdr\((?<slot>\d+)\)$/u);
  if (captureRes) {
    return { kind: 'capture-res', raw: trimmed, slot: Number(captureRes.groups.slot) };
  }
  const varMatch = trimmed.match(/^var\((?<varName>[^)]+)\)$/u);
  if (varMatch) {
    const parts = varMatch.groups.varName.split('.');
    const scope = parts.length > 1 ? parts[0] : 'txn';
    const name = parts.length > 1 ? parts.slice(1).join('.') : parts[0];
    return { kind: 'var', raw: trimmed, scope, name };
  }
  const paren = trimmed.match(/^(?<fn>[a-zA-Z_][a-zA-Z0-9_.]*)\(.+\)(?:,.+)?$/u);
  if (paren && PAREN_BUILTINS.has(paren.groups.fn)) {
    return { kind: 'builtin-paren', raw: trimmed, fetch: paren.groups.fn };
  }
  // The transformer pattern `fetch,transform` (e.g. `%[date,http_date]`).
  const transformed = trimmed.split(',')[0].trim();
  if (BUILTIN_TOKENS.has(transformed)) {
    return { kind: 'builtin', raw: trimmed };
  }
  return { kind: 'unknown', raw: trimmed };
};

const scanBody = body => {
  if (typeof body !== 'string' || body.length === 0) {
    return [];
  }
  const seen = new Map();
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(body);
  while (match !== null) {
    const classified = classifyToken(match.groups.token);
    if (!seen.has(classified.raw)) {
      seen.set(classified.raw, classified);
    }
    match = TOKEN_RE.exec(body);
  }
  return [...seen.values()];
};

const RULE_PHASE_KEYS = Object.freeze([
  'tcpRequestConnection',
  'tcpRequestSession',
  'tcpRequestContent',
  'httpRequest',
  'httpResponse',
  'httpAfterResponse',
  'tcpResponseContent',
]);

const collectConsumerFrontends = (doc, blockId) => {
  const frontends = doc?.frontends ?? [];
  return frontends.filter(fe => fe.fromDefaults === blockId);
};

const collectSetVarDefinitions = consumers => {
  const map = new Map();
  for (const fe of consumers) {
    for (const phase of RULE_PHASE_KEYS) {
      const rules = fe.rulePhases?.[phase] ?? [];
      for (const rule of rules) {
        if (rule.action?.type !== 'set-var') {
          continue;
        }
        if (rule.enabled === false) {
          continue;
        }
        const key = `${rule.action.scope}.${rule.action.name}`;
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key).push({ frontend: fe.name, phase, ruleId: rule.id });
      }
    }
  }
  return map;
};

const captureSlotAvailability = (consumers, dir, slot) => {
  const field = dir === 'req' ? 'captureRequestHeaders' : 'captureResponseHeaders';
  const ok = [];
  const missing = [];
  for (const fe of consumers) {
    const count = fe.httpOpts?.[field]?.length ?? 0;
    if (count > slot) {
      ok.push(fe.name);
    } else {
      missing.push({ name: fe.name, count });
    }
  }
  return { ok, missing };
};

const statusForToken = (classified, doc, consumers, varDefs) => {
  switch (classified.kind) {
    case 'builtin':
    case 'builtin-paren':
      return { level: 'ok', detail: 'built-in HAProxy fetch — always available.' };
    case 'unique-id': {
      const fmt = doc?.globalSettings?.uniqueIdFormat ?? '';
      if (fmt.length > 0) {
        return {
          level: 'ok',
          detail: `unique-id-format is set globally to "${fmt}".`,
          link: { to: '/global', label: 'Global Settings' },
        };
      }
      return {
        level: 'missing',
        detail: 'unique-id-format is empty — HAProxy will emit an empty unique id.',
        link: { to: '/global', label: 'Global Settings' },
      };
    }
    case 'capture-req':
    case 'capture-res': {
      if (consumers.length === 0) {
        return {
          level: 'missing',
          detail:
            'No frontend inherits this defaults block yet, so captures cannot exist anywhere.',
        };
      }
      const dir = classified.kind === 'capture-req' ? 'req' : 'res';
      const { ok, missing } = captureSlotAvailability(consumers, dir, classified.slot);
      if (missing.length === 0) {
        return {
          level: 'ok',
          detail: `slot ${classified.slot} available on all ${ok.length} consumer frontend(s): ${ok.join(', ')}`,
          link: { to: '/frontends', label: 'Frontends' },
        };
      }
      const okPart = ok.length > 0 ? `OK on: ${ok.join(', ')}. ` : '';
      const missList = missing
        .map(m => `${m.name} (${m.count} entr${m.count === 1 ? 'y' : 'ies'})`)
        .join(', ');
      return {
        level: 'missing',
        detail: `${okPart}Needs at least ${classified.slot + 1} capture ${dir === 'req' ? 'request' : 'response'} header(s) on: ${missList}`,
        link: { to: '/frontends', label: 'Frontends' },
      };
    }
    case 'var': {
      const key = `${classified.scope}.${classified.name}`;
      const defs = varDefs.get(key) ?? [];
      if (defs.length === 0) {
        return {
          level: 'missing',
          detail: `No set-var rule for var(${key}) found on any consumer frontend. Add an http-request set-var action.`,
          link: { to: '/rules', label: 'Rules' },
        };
      }
      const where = defs
        .map(d => `${d.frontend}:${d.phase}/${d.ruleId}`)
        .slice(0, 3)
        .join(', ');
      const extra = defs.length > 3 ? ` (+${defs.length - 3} more)` : '';
      return {
        level: 'ok',
        detail: `set by ${defs.length} rule(s): ${where}${extra}`,
        link: { to: '/rules', label: 'Rules' },
      };
    }
    case 'unknown':
    default:
      return {
        level: 'unknown',
        detail:
          "Unrecognized token — may still be a valid HAProxy fetch we don't know about. Verify against HAProxy 4.2.",
      };
  }
};

const STATUS_BADGES = Object.freeze({
  ok: { bg: 'success', icon: 'check-circle', label: 'OK' },
  missing: { bg: 'warning', icon: 'exclamation-triangle', label: 'Needs setup', text: 'dark' },
  unknown: { bg: 'secondary', icon: 'question-circle', label: 'Unknown' },
});

const QUICK_INSERT_GROUPS = Object.freeze([
  {
    label: 'Identity',
    items: [
      { token: '%[unique-id]', desc: 'request unique id (needs unique-id-format)' },
      { token: '%[src]', desc: 'client IP' },
      { token: '%[date]', desc: 'current epoch' },
      { token: '%[method]', desc: 'HTTP method' },
      { token: '%[path]', desc: 'request URI path' },
      { token: '%[status]', desc: 'response status code' },
    ],
  },
  {
    label: 'Headers',
    items: [
      { token: '%[hdr(host)]', desc: 'Host request header' },
      { token: '%[hdr(user-agent)]', desc: 'User-Agent request header' },
      { token: '%[capture.req.hdr(0)]', desc: 'first request capture slot' },
      { token: '%[capture.res.hdr(0)]', desc: 'first response capture slot' },
    ],
  },
  {
    label: 'TLS',
    items: [
      { token: '%[ssl_fc_protocol]', desc: 'TLS protocol version' },
      { token: '%[ssl_fc_cipher]', desc: 'TLS cipher suite' },
      { token: '%[ssl_fc_sni]', desc: 'SNI hostname' },
    ],
  },
  {
    label: 'Variables',
    items: [
      { token: '%[var(txn.request_id)]', desc: 'txn-scoped variable' },
      { token: '%[var(sess.user)]', desc: 'session-scoped variable' },
      { token: '%[var(req.scheme)]', desc: 'request-scoped variable' },
    ],
  },
]);

const QuickInsertDropdown = ({ onInsert, disabled }) => (
  <Dropdown size="sm">
    <Dropdown.Toggle variant="outline-secondary" size="sm" disabled={disabled}>
      <i className="bi bi-braces me-1" />
      Insert token
    </Dropdown.Toggle>
    <Dropdown.Menu style={{ maxHeight: '24rem', overflowY: 'auto' }}>
      {QUICK_INSERT_GROUPS.map(group => (
        <div key={group.label}>
          <Dropdown.Header>{group.label}</Dropdown.Header>
          {group.items.map(item => (
            <Dropdown.Item
              key={item.token}
              onClick={() => onInsert(item.token)}
              className="d-flex justify-content-between align-items-center gap-2"
            >
              <code style={{ fontSize: '0.78rem' }}>{item.token}</code>
              <span className="text-muted small" style={{ fontSize: '0.72rem' }}>
                {item.desc}
              </span>
            </Dropdown.Item>
          ))}
        </div>
      ))}
    </Dropdown.Menu>
  </Dropdown>
);

QuickInsertDropdown.propTypes = {
  onInsert: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

const TokenRow = ({ classified, status }) => {
  const badge = STATUS_BADGES[status.level] ?? STATUS_BADGES.unknown;
  return (
    <tr>
      <td>
        <code style={{ fontSize: '0.78rem' }}>%[{classified.raw}]</code>
      </td>
      <td>
        <Badge bg={badge.bg} text={badge.text}>
          <i className={`bi bi-${badge.icon} me-1`} />
          {badge.label}
        </Badge>
      </td>
      <td className="small">
        {status.detail}
        {status.link ? (
          <>
            {' '}
            <Link to={status.link.to} className="text-decoration-none">
              {status.link.label} →
            </Link>
          </>
        ) : null}
      </td>
    </tr>
  );
};

TokenRow.propTypes = {
  classified: PropTypes.shape({
    raw: PropTypes.string.isRequired,
    kind: PropTypes.string.isRequired,
  }).isRequired,
  status: PropTypes.shape({
    level: PropTypes.oneOf(['ok', 'missing', 'unknown']).isRequired,
    detail: PropTypes.string.isRequired,
    link: PropTypes.shape({
      to: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    }),
  }).isRequired,
};

export const TokenReferencePanel = ({ body, doc, blockId, onInsert }) => {
  const consumers = useMemo(() => collectConsumerFrontends(doc, blockId), [doc, blockId]);
  const varDefs = useMemo(() => collectSetVarDefinitions(consumers), [consumers]);
  const found = useMemo(() => scanBody(body), [body]);
  const rows = useMemo(
    () =>
      found.map(classified => ({
        classified,
        status: statusForToken(classified, doc, consumers, varDefs),
      })),
    [found, doc, consumers, varDefs]
  );

  const counts = useMemo(() => {
    const c = { ok: 0, missing: 0, unknown: 0 };
    for (const row of rows) {
      c[row.status.level] += 1;
    }
    return c;
  }, [rows]);

  return (
    <div className="mt-3">
      <div className="d-flex justify-content-between align-items-center mb-2 gap-2 flex-wrap">
        <span className="small fw-semibold text-muted text-uppercase">Tokens in this body</span>
        <QuickInsertDropdown onInsert={onInsert} disabled={!onInsert} />
      </div>
      {rows.length === 0 ? (
        <div className="small text-muted">
          No <code>%[token]</code> references found in the body.
        </div>
      ) : (
        <>
          <div className="small text-muted mb-2 d-flex gap-3 flex-wrap">
            <span>
              <Badge bg="success">{counts.ok}</Badge> OK
            </span>
            <span>
              <Badge bg="warning" text="dark">
                {counts.missing}
              </Badge>{' '}
              need setup
            </span>
            <span>
              <Badge bg="secondary">{counts.unknown}</Badge> unknown
            </span>
            <span className="ms-auto">
              Consumer frontends: <strong>{consumers.length}</strong>
              {consumers.length > 0 ? ` (${consumers.map(f => f.name).join(', ')})` : ''}
            </span>
          </div>
          <Table size="sm" responsive className="mb-2 small">
            <thead>
              <tr>
                <th style={{ width: '14rem' }}>Token</th>
                <th style={{ width: '7rem' }}>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <TokenRow
                  key={row.classified.raw}
                  classified={row.classified}
                  status={row.status}
                />
              ))}
            </tbody>
          </Table>
        </>
      )}
      <details className="small">
        <summary className="text-muted">Reference: what configures each token kind</summary>
        <div className="ps-3 pt-2">
          <p className="mb-1">
            <Badge bg="success" className="me-1">
              built-in
            </Badge>
            HAProxy sample fetches (<code>%[src]</code>, <code>%[date]</code>,{' '}
            <code>%[hdr(NAME)]</code>, <code>%[ssl_fc_*]</code>, <code>%[path]</code>,{' '}
            <code>%[method]</code>, <code>%[status]</code>, …). No setup required.
          </p>
          <p className="mb-1">
            <Badge bg="primary" className="me-1">
              global
            </Badge>
            <code>%[unique-id]</code> requires <code>unique-id-format</code> set in{' '}
            <Link to="/global">Global Settings</Link>. patchpanel defaults to the canonical hex
            format.
          </p>
          <p className="mb-1">
            <Badge bg="info" className="me-1">
              per-frontend
            </Badge>
            <code>%[capture.req.hdr(N)]</code> / <code>%[capture.res.hdr(N)]</code> require{' '}
            <code>captureRequestHeaders[]</code> / <code>captureResponseHeaders[]</code> on each
            frontend that inherits this defaults block — slot index is 0-based and matches the entry
            order in the capture array. Edit on{' '}
            <Link to="/frontends">Frontends → HTTP options → Capture</Link>.
          </p>
          <p className="mb-0">
            <Badge bg="warning" text="dark" className="me-1">
              rule
            </Badge>
            <code>%[var(SCOPE.NAME)]</code> requires an <code>http-request set-var</code> rule on a
            consumer frontend with the same scope + name, fired before the response. Edit on{' '}
            <Link to="/rules">Rules</Link>.
          </p>
        </div>
      </details>
    </div>
  );
};

TokenReferencePanel.propTypes = {
  body: PropTypes.string.isRequired,
  doc: stateDocShape.isRequired,
  blockId: PropTypes.string.isRequired,
  onInsert: PropTypes.func,
};
