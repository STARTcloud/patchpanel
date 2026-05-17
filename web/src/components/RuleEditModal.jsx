import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Col, Dropdown, Form, Modal, Row } from 'react-bootstrap';

import { ListEditor } from './ListEditor.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const VAR_SCOPES = ['proc', 'sess', 'txn', 'req', 'res'];
const LOG_LEVELS = [
  'silent',
  'emerg',
  'alert',
  'crit',
  'err',
  'warning',
  'notice',
  'info',
  'debug',
];
const NORMALIZE_METHODS = [
  'path-merge-slashes',
  'path-strip-dot',
  'path-strip-dotdot',
  'fragment-encode',
  'fragment-strip',
  'percent-decode-unreserved',
  'percent-to-uppercase',
  'query-sort-by-name',
];
const REDIRECT_TYPES = ['location', 'prefix', 'scheme'];

const ACTIONS_BY_PHASE = Object.freeze({
  httpRequest: [
    'allow',
    'deny',
    'reject',
    'tarpit',
    'redirect',
    'use-backend',
    'use-service',
    'set-header',
    'add-header',
    'del-header',
    'replace-header',
    'replace-value',
    'set-var',
    'unset-var',
    'set-path',
    'set-uri',
    'set-query',
    'set-method',
    'set-log-level',
    'silent-drop',
    'track-sc',
    'capture',
    'lua',
    'auth',
    'return',
    'normalize-uri',
    'wait-for-body',
    'early-hint',
    'do-resolve',
    'sc-inc-gpc',
    'apply-security-profile',
    'apply-auth-provider',
  ],
  httpResponse: [
    'allow',
    'deny',
    'set-status',
    'set-header',
    'add-header',
    'del-header',
    'replace-header',
    'replace-value',
    'set-var',
    'unset-var',
    'set-log-level',
    'silent-drop',
    'lua',
    'return',
    'redirect',
    'capture',
  ],
  httpAfterResponse: [
    'allow',
    'deny',
    'set-status',
    'set-header',
    'add-header',
    'del-header',
    'replace-header',
    'replace-value',
    'set-var',
    'unset-var',
    'set-log-level',
    'lua',
  ],
  tcpRequestConnection: [
    'accept',
    'reject',
    'set-var',
    'unset-var',
    'track-sc',
    'silent-drop',
    'set-mark',
    'set-tos',
    'sc-inc-gpc',
  ],
  tcpRequestSession: ['accept', 'reject', 'set-var', 'unset-var', 'track-sc', 'silent-drop'],
  tcpRequestContent: [
    'accept',
    'reject',
    'set-var',
    'unset-var',
    'track-sc',
    'silent-drop',
    'lua',
    'use-service',
    'do-resolve',
    'set-priority-class',
    'set-priority-offset',
    'set-mark',
    'set-tos',
  ],
  tcpResponseContent: ['accept', 'reject', 'close', 'set-var', 'unset-var', 'lua', 'silent-drop'],
});

const ACL_OPERATORS = [
  '',
  'str',
  'sub',
  'beg',
  'end',
  'reg',
  'dir',
  'dom',
  'len',
  'bin',
  'found',
  'ip',
  'int',
  'gt',
  'lt',
  'ge',
  'le',
  'eq',
  'ne',
  'bool',
];

const FIELD_PRESETS = [
  { group: 'Common', fields: ['hdr', 'path', 'method', 'url', 'query', 'urlp', 'base'] },
  { group: 'Network', fields: ['src', 'dst', 'src_port', 'dst_port'] },
  {
    group: 'TLS',
    fields: ['ssl_fc', 'ssl_fc_sni', 'ssl_c_used', 'ssl_c_s_dn', 'ssl_c_san', 'ssl_fc_alpn'],
  },
  { group: 'Request', fields: ['req.hdr', 'req.fhdr', 'req.cook', 'req.body'] },
  { group: 'Response', fields: ['res.hdr', 'res.fhdr', 'res.cook', 'res.body', 'res.status'] },
  { group: 'Variables', fields: ['var', 'sc_http_req_rate', 'sc_conn_rate', 'sc_http_err_rate'] },
];

