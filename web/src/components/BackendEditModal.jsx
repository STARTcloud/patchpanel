import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';

import { genKey } from '../utils/keys.js';

import { ListEditor } from './ListEditor.jsx';
import { ReorderableTable } from './ReorderableTable.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const ADDR_PORT_REGEX = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/u;
const DURATION_REGEX = /^\d+(?:ms|s|m|h|d)$/u;

const stripInternal = obj => {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) {
      result[k] = v;
    }
  }
  return result;
};

const newServer = () => ({
  _key: genKey(),
  name: '',
  address: '',
  check: true,
  ssl: false,
  sslVerify: undefined,
  sni: undefined,
  cookie: '',
  weight: undefined,
  backup: false,
  maxconn: undefined,
  initAddr: [],
  advancedDirectives: [],
});

const emptyBackend = () => ({
  id: '',
  name: '',
  mode: 'http',
  balance: 'roundrobin',
  servers: [newServer()],
  options: [],
  stickTable: undefined,
  timeouts: {},
  httpReuse: undefined,
  forwardFor: false,
  retries: undefined,
  advancedDirectives: [],
});

const withServerKeys = backend => ({
  ...backend,
  servers: backend.servers.map(s => ({ ...s, _key: s._key ?? genKey() })),
});

const validateBackend = draft => {
  if (!ID_REGEX.test(draft.id)) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  if (!draft.name.trim()) {
    return 'name is required';
  }
  if (draft.servers.length === 0) {
    return 'at least one server is required';
  }
  for (const s of draft.servers) {
    if (!s.name.trim()) {
      return 'each server needs a name';
    }
    if (!ADDR_PORT_REGEX.test(s.address)) {
      return `server "${s.name}" needs a host:port address`;
    }
  }
  for (const [key, value] of Object.entries(draft.timeouts ?? {})) {
    if (value && !DURATION_REGEX.test(value)) {
      return `timeout.${key} must be like "30s" or "5m"`;
    }
  }
  return null;
};

const ServerRowActions = ({ row, ctx }) => (
  <Button
    variant="outline-danger"
    size="sm"
    type="button"
    onClick={() => ctx.onRemove(row._key)}
    disabled={ctx.totalServers === 1}
    title={ctx.totalServers === 1 ? 'A backend needs at least one server.' : ''}
  >
    ×
  </Button>
);

ServerRowActions.propTypes = {
  row: PropTypes.shape({ _key: PropTypes.string.isRequired }).isRequired,
  ctx: PropTypes.shape({
    onRemove: PropTypes.func.isRequired,
    totalServers: PropTypes.number.isRequired,
  }).isRequired,
};

const buildServerColumns = (updateServer, trustedCas) => [
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    accessor: row => row.name,
    render: row => (
      <Form.Control
        size="sm"
        value={row.name}
        onChange={e => updateServer(row._key, { ...row, name: e.target.value })}
      />
    ),
  },
  {
    key: 'address',
    label: 'Address',
    sortable: true,
    accessor: row => row.address,
    render: row => (
      <Form.Control
        size="sm"
        value={row.address}
        placeholder="host:port"
        onChange={e => updateServer(row._key, { ...row, address: e.target.value })}
      />
    ),
  },
  {
    key: 'check',
    label: 'Check',
    className: 'text-center',
    render: row => (
      <Form.Check
        type="switch"
        checked={row.check}
        onChange={e => updateServer(row._key, { ...row, check: e.target.checked })}
      />
    ),
  },
  {
    key: 'ssl',
    label: 'SSL',
    className: 'text-center',
    render: row => (
      <Form.Check
        type="switch"
        checked={row.ssl}
        onChange={e =>
          updateServer(row._key, {
            ...row,
            ssl: e.target.checked,
            sslVerify: e.target.checked ? (row.sslVerify ?? 'none') : undefined,
          })
        }
      />
    ),
  },
  {
    key: 'sslVerify',
    label: 'SSL verify',
    render: row =>
      row.ssl ? (
        <Form.Select
          size="sm"
          value={row.sslVerify ?? 'none'}
          onChange={e => updateServer(row._key, { ...row, sslVerify: e.target.value })}
        >
          <option value="none">none</option>
          <option value="required">required</option>
        </Form.Select>
      ) : (
        <span className="text-muted small">—</span>
      ),
  },
  {
    key: 'sni',
    label: 'SNI',
    render: row =>
      row.ssl ? (
        <Form.Control
          size="sm"
          value={row.sni ?? ''}
          placeholder="ssl_fc_sni"
          title="Optional. `ssl_fc_sni` forwards the inbound SNI verbatim; a literal hostname overrides it."
          onChange={e => updateServer(row._key, { ...row, sni: e.target.value || undefined })}
        />
      ) : (
        <span className="text-muted small">—</span>
      ),
  },
  {
    key: 'caTrustedCaId',
    label: 'CA file',
    render: row =>
      row.ssl ? (
        <Form.Select
          size="sm"
          value={row.caTrustedCaId ?? ''}
          title="Trusted CA bundle for upstream TLS verification. Only relevant when SSL verify is required."
          onChange={e =>
            updateServer(row._key, { ...row, caTrustedCaId: e.target.value || undefined })
          }
        >
          <option value="">(system default)</option>
          {trustedCas.map(ca => (
            <option key={ca.id} value={ca.id}>
              {ca.name} ({ca.id})
            </option>
          ))}
        </Form.Select>
      ) : (
        <span className="text-muted small">—</span>
      ),
  },
  {
    key: 'cookie',
    label: 'Cookie',
    render: row => (
      <Form.Control
        size="sm"
        value={row.cookie ?? ''}
        placeholder="cookie value"
        onChange={e => updateServer(row._key, { ...row, cookie: e.target.value || undefined })}
      />
    ),
  },
  {
    key: 'backup',
    label: 'Backup',
    className: 'text-center',
    render: row => (
      <Form.Check
        type="switch"
        checked={row.backup}
        onChange={e => updateServer(row._key, { ...row, backup: e.target.checked })}
      />
    ),
  },
];

