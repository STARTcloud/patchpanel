import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';
import { genKey } from '../utils/keys.js';
import { ID_REGEX } from '../utils/regexes.js';

const TYPE_LABEL_KEYS = Object.freeze({
  'ha-notify': { key: 'notify:type.haNotify', fallback: 'Home Assistant notify service' },
  webhook: { key: 'notify:type.webhook', fallback: 'Generic webhook' },
  discord: { key: 'notify:type.discord', fallback: 'Discord webhook' },
  ntfy: { key: 'notify:type.ntfy', fallback: 'ntfy.sh' },
  slack: { key: 'notify:type.slack', fallback: 'Slack webhook' },
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

const emptyChannel = () => ({
  id: '',
  label: '',
  type: 'ha-notify',
  enabled: true,
  events: [],
  minSeverity: 'info',
  config: { service: 'persistent_notification.create' },
});

const validateChannel = (draft, t) => {
  if (!ID_REGEX.test(draft.id)) {
    return t(
      'notify:validate.idFormat',
      'id must be lowercase a-z, digits, _ or - (start with letter)'
    );
  }
  if (!draft.label.trim()) {
    return t('notify:validate.labelRequired', 'label is required');
  }
  if (draft.type === 'webhook' && !draft.config?.url) {
    return t('notify:validate.webhookUrl', 'webhook needs a url');
  }
  if (draft.type === 'discord' && !draft.config?.webhookUrl) {
    return t('notify:validate.discordUrl', 'discord needs a webhookUrl');
  }
  if (draft.type === 'slack' && !draft.config?.webhookUrl) {
    return t('notify:validate.slackUrl', 'slack needs a webhookUrl');
  }
  if (draft.type === 'ntfy' && !draft.config?.topic) {
    return t('notify:validate.ntfyTopic', 'ntfy needs a topic');
  }
  return null;
};

const TypeConfigForm = ({ type, config, onChange }) => {
  const { t } = useTranslation(['notify']);
  switch (type) {
    case 'ha-notify':
      return (
        <Form.Group>
          <Form.Label>
            {t(
              'notify:form.haService',
              'HA service (e.g. notify.notify, persistent_notification.create)'
            )}
          </Form.Label>
          <Form.Control
            type="text"
            value={config.service ?? ''}
            onChange={e => onChange({ ...config, service: e.target.value })}
          />
          <Form.Text className="text-muted">
            {t('notify:form.haServiceHelpPrefix', 'The addon calls')}{' '}
            <code>POST /core/api/services/&lt;domain&gt;/&lt;name&gt;</code>{' '}
            {t('notify:form.haServiceHelpSuffix', 'via the supervisor. Requires')}{' '}
            <code>homeassistant_api: true</code>{' '}
            {t('notify:form.haServiceHelpEnd', 'in config.yaml (set).')}
          </Form.Text>
        </Form.Group>
      );
    case 'webhook':
      return (
        <Form.Group>
          <Form.Label>{t('notify:form.postUrl', 'POST URL')}</Form.Label>
          <Form.Control
            type="url"
            value={config.url ?? ''}
            placeholder="https://example.com/hooks/patchpanel"
            onChange={e => onChange({ ...config, url: e.target.value })}
          />
          <Form.Text className="text-muted">
            {t('notify:form.jsonBody', 'JSON body:')}{' '}
            <code>{`{title, message, severity, ts, source: "patchpanel", details}`}</code>
          </Form.Text>
        </Form.Group>
      );
    case 'discord':
      return (
        <Form.Group>
          <Form.Label>{t('notify:form.discordUrl', 'Discord webhook URL')}</Form.Label>
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
            <Form.Label>{t('notify:form.ntfyUrl', 'ntfy server URL')}</Form.Label>
            <Form.Control
              type="url"
              value={config.url ?? 'https://ntfy.sh'}
              onChange={e => onChange({ ...config, url: e.target.value })}
            />
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label>{t('notify:form.ntfyTopic', 'Topic')}</Form.Label>
            <Form.Control
              type="text"
              value={config.topic ?? ''}
              placeholder={t('notify:form.ntfyTopicPlaceholder', 'my-private-topic')}
              onChange={e => onChange({ ...config, topic: e.target.value })}
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>{t('notify:form.bearerToken', 'Bearer token (optional)')}</Form.Label>
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
          <Form.Label>{t('notify:form.slackUrl', 'Slack incoming-webhook URL')}</Form.Label>
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
  const { t } = useTranslation(['notify', 'common']);
  const [draft, setDraft] = useState(() => channel ?? emptyChannel());
  const [error, setError] = useState(null);
  const isExisting = Boolean(channel?.id);
  const update = patch => setDraft(prev => ({ ...prev, ...patch }));

  const handleSave = () => {
    const message = validateChannel(draft, t);
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
          {isExisting
            ? t('notify:editModal.editTitle', 'Edit channel: {{label}}', { label: channel.label })
            : t('notify:editModal.newTitle', 'New notification channel')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Form.Group className="mb-2">
          <Form.Label>{t('notify:field.id', 'ID')}</Form.Label>
          <Form.Control
            type="text"
            value={draft.id}
            disabled={isExisting}
            onChange={e => update({ id: e.target.value })}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>{t('notify:field.label', 'Label')}</Form.Label>
          <Form.Control
            type="text"
            value={draft.label}
            onChange={e => update({ label: e.target.value })}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>{t('notify:field.type', 'Type')}</Form.Label>
          <Form.Select
            value={draft.type}
            disabled={isExisting}
            onChange={e => update({ type: e.target.value, config: emptyChannel().config })}
          >
            {Object.entries(TYPE_LABEL_KEYS).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label.key, label.fallback)}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Label>{t('notify:field.minSeverity', 'Minimum severity')}</Form.Label>
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
          <Form.Label>{t('notify:field.events', 'Subscribed events (empty = all)')}</Form.Label>
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
            {t(
              'notify:field.eventsHelp',
              'Cmd/Ctrl-click to select multiple. Leave empty to subscribe this channel to every event kind.'
            )}
          </Form.Text>
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Check
            type="switch"
            id={`channel-enabled-${draft.id || 'new'}`}
            label={t('common:status.enabled', 'Enabled')}
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
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? t('common:buttons.update', 'Update') : t('common:buttons.add', 'Add')}
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
  const { t } = useTranslation(['notify', 'common']);
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
      setTestStatus({
        kind: 'success',
        message: t('notify:testDispatched', 'Test notification dispatched via {{channelId}}.', {
          channelId,
        }),
      });
    } catch (err) {
      setTestStatus({ kind: 'danger', message: err.message });
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">{t('notify:title', 'Notifications')}</Card.Title>
            <Card.Text className="text-muted small mb-0">
              {t(
                'notify:description',
                'Where patchpanel sends event notifications: cert renewals, reload failures, backend health changes. Multiple channels are dispatched in parallel; per-channel failures are isolated.'
              )}
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowNew(true)} disabled={saving}>
            {t('notify:addChannel', 'Add channel')}
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger">
            {t('notify:saveFailed', 'Save failed:')} {saveError.message}
          </Alert>
        ) : null}
        {testStatus ? (
          <Alert variant={testStatus.kind} onClose={() => setTestStatus(null)} dismissible>
            {testStatus.message}
          </Alert>
        ) : null}
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>{t('notify:col.label', 'Label')}</th>
              <th>{t('notify:col.type', 'Type')}</th>
              <th>{t('notify:col.events', 'Events')}</th>
              <th>{t('notify:col.minSeverity', 'Min severity')}</th>
              <th>{t('notify:col.enabled', 'Enabled')}</th>
              <th className="text-end">{t('notify:col.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-muted small py-3">
                  {t('notify:noChannels', 'No channels configured.')}
                </td>
              </tr>
            ) : null}
            {channels.map(c => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td>
                  <Badge bg="info">
                    {TYPE_LABEL_KEYS[c.type]
                      ? t(TYPE_LABEL_KEYS[c.type].key, TYPE_LABEL_KEYS[c.type].fallback)
                      : c.type}
                  </Badge>
                </td>
                <td className="small text-muted">
                  {c.events?.length ? c.events.join(', ') : t('notify:eventsAll', 'all')}
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
                    {t('common:buttons.test', 'Test')}
                  </Button>
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="me-1"
                    onClick={() => setEditing(c)}
                    disabled={saving}
                  >
                    {t('common:buttons.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => setDeleting(c)}
                    disabled={saving}
                  >
                    {t('common:buttons.delete', 'Delete')}
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
          title={t('notify:deleteTitle', 'Delete channel?')}
          body={
            <>
              {t('notify:deleteBodyPrefix', 'Delete')} <strong>{deleting.label}</strong>?
            </>
          }
          confirmLabel={t('common:buttons.delete', 'Delete')}
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