const ACTION_DEFAULT_FIELDS = Object.freeze({
  redirect: { redirectType: 'location', target: '' },
  'use-backend': { backendId: '' },
  'use-service': { serviceName: '' },
  'set-header': { name: '', value: '' },
  'add-header': { name: '', value: '' },
  'del-header': { name: '' },
  'replace-header': { name: '', matchRegex: '', replacement: '' },
  'replace-value': { name: '', matchRegex: '', replacement: '' },
  'set-var': { scope: 'txn', name: '', expression: '' },
  'unset-var': { scope: 'txn', name: '' },
  'set-path': { expression: '' },
  'set-uri': { expression: '' },
  'set-query': { expression: '' },
  'set-method': { expression: '' },
  'set-log-level': { level: 'info' },
  'set-status': { statusCode: 200 },
  'set-mark': { mark: '' },
  'set-tos': { tos: '' },
  'set-priority-class': { value: 0 },
  'set-priority-offset': { value: 0 },
  'track-sc': { scIndex: 0, key: 'src', table: '' },
  capture: { expression: '', len: 256 },
  lua: { function: '', args: [] },
  return: { headers: [] },
  'normalize-uri': { method: 'path-merge-slashes' },
  'wait-for-body': { time: '5s' },
  'early-hint': { name: '', value: '' },
  'do-resolve': { varScope: 'txn', varName: '', resolvers: '', expression: '' },
  'sc-inc-gpc': { gpcIndex: 0, scIndex: 0 },
  'apply-security-profile': { profileId: '' },
  'apply-auth-provider': { providerId: '' },
});

const defaultActionFor = type => ({ type, ...(ACTION_DEFAULT_FIELDS[type] ?? {}) });

const SimpleNameValue = ({ action, update }) => (
  <>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Header name</Form.Label>
        <Form.Control
          value={action.name ?? ''}
          onChange={e => update({ name: e.target.value })}
          placeholder="X-Forwarded-For"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Value</Form.Label>
        <Form.Control
          value={action.value ?? ''}
          onChange={e => update({ value: e.target.value })}
          placeholder='log-format ok, e.g. "%[src]"'
        />
      </Form.Group>
    </Col>
  </>
);

SimpleNameValue.propTypes = {
  action: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const renderDenyOrTarpit = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Status code (optional)</Form.Label>
      <Form.Control
        type="number"
        min={400}
        max={599}
        value={action.statusCode ?? ''}
        onChange={e =>
          update({
            statusCode: e.target.value === '' ? undefined : Number(e.target.value),
          })
        }
        placeholder="403"
      />
    </Form.Group>
  </Col>
);

