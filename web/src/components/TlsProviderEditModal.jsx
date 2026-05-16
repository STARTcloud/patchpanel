import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';

import { TLS_PROVIDER_REGISTRY } from '../lib/tls-provider-kinds.jsx';

// v0.2.39 — Thin shell over `TLS_PROVIDER_REGISTRY`. The registry owns the
// per-kind subforms, defaults, validators, and credentials-ref help text;
// the modal is generic dispatch. Adding a new TLS provider kind is a single
// entry in `lib/tls-provider-kinds.jsx`.

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const validate = draft => {
  if (!ID_REGEX.test(draft.id)) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  const kind = TLS_PROVIDER_REGISTRY.get(draft.type);
  if (!kind) {
    return `unknown TLS provider type: ${draft.type}`;
  }
  return kind.validate(draft);
};

const emptyProvider = () => {
  const firstKind = TLS_PROVIDER_REGISTRY.get(TLS_PROVIDER_REGISTRY.firstKindValue);
  return {
    id: '',
    type: firstKind.value,
    credentialsRef: firstKind.credentialsRefPlaceholder,
    options: firstKind.emptyOptions(),
  };
};

export const TlsProviderEditModal = ({ show, provider = null, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => provider ?? emptyProvider());
  const [error, setError] = useState(null);

  const update = patch => setDraft(prev => ({ ...prev, ...patch }));
  const updateOptions = next => setDraft(prev => ({ ...prev, options: next }));

  const onTypeChange = nextType => {
    const nextKind = TLS_PROVIDER_REGISTRY.get(nextType);
    if (!nextKind) {
      return;
    }
    setDraft(prev => ({
      ...prev,
      type: nextType,
      credentialsRef: nextKind.credentialsRefRequired
        ? (prev.credentialsRef ?? nextKind.credentialsRefPlaceholder)
        : null,
      options: nextKind.emptyOptions(),
    }));
  };

  const handleSave = () => {
    const message = validate(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
  };

  const isExisting = Boolean(provider?.id);
  const currentKind = TLS_PROVIDER_REGISTRY.get(draft.type);
  const credentialsRefRequired = currentKind?.credentialsRefRequired ?? false;
  const OptionsForm = currentKind?.OptionsForm ?? null;

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting ? `Edit TLS provider: ${provider.id}` : 'New TLS provider'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>ID</Form.Label>
              <Form.Control
                type="text"
                value={draft.id}
                disabled={isExisting}
                onChange={e => update({ id: e.target.value })}
                placeholder="e.g. cloudflare"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Type</Form.Label>
              <Form.Select
                value={draft.type}
                disabled={isExisting}
                onChange={e => onTypeChange(e.target.value)}
              >
                {TLS_PROVIDER_REGISTRY.typeOptions
                  .filter(t => t.value !== 'byo')
                  .map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
              </Form.Select>
              {isExisting ? (
                <Form.Text className="text-muted">
                  Type cannot change after creation. Delete and recreate to switch.
                </Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>
                credentialsRef
                {credentialsRefRequired ? null : (
                  <span className="text-muted small ms-2">(not used for this type)</span>
                )}
              </Form.Label>
              <Form.Control
                type="text"
                value={draft.credentialsRef ?? ''}
                disabled={!credentialsRefRequired}
                placeholder={currentKind?.credentialsRefPlaceholder ?? '(not applicable)'}
                onChange={e => update({ credentialsRef: e.target.value || null })}
              />
              {currentKind?.credentialsRefHelp ? (
                <Form.Text className="text-muted">{currentKind.credentialsRefHelp}</Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          {OptionsForm ? (
            <OptionsForm options={draft.options ?? {}} onChange={updateOptions} />
          ) : null}
        </Row>
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

TlsProviderEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  provider: PropTypes.shape({ id: PropTypes.string, type: PropTypes.string }),
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
