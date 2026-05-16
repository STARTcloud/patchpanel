import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';

import { apiPost } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';
import { genKey } from '../utils/keys.js';

const TYPE_LABELS = Object.freeze({
  'ha-notify': 'Home Assistant notify service',
  webhook: 'Generic webhook',
  discord: 'Discord webhook',
  ntfy: 'ntfy.sh',
  slack: 'Slack webhook',
});

const SEVERITIES = Object.freeze(['info', 'success', 'warning', 'error']);

const EVENTS = Object.freeze([
  'cert.renewed',
  'cert.renewal-failed',
  'cert.expiring-soon',
  'haproxy.reload',
  'haproxy.reload-failed',
  'state.applied',
  'state.restored',
  'backend.down',
  'test',
]);

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const emptyChannel = () => ({
  id: '',
  label: '',
  type: 'ha-notify',
  enabled: true,
  events: [],
  minSeverity: 'info',
  config: { service: 'persistent_notification.create' },
});

const validateChannel = draft => {
  if (!ID_REGEX.test(draft.id)) {
    return 'id must be lowercase a-z, digits, _ or - (start with letter)';
  }
  if (!draft.label.trim()) {
    return 'label is required';
  }
  if (draft.type === 'webhook' && !draft.config?.url) {
    return 'webhook needs a url';
  }
  if (draft.type === 'discord' && !draft.config?.webhookUrl) {
    return 'discord needs a webhookUrl';
  }
  if (draft.type === 'slack' && !draft.config?.webhookUrl) {
    return 'slack needs a webhookUrl';
  }
  if (draft.type === 'ntfy' && !draft.config?.topic) {
    return 'ntfy needs a topic';
  }
  return null;
};