const renderRedirect = (action, update) => (
  <>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Type</Form.Label>
        <Form.Select
          value={action.redirectType ?? 'location'}
          onChange={e => update({ redirectType: e.target.value })}
        >
          {REDIRECT_TYPES.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Target</Form.Label>
        <Form.Control
          value={action.target ?? ''}
          onChange={e => update({ target: e.target.value })}
          placeholder={action.redirectType === 'scheme' ? 'https' : 'https://example.com/...'}
        />
      </Form.Group>
    </Col>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Code</Form.Label>
        <Form.Select
          value={action.code ?? ''}
          onChange={e =>
            update({ code: e.target.value === '' ? undefined : Number(e.target.value) })
          }
        >
          <option value="">(default 302)</option>
          <option value="301">301</option>
          <option value="302">302</option>
          <option value="303">303</option>
          <option value="307">307</option>
          <option value="308">308</option>
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={4} className="d-flex align-items-end">
      <Form.Check
        type="switch"
        id="redir-drop-query"
        label="drop-query"
        checked={Boolean(action.dropQueryString)}
        onChange={e => update({ dropQueryString: e.target.checked })}
      />
    </Col>
    <Col md={4} className="d-flex align-items-end">
      <Form.Check
        type="switch"
        id="redir-append-slash"
        label="append-slash"
        checked={Boolean(action.appendSlash)}
        onChange={e => update({ appendSlash: e.target.checked })}
      />
    </Col>
  </>
);

const renderUseBackend = (action, update, doc) => (
  <Col md={8}>
    <Form.Group>
      <Form.Label>Backend</Form.Label>
      <Form.Select
        value={action.backendId ?? ''}
        onChange={e => update({ backendId: e.target.value })}
      >
        <option value="">— choose —</option>
        {(doc.backends ?? []).map(b => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.id})
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  </Col>
);

const renderUseService = (action, update) => (
  <Col md={8}>
    <Form.Group>
      <Form.Label>Service name</Form.Label>
      <Form.Control
        value={action.serviceName ?? ''}
        onChange={e => update({ serviceName: e.target.value })}
        placeholder="prometheus-exporter"
      />
    </Form.Group>
  </Col>
);

const renderSimpleNameValue = (action, update) => (
  <SimpleNameValue action={action} update={update} />
);

const renderDelHeader = (action, update) => (
  <Col md={6}>
    <Form.Group>
      <Form.Label>Header name</Form.Label>
      <Form.Control value={action.name ?? ''} onChange={e => update({ name: e.target.value })} />
    </Form.Group>
  </Col>
);

const renderReplaceHeaderOrValue = (action, update) => (
  <>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Header</Form.Label>
        <Form.Control value={action.name ?? ''} onChange={e => update({ name: e.target.value })} />
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Match regex</Form.Label>
        <Form.Control
          value={action.matchRegex ?? ''}
          onChange={e => update({ matchRegex: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Replacement</Form.Label>
        <Form.Control
          value={action.replacement ?? ''}
          onChange={e => update({ replacement: e.target.value })}
        />
      </Form.Group>
    </Col>
  </>
);

const renderSetVar = (action, update) => (
  <>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Scope</Form.Label>
        <Form.Select
          value={action.scope ?? 'txn'}
          onChange={e => update({ scope: e.target.value })}
        >
          {VAR_SCOPES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Name</Form.Label>
        <Form.Control value={action.name ?? ''} onChange={e => update({ name: e.target.value })} />
      </Form.Group>
    </Col>
    <Col md={5}>
      <Form.Group>
        <Form.Label>Expression</Form.Label>
        <Form.Control
          value={action.expression ?? ''}
          onChange={e => update({ expression: e.target.value })}
          placeholder="str(...) or %[fetch]"
        />
      </Form.Group>
    </Col>
  </>
);

const renderUnsetVar = (action, update) => (
  <>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Scope</Form.Label>
        <Form.Select
          value={action.scope ?? 'txn'}
          onChange={e => update({ scope: e.target.value })}
        >
          {VAR_SCOPES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Name</Form.Label>
        <Form.Control value={action.name ?? ''} onChange={e => update({ name: e.target.value })} />
      </Form.Group>
    </Col>
  </>
);

const renderExpressionOnly = (action, update) => (
  <Col md={8}>
    <Form.Group>
      <Form.Label>Expression</Form.Label>
      <Form.Control
        value={action.expression ?? ''}
        onChange={e => update({ expression: e.target.value })}
      />
    </Form.Group>
  </Col>
);

const renderLogLevel = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Level</Form.Label>
      <Form.Select value={action.level ?? 'info'} onChange={e => update({ level: e.target.value })}>
        {LOG_LEVELS.map(l => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  </Col>
);

const renderSetStatus = (action, update) => (
  <>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Status code</Form.Label>
        <Form.Control
          type="number"
          min={100}
          max={599}
          value={action.statusCode ?? 200}
          onChange={e => update({ statusCode: Number(e.target.value) })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Reason (optional)</Form.Label>
        <Form.Control
          value={action.reason ?? ''}
          onChange={e => update({ reason: e.target.value || undefined })}
        />
      </Form.Group>
    </Col>
  </>
);

const renderMark = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Mark</Form.Label>
      <Form.Control value={action.mark ?? ''} onChange={e => update({ mark: e.target.value })} />
    </Form.Group>
  </Col>
);

const renderTos = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>ToS</Form.Label>
      <Form.Control value={action.tos ?? ''} onChange={e => update({ tos: e.target.value })} />
    </Form.Group>
  </Col>
);

const renderPriority = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Value</Form.Label>
      <Form.Control
        type="number"
        value={action.value ?? 0}
        onChange={e => update({ value: Number(e.target.value) })}
      />
    </Form.Group>
  </Col>
);

const renderTrackSc = (action, update) => (
  <>
    <Col md={2}>
      <Form.Group>
        <Form.Label>sc#</Form.Label>
        <Form.Control
          type="number"
          min={0}
          max={31}
          value={action.scIndex ?? 0}
          onChange={e => update({ scIndex: Number(e.target.value) })}
        />
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Key (expression)</Form.Label>
        <Form.Control value={action.key ?? 'src'} onChange={e => update({ key: e.target.value })} />
      </Form.Group>
    </Col>
    <Col md={5}>
      <Form.Group>
        <Form.Label>Table</Form.Label>
        <Form.Control
          value={action.table ?? ''}
          onChange={e => update({ table: e.target.value })}
          placeholder="st_rl_my_profile"
        />
      </Form.Group>
    </Col>
  </>
);

const renderCapture = (action, update) => (
  <>
    <Col md={8}>
      <Form.Group>
        <Form.Label>Expression</Form.Label>
        <Form.Control
          value={action.expression ?? ''}
          onChange={e => update({ expression: e.target.value })}
          placeholder="req.hdr(User-Agent)"
        />
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Length (bytes)</Form.Label>
        <Form.Control
          type="number"
          min={1}
          value={action.len ?? 256}
          onChange={e => update({ len: Number(e.target.value) })}
        />
      </Form.Group>
    </Col>
  </>
);

const renderLua = (action, update) => (
  <>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Function name</Form.Label>
        {/* `function` is a reserved word — accessing/assigning it via dot or
            bare-key inside an arrow body confuses CodeQL's JS parser (the JSX
            expression brace + reserved-word key looks like a function
            expression to it). Bracket notation sidesteps that without
            touching the underlying state-schema property name. */}
        <Form.Control
          value={action.function ?? ''}
          onChange={e => update({ ['function']: e.target.value })}
          placeholder="my_lua_fn"
        />
      </Form.Group>
    </Col>
    <Col md={8}>
      <Form.Group>
        <Form.Label>Args</Form.Label>
        <ListEditor
          items={action.args ?? []}
          onChange={list => update({ args: list })}
          placeholder="positional argument"
        />
      </Form.Group>
    </Col>
  </>
);

const renderAuth = (action, update) => (
  <Col md={6}>
    <Form.Group>
      <Form.Label>Realm (optional)</Form.Label>
      <Form.Control
        value={action.realm ?? ''}
        onChange={e => update({ realm: e.target.value || undefined })}
      />
    </Form.Group>
  </Col>
);

const renderNormalizeUri = (action, update) => (
  <Col md={6}>
    <Form.Group>
      <Form.Label>Method</Form.Label>
      <Form.Select
        value={action.method ?? 'path-merge-slashes'}
        onChange={e => update({ method: e.target.value })}
      >
        {NORMALIZE_METHODS.map(m => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Form.Select>
    </Form.Group>
  </Col>
);

const renderWaitForBody = (action, update) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Time</Form.Label>
      <Form.Control value={action.time ?? '5s'} onChange={e => update({ time: e.target.value })} />
    </Form.Group>
  </Col>
);

const renderScIncGpc = (action, update) => (
  <>
    <Col md={3}>
      <Form.Group>
        <Form.Label>gpc#</Form.Label>
        <Form.Control
          type="number"
          min={0}
          max={2}
          value={action.gpcIndex ?? 0}
          onChange={e => update({ gpcIndex: Number(e.target.value) })}
        />
      </Form.Group>
    </Col>
    <Col md={3}>
      <Form.Group>
        <Form.Label>sc#</Form.Label>
        <Form.Control
          type="number"
          min={0}
          max={31}
          value={action.scIndex ?? 0}
          onChange={e => update({ scIndex: Number(e.target.value) })}
        />
      </Form.Group>
    </Col>
  </>
);

const renderApplySecurityProfile = (action, update, doc) => (
  <Col md={8}>
    <Form.Group>
      <Form.Label>Security profile</Form.Label>
      <Form.Select
        value={action.profileId ?? ''}
        onChange={e => update({ profileId: e.target.value })}
      >
        <option value="">— choose —</option>
        {(doc.securityProfiles ?? []).map(p => (
          <option key={p.id} value={p.id}>
            {p.kind}: {p.label} ({p.id})
          </option>
        ))}
      </Form.Select>
      <Form.Text className="text-muted">
        Sugar action — expands at render-time into the profile&apos;s deny + track-sc chain gated on
        this rule&apos;s condition.
      </Form.Text>
    </Form.Group>
  </Col>
);

const renderApplyAuthProvider = (action, update, doc) => (
  <Col md={8}>
    <Form.Group>
      <Form.Label>Auth provider</Form.Label>
      <Form.Select
        value={action.providerId ?? ''}
        onChange={e => update({ providerId: e.target.value })}
      >
        <option value="">— choose —</option>
        {(doc.authProviders ?? []).map(p => (
          <option key={p.id} value={p.id}>
            {p.type}: {p.id}
          </option>
        ))}
      </Form.Select>
      <Form.Text className="text-muted">
        Sugar action — expands at render-time into the provider&apos;s auth chain gated on this
        rule&apos;s condition.
      </Form.Text>
    </Form.Group>
  </Col>
);

const renderDoResolve = (action, update) => (
  <>
    <Col md={2}>
      <Form.Group>
        <Form.Label>Var scope</Form.Label>
        <Form.Select
          value={action.varScope ?? 'txn'}
          onChange={e => update({ varScope: e.target.value })}
        >
          {VAR_SCOPES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Var name</Form.Label>
        <Form.Control
          value={action.varName ?? ''}
          onChange={e => update({ varName: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={3}>
      <Form.Group>
        <Form.Label>Resolvers</Form.Label>
        <Form.Control
          value={action.resolvers ?? ''}
          onChange={e => update({ resolvers: e.target.value })}
          placeholder="mydns"
        />
      </Form.Group>
    </Col>
    <Col md={2}>
      <Form.Group>
        <Form.Label>Family</Form.Label>
        <Form.Select
          value={action.family ?? ''}
          onChange={e => update({ family: e.target.value || undefined })}
        >
          <option value="">(any)</option>
          <option value="ipv4">ipv4</option>
          <option value="ipv6">ipv6</option>
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={2}>
      <Form.Group>
        <Form.Label>Expression</Form.Label>
        <Form.Control
          value={action.expression ?? ''}
          onChange={e => update({ expression: e.target.value })}
        />
      </Form.Group>
    </Col>
  </>
);

const BODY_KIND_OPTIONS = ['string', 'lf-string', 'file', 'lf-file'];

const newHeaderKey = () => `h-${Math.random().toString(36).slice(2, 11)}`;

const ReturnFields = ({ action, update }) => {
  const body = action.body ?? null;
  const headers = action.headers ?? [];
  const [headerKeys, setHeaderKeys] = useState(() => headers.map(() => newHeaderKey()));

  const setBodyKind = kind => {
    if (!kind) {
      update({ body: undefined });
    } else {
      update({ body: { kind, content: body?.content ?? '' } });
    }
  };

  const addHeader = () => {
    update({ headers: [...headers, { name: '', value: '' }] });
    setHeaderKeys(prev => [...prev, newHeaderKey()]);
  };
  const updateHeader = (idx, patch) => {
    update({ headers: headers.map((h, i) => (i === idx ? { ...h, ...patch } : h)) });
  };
  const removeHeader = idx => {
    update({ headers: [...headers.slice(0, idx), ...headers.slice(idx + 1)] });
    setHeaderKeys(prev => [...prev.slice(0, idx), ...prev.slice(idx + 1)]);
  };

  return (
    <>
      <Col md={3}>
        <Form.Group>
          <Form.Label>Status code</Form.Label>
          <Form.Control
            type="number"
            min={100}
            max={599}
            value={action.statusCode ?? ''}
            onChange={e =>
              update({
                statusCode: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
            placeholder="200"
          />
        </Form.Group>
      </Col>
      <Col md={5}>
        <Form.Group>
          <Form.Label>Content-Type</Form.Label>
          <Form.Control
            value={action.contentType ?? ''}
            onChange={e => update({ contentType: e.target.value || undefined })}
            placeholder="text/plain; charset=utf-8"
          />
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>Body kind</Form.Label>
          <Form.Select value={body?.kind ?? ''} onChange={e => setBodyKind(e.target.value || null)}>
            <option value="">(no body)</option>
            {BODY_KIND_OPTIONS.map(k => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      </Col>
      {body ? (
        <Col xs={12}>
          <Form.Group>
            <Form.Label>Body content</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={body.content ?? ''}
              onChange={e => update({ body: { ...body, content: e.target.value } })}
              placeholder={
                body.kind?.endsWith('file')
                  ? '/etc/haproxy/errors/tpl/503.http'
                  : 'Inline body text'
              }
            />
          </Form.Group>
        </Col>
      ) : null}
      <Col xs={12}>
        <Form.Group>
          <Form.Label>Extra response headers</Form.Label>
          {headers.length === 0 ? (
            <p className="text-muted small mb-2">No extra headers.</p>
          ) : (
            headers.map((header, idx) => (
              <div key={headerKeys[idx]} className="d-flex gap-2 mb-2">
                <Form.Control
                  size="sm"
                  placeholder="Header name"
                  value={header.name ?? ''}
                  onChange={e => updateHeader(idx, { name: e.target.value })}
                />
                <Form.Control
                  size="sm"
                  placeholder="Value"
                  value={header.value ?? ''}
                  onChange={e => updateHeader(idx, { value: e.target.value })}
                />
                <Button variant="outline-danger" size="sm" onClick={() => removeHeader(idx)}>
                  ×
                </Button>
              </div>
            ))
          )}
          <Button variant="outline-primary" size="sm" type="button" onClick={addHeader}>
            <i className="bi bi-plus-lg me-1" />
            Add header
          </Button>
        </Form.Group>
      </Col>
    </>
  );
};

ReturnFields.propTypes = {
  action: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const renderReturn = (action, update) => <ReturnFields action={action} update={update} />;

const NO_FIELD_ACTIONS = new Set(['allow', 'reject', 'accept', 'close', 'silent-drop']);

const ACTION_FIELD_RENDERERS = Object.freeze({
  deny: renderDenyOrTarpit,
  tarpit: renderDenyOrTarpit,
  redirect: renderRedirect,
  'use-backend': renderUseBackend,
  'use-service': renderUseService,
  'set-header': renderSimpleNameValue,
  'add-header': renderSimpleNameValue,
  'del-header': renderDelHeader,
  'replace-header': renderReplaceHeaderOrValue,
  'replace-value': renderReplaceHeaderOrValue,
  'set-var': renderSetVar,
  'unset-var': renderUnsetVar,
  'set-path': renderExpressionOnly,
  'set-uri': renderExpressionOnly,
  'set-query': renderExpressionOnly,
  'set-method': renderExpressionOnly,
  'set-log-level': renderLogLevel,
  'set-status': renderSetStatus,
  'set-mark': renderMark,
  'set-tos': renderTos,
  'set-priority-class': renderPriority,
  'set-priority-offset': renderPriority,
  'track-sc': renderTrackSc,
  capture: renderCapture,
  lua: renderLua,
  auth: renderAuth,
  return: renderReturn,
  'normalize-uri': renderNormalizeUri,
  'wait-for-body': renderWaitForBody,
  'early-hint': renderSimpleNameValue,
  'sc-inc-gpc': renderScIncGpc,
  'apply-security-profile': renderApplySecurityProfile,
  'apply-auth-provider': renderApplyAuthProvider,
  'do-resolve': renderDoResolve,
});

const renderActionFields = (action, update, doc) => {
  if (NO_FIELD_ACTIONS.has(action.type)) {
    return null;
  }
  const renderer = ACTION_FIELD_RENDERERS[action.type];
  if (!renderer) {
    return (
      <Col xs={12}>
        <Alert variant="warning" className="small mb-0">
          No editor for action <code>{action.type}</code> yet.
        </Alert>
      </Col>
    );
  }
  return renderer(action, update, doc);
};

const ConditionTermRow = ({ term, idx, total, doc, onChange, onRemove }) => {
  const updateTerm = patch => onChange(idx, { ...term, ...patch });
  const isAclRef = term.kind === 'aclRef';

  return (
    <div className="border rounded p-2 mb-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <Badge bg="secondary">#{idx + 1}</Badge>
        <div className="d-flex gap-2 align-items-center">
          <Form.Check
            type="switch"
            id={`term-${idx}-negate`}
            label="NOT"
            checked={Boolean(term.negate)}
            onChange={e => updateTerm({ negate: e.target.checked })}
          />
          <Button variant="outline-danger" size="sm" onClick={onRemove}>
            ×
          </Button>
        </div>
      </div>
      <Row className="g-2">
        <Col md={2}>
          <Form.Group>
            <Form.Label>Type</Form.Label>
            <Form.Select
              value={term.kind}
              onChange={e => {
                const nextKind = e.target.value;
                if (nextKind === 'aclRef') {
                  onChange(idx, {
                    kind: 'aclRef',
                    aclName: '',
                    negate: term.negate ?? false,
                    combineWithNext: term.combineWithNext ?? 'and',
                  });
                } else {
                  onChange(idx, {
                    kind: 'inline',
                    field: 'hdr',
                    fieldArg: 'host',
                    operator: 'str',
                    values: [],
                    caseInsensitive: true,
                    noDnsLookup: false,
                    negate: term.negate ?? false,
                    combineWithNext: term.combineWithNext ?? 'and',
                  });
                }
              }}
            >
              <option value="aclRef">ACL ref</option>
              <option value="inline">Inline match</option>
            </Form.Select>
          </Form.Group>
        </Col>
        {isAclRef ? (
          <Col md={10}>
            <Form.Group>
              <Form.Label>ACL</Form.Label>
              <Form.Select
                value={term.aclName ?? ''}
                onChange={e => updateTerm({ aclName: e.target.value })}
              >
                <option value="">— choose —</option>
                {(doc.acls ?? []).map(a => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
        ) : (
          <>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Field</Form.Label>
                <Form.Select
                  value={term.field ?? ''}
                  onChange={e => updateTerm({ field: e.target.value })}
                >
                  {FIELD_PRESETS.map(grp => (
                    <optgroup key={grp.group} label={grp.group}>
                      {grp.fields.map(f => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Arg</Form.Label>
                <Form.Control
                  value={term.fieldArg ?? ''}
                  onChange={e => updateTerm({ fieldArg: e.target.value })}
                  placeholder="(none)"
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Op</Form.Label>
                <Form.Select
                  value={term.operator ?? ''}
                  onChange={e => updateTerm({ operator: e.target.value || undefined })}
                >
                  {ACL_OPERATORS.map(op => (
                    <option key={op} value={op}>
                      {op || '(none)'}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>Values</Form.Label>
                <ListEditor
                  items={term.values ?? []}
                  onChange={list => updateTerm({ values: list })}
                  placeholder="value"
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>Flags</Form.Label>
                <div className="d-flex flex-column gap-1">
                  <Form.Check
                    type="switch"
                    id={`term-${idx}-ci`}
                    label="-i"
                    checked={Boolean(term.caseInsensitive)}
                    onChange={e => updateTerm({ caseInsensitive: e.target.checked })}
                  />
                  <Form.Check
                    type="switch"
                    id={`term-${idx}-no-dns`}
                    label="-n"
                    checked={Boolean(term.noDnsLookup)}
                    onChange={e => updateTerm({ noDnsLookup: e.target.checked })}
                  />
                </div>
              </Form.Group>
            </Col>
          </>
        )}
      </Row>
      {idx < total - 1 ? (
        <div className="mt-2 d-flex align-items-center gap-2">
          <span className="text-muted small">Combine with next:</span>
          <Dropdown>
            <Dropdown.Toggle
              size="sm"
              variant={term.combineWithNext === 'or' ? 'outline-info' : 'outline-primary'}
            >
              {term.combineWithNext === 'or' ? 'OR (||)' : 'AND (space)'}
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => updateTerm({ combineWithNext: 'and' })}>
                AND (space)
              </Dropdown.Item>
              <Dropdown.Item onClick={() => updateTerm({ combineWithNext: 'or' })}>
                OR (||)
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      ) : null}
    </div>
  );
};

ConditionTermRow.propTypes = {
  term: PropTypes.object.isRequired,
  idx: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  doc: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const renderTermPreview = term => {
  if (term.kind === 'aclRef') {
    return term.negate ? `!${term.aclName || '?'}` : term.aclName || '?';
  }
  const parts = [];
  let f = term.field;
  if (term.fieldArg) {
    f += `(${term.fieldArg})`;
  }
  parts.push(f);
  if (term.operator && term.operator !== 'bool') {
    parts.push(`-m ${term.operator}`);
  }
  if (term.caseInsensitive) {
    parts.push('-i');
  }
  if (term.noDnsLookup) {
    parts.push('-n');
  }
  if (term.values && term.values.length > 0) {
    parts.push(...term.values);
  }
  const body = `{ ${parts.join(' ')} }`;
  return term.negate ? `!${body}` : body;
};

const renderConditionPreview = condition => {
  if (!condition || condition.length === 0) {
    return '';
  }
  let out = renderTermPreview(condition[0]);
  for (let i = 1; i < condition.length; i += 1) {
    const join = condition[i - 1].combineWithNext === 'or' ? ' || ' : ' ';
    out += join + renderTermPreview(condition[i]);
  }
  return out;
};

const emptyRule = phase => ({
  id: '',
  name: '',
  enabled: true,
  action: defaultActionFor(ACTIONS_BY_PHASE[phase][0]),
  condition: [],
});

const newTermKey = () => `t-${Math.random().toString(36).slice(2, 11)}`;

export const RuleEditModal = ({ show, phase, rule = null, doc, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => rule ?? emptyRule(phase));
  const [termKeys, setTermKeys] = useState(() => (rule?.condition ?? []).map(() => newTermKey()));
  const [error, setError] = useState(null);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const setActionType = nextType => {
    setDraft(prev => ({ ...prev, action: defaultActionFor(nextType) }));
  };

  const updateActionFields = patch =>
    setDraft(prev => ({ ...prev, action: { ...prev.action, ...patch } }));

  const updateTerm = (idx, next) => {
    setDraft(prev => ({
      ...prev,
      condition: prev.condition.map((t, i) => (i === idx ? next : t)),
    }));
  };

  const addTerm = kind => {
    setDraft(prev => {
      const seed =
        kind === 'aclRef'
          ? { kind: 'aclRef', aclName: '', negate: false, combineWithNext: 'and' }
          : {
              kind: 'inline',
              field: 'hdr',
              fieldArg: 'host',
              operator: 'str',
              values: [],
              caseInsensitive: true,
              noDnsLookup: false,
              negate: false,
              combineWithNext: 'and',
            };
      return { ...prev, condition: [...prev.condition, seed] };
    });
    setTermKeys(prev => [...prev, newTermKey()]);
  };

  const removeTerm = idx => {
    setDraft(prev => ({
      ...prev,
      condition: [...prev.condition.slice(0, idx), ...prev.condition.slice(idx + 1)],
    }));
    setTermKeys(prev => [...prev.slice(0, idx), ...prev.slice(idx + 1)]);
  };

  const handleSave = () => {
    if (!ID_REGEX.test(draft.id ?? '')) {
      setError('id must match a-z, 0-9, _, - (starting with a letter)');
      return;
    }
    onSave(draft);
  };

  const isExisting = Boolean(rule?.id);
  const availableActions = ACTIONS_BY_PHASE[phase] ?? [];
  const conditionPreview = renderConditionPreview(draft.condition);

  return (
    <Modal show={show} onHide={onCancel} size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting ? `Edit rule: ${rule.name ?? rule.id}` : 'New rule'}{' '}
          <Badge bg="secondary" className="ms-2">
            {phase}
          </Badge>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-2 mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>ID</Form.Label>
              <Form.Control
                value={draft.id}
                disabled={isExisting}
                onChange={e => update({ id: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Name (display)</Form.Label>
              <Form.Control
                value={draft.name ?? ''}
                onChange={e => update({ name: e.target.value || undefined })}
                placeholder="Friendly name"
              />
            </Form.Group>
          </Col>
          <Col md={2} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              id="rule-enabled"
              label="Enabled"
              checked={draft.enabled !== false}
              onChange={e => update({ enabled: e.target.checked })}
            />
          </Col>
        </Row>

        <h6 className="text-muted text-uppercase small">Action</h6>
        <Row className="g-2 mb-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>Action type</Form.Label>
              <Form.Select value={draft.action.type} onChange={e => setActionType(e.target.value)}>
                {availableActions.map(a => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          {renderActionFields(draft.action, updateActionFields, doc)}
        </Row>

        <h6 className="text-muted text-uppercase small">
          Condition
          <span className="text-muted small ms-2 fst-italic">
            (empty = always; terms join with AND by default, switch to OR per row)
          </span>
        </h6>
        {draft.condition.length === 0 ? (
          <p className="text-muted small">No condition — rule fires unconditionally.</p>
        ) : (
          draft.condition.map((term, idx) => (
            <ConditionTermRow
              key={termKeys[idx]}
              term={term}
              idx={idx}
              total={draft.condition.length}
              doc={doc}
              onChange={updateTerm}
              onRemove={() => removeTerm(idx)}
            />
          ))
        )}
        <div className="d-flex gap-2 mb-3">
          <Button variant="outline-primary" size="sm" onClick={() => addTerm('aclRef')}>
            <i className="bi bi-plus-lg me-1" />
            Add ACL ref
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={() => addTerm('inline')}>
            <i className="bi bi-plus-lg me-1" />
            Add inline match
          </Button>
        </div>

        <h6 className="text-muted text-uppercase small">Condition preview</h6>
        <pre
          className="border rounded p-2 bg-body-tertiary mb-0"
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85rem' }}
        >
          {conditionPreview ? `if ${conditionPreview}` : '(always)'}
        </pre>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? 'Update' : 'Add'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

RuleEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  phase: PropTypes.string.isRequired,
  rule: PropTypes.object,
  doc: PropTypes.object.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
