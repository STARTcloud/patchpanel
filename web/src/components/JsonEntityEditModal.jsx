import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';

// Tactical fallback editor for v0.2.32-rc2 — every Phase 1 schema array
// (resolvers / peers / mailers / rings / crtStores / securityProfiles /
// additional frontends) gets a discoverable CRUD UI through this modal
// without needing a hand-rolled form per entity kind. Server-side zod
// validation runs on save the same way it does for Raw State; form-driven
// per-kind modals replace this in rc3.

const indent = obj => JSON.stringify(obj, null, 2);

export const JsonEntityEditModal = ({
  show,
  entity = null,
  label,
  emptyTemplate,
  onSave,
  onCancel,
}) => {
  const initialJson = indent(entity ?? emptyTemplate);
  const [text, setText] = useState(initialJson);
  const [error, setError] = useState(null);
  const isExisting = Boolean(entity?.id);

  const handleSave = () => {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      setError('Expected a JSON object');
      return;
    }
    if (!parsed.id || typeof parsed.id !== 'string') {
      setError('Entity must have a string `id` field');
      return;
    }
    setError(null);
    onSave(parsed);
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{isExisting ? `Edit ${label}: ${entity.id}` : `New ${label}`}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Form.Control
          as="textarea"
          rows={20}
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
        />
        <Form.Text className="text-muted">
          Edit the JSON shape directly. Server-side schema validation runs on save and the
          confirm-apply modal will show a section-level diff. Form-driven editors land in
          v0.2.32-rc3.
        </Form.Text>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? `Update ${label}` : `Add ${label}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

JsonEntityEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  entity: PropTypes.object,
  label: PropTypes.string.isRequired,
  emptyTemplate: PropTypes.object.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
