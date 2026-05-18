import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

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

const validateBackend = (draft, t) => {
  if (!ID_REGEX.test(draft.id)) {
    return t(
      'haproxy:backend.errors.idFormat',
      'id must match a-z, 0-9, _, - (starting with a letter)'
    );
  }
  if (!draft.name.trim()) {
    return t('haproxy:backend.errors.nameRequired', 'name is required');
  }
  if (draft.servers.length === 0) {
    return t('haproxy:backend.errors.minServers', 'at least one server is required');
  }
  for (const s of draft.servers) {
    if (!s.name.trim()) {
      return t('haproxy:backend.errors.serverNameRequired', 'each server needs a name');
    }
    if (!ADDR_PORT_REGEX.test(s.address)) {
      return t(
        'haproxy:backend.errors.serverAddrRequired',
        'server "{{name}}" needs a host:port address',
        { name: s.name }
      );
    }
  }
  for (const [key, value] of Object.entries(draft.timeouts ?? {})) {
    if (value && !DURATION_REGEX.test(value)) {
      return t(
        'haproxy:backend.errors.timeoutFormat',
        'timeout.{{key}} must be like "30s" or "5m"',
        { key }
      );
    }
  }
  return null;
};

const ServerRowActions = ({ row, ctx }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <Button
      variant="outline-danger"
      size="sm"
      type="button"
      onClick={() => ctx.onRemove(row._key)}
      disabled={ctx.totalServers === 1}
      title={
        ctx.totalServers === 1
          ? t('haproxy:backend.servers.minServerTitle', 'A backend needs at least one server.')
          : ''
      }
    >
      ×
    </Button>
  );
};

ServerRowActions.propTypes = {
  row: PropTypes.shape({ _key: PropTypes.string.isRequired }).isRequired,
  ctx: PropTypes.shape({
    onRemove: PropTypes.func.isRequired,
    totalServers: PropTypes.number.isRequired,
  }).isRequired,
};

const buildServerColumns = (updateServer, trustedCas, t) => [
  {
    key: 'name',
    label: t('haproxy:backend.servers.name', 'Name'),
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
    label: t('haproxy:backend.servers.address', 'Address'),
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
    label: t('haproxy:backend.servers.check', 'Check'),
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
    label: t('haproxy:backend.servers.ssl', 'SSL'),
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
    label: t('haproxy:backend.servers.sslVerify', 'SSL verify'),
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
    label: t('haproxy:backend.servers.sni', 'SNI'),
    render: row =>
      row.ssl ? (
        <Form.Control
          size="sm"
          value={row.sni ?? ''}
          placeholder="ssl_fc_sni"
          title={t(
            'haproxy:backend.servers.sniTitle',
            'Optional. ssl_fc_sni forwards the inbound SNI verbatim; a literal hostname overrides it.'
          )}
          onChange={e => updateServer(row._key, { ...row, sni: e.target.value || undefined })}
        />
      ) : (
        <span className="text-muted small">—</span>
      ),
  },
  {
    key: 'caTrustedCaId',
    label: t('haproxy:backend.servers.caFile', 'CA file'),
    render: row =>
      row.ssl ? (
        <Form.Select
          size="sm"
          value={row.caTrustedCaId ?? ''}
          title={t(
            'haproxy:backend.servers.caFileTitle',
            'Trusted CA bundle for upstream TLS verification. Only relevant when SSL verify is required.'
          )}
          onChange={e =>
            updateServer(row._key, { ...row, caTrustedCaId: e.target.value || undefined })
          }
        >
          <option value="">({t('haproxy:backend.servers.systemDefault', 'system default')})</option>
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
    label: t('haproxy:backend.servers.cookie', 'Cookie'),
    render: row => (
      <Form.Control
        size="sm"
        value={row.cookie ?? ''}
        placeholder={t('haproxy:backend.servers.cookiePlaceholder', 'cookie value')}
        onChange={e => updateServer(row._key, { ...row, cookie: e.target.value || undefined })}
      />
    ),
  },
  {
    key: 'backup',
    label: t('haproxy:backend.servers.backup', 'Backup'),
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
  const { t } = useTranslation(['haproxy', 'common']);
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
    const message = validateBackend(draft, t);
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
  const serverColumns = buildServerColumns(updateServer, trustedCas, t);

  return (
    <Modal show={show} onHide={onCancel} size="xl">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('haproxy:backend.edit.editTitle', 'Edit backend: {{name}}', { name: backend.name })
            : t('haproxy:backend.edit.newTitle', 'New backend')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>{t('haproxy:backend.edit.id', 'ID')}</Form.Label>
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
              <Form.Label>{t('haproxy:backend.edit.name', 'Name (HAProxy directive)')}</Form.Label>
              <Form.Control
                type="text"
                value={draft.name}
                onChange={e => update({ name: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>{t('haproxy:backend.edit.mode', 'Mode')}</Form.Label>
              <Form.Select value={draft.mode} onChange={e => update({ mode: e.target.value })}>
                <option value="http">http</option>
                <option value="tcp">tcp</option>
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={2}>
            <Form.Group>
              <Form.Label>{t('haproxy:backend.edit.balance', 'Balance')}</Form.Label>
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
            <h6 className="mb-1">{t('haproxy:backend.servers.title', 'Servers')}</h6>
            <p className="text-muted small mb-2">
              {t(
                'haproxy:backend.servers.help',
                'Order matters when balance is static-rr or first, and for the failover sequence among backup servers. Drag rows, use the arrows, or click a position badge to jump to a specific slot. Sorting by a column hides the drag handles — click the position header to clear the sort.'
              )}
            </p>
            <ReorderableTable
              rows={draft.servers}
              rowKey={row => row._key}
              columns={serverColumns}
              searchFields={['name', 'address']}
              filterPlaceholder={t(
                'haproxy:backend.servers.filter',
                'Filter servers by name or address…'
              )}
              positionLabel={t('haproxy:common.order', 'Order')}
              reorderable
              onReorder={reorderServers}
              RowActions={ServerRowActions}
              rowActionsContext={{ onRemove: removeServer, totalServers: draft.servers.length }}
              emptyState={t('haproxy:backend.servers.empty', 'No servers yet.')}
              emptyFilteredState={t(
                'haproxy:backend.servers.emptyFiltered',
                'No servers match the current filter.'
              )}
            />
            <div className="mt-2">
              <Button variant="outline-primary" size="sm" type="button" onClick={addServer}>
                {t('haproxy:backend.servers.add', 'Add server')}
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
                <option value="">({t('haproxy:common.default', 'default')})</option>
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
              <Form.Label>{t('haproxy:backend.edit.options', 'options (one per line)')}</Form.Label>
              <ListEditor
                items={draft.options}
                onChange={list => update({ options: list })}
                placeholder="e.g. http-keep-alive"
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>
                {t('haproxy:backend.edit.advanced', 'Advanced HAProxy directives')}
              </Form.Label>
              <ListEditor
                items={draft.advancedDirectives}
                onChange={list => update({ advancedDirectives: list })}
                placeholder={t(
                  'haproxy:backend.edit.advancedPlaceholder',
                  'raw HAProxy line to inject'
                )}
              />
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting
            ? t('haproxy:backend.edit.update', 'Update backend')
            : t('haproxy:backend.edit.add', 'Add backend')}
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