export const BackendEditModal = ({ show, backend = null, trustedCas = [], onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => (backend ? withServerKeys(backend) : emptyBackend()));
  const [error, setError] = useState(null);

  const update = patch => setDraft(prev => ({ ...prev, ...patch }));
  const updateTimeouts = patch =>
    setDraft(prev => ({ ...prev, timeouts: { ...prev.timeouts, ...patch } }));
  const updateServer = (key, next) =>
    setDraft(prev => ({
      ...prev,
      servers: prev.servers.map(s => (s._key === key ? { ...next, _key: key } : s)),
    }));
  const removeServer = key =>
    setDraft(prev => ({ ...prev, servers: prev.servers.filter(s => s._key !== key) }));
  const addServer = () => setDraft(prev => ({ ...prev, servers: [...prev.servers, newServer()] }));
  const reorderServers = nextRows => setDraft(prev => ({ ...prev, servers: nextRows }));

  const handleSave = () => {
    const message = validateBackend(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave({
      ...draft,
      servers: draft.servers.map(stripInternal),
    });
  };

  const isExisting = Boolean(backend?.id);
  const timeouts = draft.timeouts ?? {};
  const serverColumns = buildServerColumns(updateServer, trustedCas);

  return (
    <Modal show={show} onHide={onCancel} size="xl">
      <Modal.Header closeButton>
        <Modal.Title>{isExisting ? `Edit backend: ${backend.name}` : 'New backend'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>ID</Form.Label>
              <Form.Control
                type="text"
                value={draft.id}
                disabled={isExisting}
                onChange={e => update({ id: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>Name (HAProxy directive)</Form.Label>
              <Form.Control
                type="text"
                value={draft.name}
                onChange={e => update({ name: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Mode</Form.Label>
              <Form.Select value={draft.mode} onChange={e => update({ mode: e.target.value })}>
                <option value="http">http</option>
                <option value="tcp">tcp</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>Balance</Form.Label>
              <Form.Select
                value={draft.balance}
                onChange={e => update({ balance: e.target.value })}
              >
                <option value="roundrobin">roundrobin</option>
                <option value="static-rr">static-rr</option>
                <option value="leastconn">leastconn</option>
                <option value="first">first</option>
                <option value="source">source</option>
                <option value="uri">uri</option>
                <option value="url_param">url_param</option>
                <option value="hdr">hdr</option>
                <option value="random">random</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col xs={12}>
            <h6 className="mb-1">Servers</h6>
            <p className="text-muted small mb-2">
              <strong>Order matters</strong> when <code>balance</code> is <code>static-rr</code> or{' '}
              <code>first</code>, and for the failover sequence among <code>backup</code> servers.
              Drag rows, use the arrows, or click a position badge to jump to a specific slot.
              Sorting by a column hides the drag handles — click the position header to clear the
              sort.
            </p>
            <ReorderableTable
              rows={draft.servers}
              rowKey={row => row._key}
              columns={serverColumns}
              searchFields={['name', 'address']}
              filterPlaceholder="Filter servers by name or address…"
              positionLabel="Order"
              reorderable
              onReorder={reorderServers}
              RowActions={ServerRowActions}
              rowActionsContext={{ onRemove: removeServer, totalServers: draft.servers.length }}
              emptyState="No servers yet."
              emptyFilteredState="No servers match the current filter."
            />
            <div className="mt-2">
              <Button variant="outline-primary" size="sm" type="button" onClick={addServer}>
                Add server
              </Button>
            </div>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>timeout connect</Form.Label>
              <Form.Control
                type="text"
                value={timeouts.connect ?? ''}
                placeholder="e.g. 30s"
                onChange={e => updateTimeouts({ connect: e.target.value || undefined })}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>timeout server</Form.Label>
              <Form.Control
                type="text"
                value={timeouts.server ?? ''}
                placeholder="e.g. 1m or 10m"
                onChange={e => updateTimeouts({ server: e.target.value || undefined })}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>http-reuse</Form.Label>
              <Form.Select
                value={draft.httpReuse ?? ''}
                onChange={e => update({ httpReuse: e.target.value || undefined })}
              >
                <option value="">(default)</option>
                <option value="never">never</option>
                <option value="safe">safe</option>
                <option value="aggressive">aggressive</option>
                <option value="always">always</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>retries</Form.Label>
              <Form.Control
                type="number"
                min={0}
                max={10}
                value={draft.retries ?? ''}
                onChange={e =>
                  update({
                    retries:
                      e.target.value === '' ? undefined : Number.parseInt(e.target.value, 10),
                  })
                }
              />
            </Form.Group>
          </Col>
          <Col md={4} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              label="option forwardfor"
              checked={draft.forwardFor}
              onChange={e => update({ forwardFor: e.target.checked })}
            />
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>options (one per line)</Form.Label>
              <ListEditor
                items={draft.options}
                onChange={list => update({ options: list })}
                placeholder="e.g. http-keep-alive"
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>Advanced HAProxy directives</Form.Label>
              <ListEditor
                items={draft.advancedDirectives}
                onChange={list => update({ advancedDirectives: list })}
                placeholder="raw HAProxy line to inject"
              />
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? 'Update backend' : 'Add backend'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

BackendEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  backend: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  }),
  trustedCas: PropTypes.array,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