const TypeConfigForm = ({ type, config, onChange }) => {
  switch (type) {
    case 'ha-notify':
      return (
        <Form.Group>
          <Form.Label>HA service (e.g. notify.notify, persistent_notification.create)</Form.Label>
          <Form.Control
            type="text"
            value={config.service ?? ''}
            onChange={e => onChange({ ...config, service: e.target.value })}
          />
          <Form.Text className="text-muted">
            The addon calls <code>POST /core/api/services/&lt;domain&gt;/&lt;name&gt;</code> via the
            supervisor. Requires <code>homeassistant_api: true</code> in config.yaml (set).
          </Form.Text>
        </Form.Group>
      );
    case 'webhook':
      return (
        <Form.Group>
          <Form.Label>POST URL</Form.Label>
          <Form.Control
            type="url"
            value={config.url ?? ''}
            placeholder="https://example.com/hooks/patchpanel"
            onChange={e => onChange({ ...config, url: e.target.value })}
          />
          <Form.Text className="text-muted">
            JSON body:{' '}
            <code>{`{title, message, severity, ts, source: "patchpanel", details}`}</code>
          </Form.Text>
        </Form.Group>
      );
    case 'discord':
      return (
        <Form.Group>
          <Form.Label>Discord webhook URL</Form.Label>
          <Form.Control
            type="url"
            value={config.webhookUrl ?? ''}
            onChange={e => onChange({ ...config, webhookUrl: e.target.value })}
          />
        </Form.Group>
      );
    case 'ntfy':
      return (
        <>
          <Form.Group className="mb-2">
            <Form.Label>ntfy server URL</Form.Label>
            <Form.Control
              type="url"
              value={config.url ?? 'https://ntfy.sh'}
              onChange={e => onChange({ ...config, url: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label>Topic</Form.Label>
            <Form.Control
              type="text"
              value={config.topic ?? ''}
              placeholder="my-private-topic"
              onChange={e => onChange({ ...config, topic: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Bearer token (optional)</Form.Label>
            <Form.Control
              type="password"
              value={config.token ?? ''}
              onChange={e => onChange({ ...config, token: e.target.value })}
            />
          </Form.Group>
        </>
      );
    case 'slack':
      return (
        <Form.Group>
          <Form.Label>Slack incoming-webhook URL</Form.Label>
          <Form.Control
            type="url"
            value={config.webhookUrl ?? ''}
            onChange={e => onChange({ ...config, webhookUrl: e.target.value })}
          />
        </Form.Group>
      );
    default:
      return null;
  }
};

const ChannelEditModal = ({ show, channel, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => channel ?? emptyChannel());
  const [error, setError] = useState(null);
  const isExisting = Boolean(channel?.id);
  const update = patch => setDraft(prev => ({ ...prev, ...patch }));

  const handleSave = () => {
    const message = validateChannel(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting ? `Edit channel: ${channel.label}` : 'New notification channel'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Form.Group className="mb-2">
          <Form.Label>ID</Form.Label>
          <Form.Control
            type="text"
            value={draft.id}
            disabled={isExisting}
            onChange={e => update({ id: e.target.value })}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>Label</Form.Label>
          <Form.Control
            type="text"
            value={draft.label}
            onChange={e => update({ label: e.target.value })}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>Type</Form.Label>
          <Form.Select
            value={draft.type}
            disabled={isExisting}
            onChange={e => update({ type: e.target.value, config: emptyChannel().config })}
          >
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>Minimum severity</Form.Label>
          <Form.Select
            value={draft.minSeverity}
            onChange={e => update({ minSeverity: e.target.value })}
          >
            {SEVERITIES.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>Subscribed events (empty = all)</Form.Label>
          <Form.Select
            multiple
            value={draft.events}
            onChange={e => {
              const selected = Array.from(e.target.selectedOptions).map(o => o.value);
              update({ events: selected });
            }}
            style={{ minHeight: '10rem' }}
          >
            {EVENTS.map(ev => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            Cmd/Ctrl-click to select multiple. Leave empty to subscribe this channel to every event
            kind.
          </Form.Text>
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Check
            type="switch"
            id={`channel-enabled-${draft.id || 'new'}`}
            label="Enabled"
            checked={draft.enabled}
            onChange={e => update({ enabled: e.target.checked })}
          />
        </Form.Group>
        <hr />
        <TypeConfigForm
          type={draft.type}
          config={draft.config}
          onChange={config => update({ config })}
        />
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

ChannelEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  channel: PropTypes.shape({
    id: PropTypes.string,
    label: PropTypes.string,
    type: PropTypes.string,
  }),
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

TypeConfigForm.propTypes = {
  type: PropTypes.string.isRequired,
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

export const NotificationsPage = ({ doc = null, onSave = null }) => {
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [testStatus, setTestStatus] = useState(null);

  if (!doc) {
    return null;
  }

  const channels = doc.notifications?.channels ?? [];

  const persist = async next => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        ...doc,
        notifications: { ...(doc.notifications ?? {}), channels: next },
      });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = channel => {
    setShowNew(false);
    persist([...channels, { ...channel, id: channel.id || `ch-${genKey()}` }]);
  };
  const handleUpdate = channel => {
    setEditing(null);
    persist(channels.map(c => (c.id === channel.id ? channel : c)));
  };
  const handleDelete = () => {
    const target = deleting;
    setDeleting(null);
    persist(channels.filter(c => c.id !== target.id));
  };

  const sendTest = async channelId => {
    setTestStatus(null);
    try {
      await apiPost('api/notifications/test', { channelId });
      setTestStatus({ kind: 'success', message: `Test notification dispatched via ${channelId}.` });
    } catch (err) {
      setTestStatus({ kind: 'danger', message: err.message });
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">Notifications</Card.Title>
            <Card.Text className="text-muted small mb-0">
              Where patchpanel sends event notifications: cert renewals, reload failures, backend
              health changes. Multiple channels are dispatched in parallel; per-channel failures are
              isolated.
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowNew(true)} disabled={saving}>
            Add channel
          </Button>
        </div>
        {saveError ? <Alert variant="danger">Save failed: {saveError.message}</Alert> : null}
        {testStatus ? (
          <Alert variant={testStatus.kind} onClose={() => setTestStatus(null)} dismissible>
            {testStatus.message}
          </Alert>
        ) : null}
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>Label</th>
              <th>Type</th>
              <th>Events</th>
              <th>Min severity</th>
              <th>Enabled</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted small py-3">
                  No channels configured.
                </td>
              </tr>
            ) : null}
            {channels.map(c => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>
                  <Badge bg="info">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                </td>
                <td className="small text-muted">
                  {c.events?.length ? c.events.join(', ') : 'all'}
                </td>
                <td>{c.minSeverity ?? 'info'}</td>
                <td>{c.enabled ? '✓' : '✗'}</td>
                <td className="text-end text-nowrap">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="me-1"
                    onClick={() => sendTest(c.id)}
                    disabled={!c.enabled}
                  >
                    Test
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="me-1"
                    onClick={() => setEditing(c)}
                    disabled={saving}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => setDeleting(c)}
                    disabled={saving}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {saving ? <Spinner animation="border" size="sm" /> : null}
      </Card.Body>
      {showNew ? (
        <ChannelEditModal show onSave={handleAdd} onCancel={() => setShowNew(false)} />
      ) : null}
      {editing ? (
        <ChannelEditModal
          show
          channel={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title="Delete channel?"
          body={
            <>
              Delete <strong>{deleting.label}</strong>?
            </>
          }
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

NotificationsPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
