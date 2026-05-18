import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import {
  AUTH_PROVIDER_REGISTRY,
  stripBasicInternalKeys,
  withBasicInternalKeys,
} from '../lib/auth-provider-kinds.jsx';

// v0.2.39 — Thin shell over `AUTH_PROVIDER_REGISTRY`. The registry owns
// the per-kind config templates, subforms, and validators; the modal is
// generic dispatch. Adding a new auth provider kind is a single entry in
// `lib/auth-provider-kinds.jsx`.

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const emptyProvider = () => {
  const firstKind = AUTH_PROVIDER_REGISTRY.get(AUTH_PROVIDER_REGISTRY.firstKindValue);
  return { id: '', type: firstKind.value, config: firstKind.emptyConfig() };
};

const validateProvider = (draft, t) => {
  if (!ID_REGEX.test(draft.id)) {
    return t(
      'auth:authProvider.idFormatError',
      'id must match a-z, 0-9, _, - (starting with a letter)'
    );
  }
  const kind = AUTH_PROVIDER_REGISTRY.get(draft.type);
  if (!kind) {
    return t('auth:authProvider.unknownType', {
      type: draft.type,
      defaultValue: 'unknown auth provider type: {{type}}',
    });
  }
  return kind.validate(draft);
};

export const AuthProviderEditModal = ({
  show,
  provider = null,
  doc = null,
  onSave,
  onCancel,
  onLaunchWizard = null,
}) => {
  const { t } = useTranslation(['auth', 'common']);
  const [draft, setDraft] = useState(() =>
    provider ? withBasicInternalKeys(provider) : emptyProvider()
  );
  const [error, setError] = useState(null);

  const setType = nextType => {
    const nextKind = AUTH_PROVIDER_REGISTRY.get(nextType);
    if (!nextKind) {
      return;
    }
    setDraft(prev => ({ ...prev, type: nextType, config: nextKind.emptyConfig() }));
  };
  const setConfig = config => setDraft(prev => ({ ...prev, config }));

  const handleSave = () => {
    const message = validateProvider(draft, t);
    if (message) {
      setError(message);
      return;
    }
    onSave(stripBasicInternalKeys(draft));
  };

  const isExisting = Boolean(provider?.id);
  const currentKind = AUTH_PROVIDER_REGISTRY.get(draft.type);
  const ConfigForm = currentKind?.ConfigForm ?? null;
  const isAutheliaKind = draft.type === 'authelia';

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('auth:authProvider.editTitle', {
                id: provider.id,
                defaultValue: 'Edit auth provider: {{id}}',
              })
            : t('auth:authProvider.newTitle', 'New auth provider')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {!isExisting && isAutheliaKind && onLaunchWizard ? (
          <Alert variant="info" className="d-flex justify-content-between align-items-center">
            <span>
              {t(
                'auth:authProvider.autheliaWizardSuggestion',
                'Need patchpanel to generate the backend, host ACL, and portal use-backend rule for you? The Authelia setup wizard creates them all in one shot.'
              )}
            </span>
            <Button size="sm" variant="primary" onClick={onLaunchWizard}>
              {t('auth:authProvider.launchWizard', 'Launch wizard')}
            </Button>
          </Alert>
        ) : null}
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('auth:authProvider.idLabel', 'ID')}</Form.Label>
              <Form.Control
                type="text"
                value={draft.id}
                disabled={isExisting}
                onChange={e => setDraft(prev => ({ ...prev, id: e.target.value }))}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('auth:authProvider.typeLabel', 'Type')}</Form.Label>
              <Form.Select
                value={draft.type}
                disabled={isExisting}
                onChange={e => setType(e.target.value)}
              >
                {AUTH_PROVIDER_REGISTRY.typeOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Form.Select>
              <Form.Text className="text-muted">
                {t(
                  'auth:authProvider.typeHelp',
                  'Type cannot change after creation. Delete and recreate to switch types.'
                )}
              </Form.Text>
            </Form.Group>
          </Col>
          {ConfigForm ? <ConfigForm config={draft.config} onChange={setConfig} doc={doc} /> : null}
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:buttons.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? t('common:buttons.update') : t('common:buttons.add')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

AuthProviderEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  provider: PropTypes.shape({ id: PropTypes.string, type: PropTypes.string }),
  doc: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onLaunchWizard: PropTypes.func,
};
