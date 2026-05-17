import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

import { apiPost } from '../api/client.js';

// Upload an X.509 Certificate Revocation List (PEM). The server checks the
// PEM markers + base64, writes it to <trustedCrlsDir>/<id>.pem, returns the
// SHA-256 fingerprint. The modal augments state.trustedCrls with the new
// entry and the page persists via PUT /api/state.

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]*$/u;

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const deriveIdFromName = name => {
  if (!name) {
    return '';
  }
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (ID_REGEX.test(base)) {
    return base.slice(0, 63);
  }
  return `crl-${base.slice(0, 59)}`;
};

const uniqueId = (proposed, taken) => {
  if (!taken.has(proposed)) {
    return proposed;
  }
  let suffix = 2;
  let candidate = `${proposed}-${suffix}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${proposed}-${suffix}`;
  }
  return candidate;
};

const PemTextarea = ({ value, onChange, fileInputKey }) => {
  const onFile = async e => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      onChange(text);
    } catch {
      // FileReader error path; user can paste instead
    }
  };
  return (
    <Form.Group className="mb-2">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">CRL PEM</Form.Label>
        <Form.Control
          key={fileInputKey}
          type="file"
          size="sm"
          accept=".pem,.crl"
          onChange={onFile}
          style={{ maxWidth: '14rem' }}
        />
      </div>
      <Form.Control
        as="textarea"
        rows={8}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="-----BEGIN X509 CRL-----&#10;...&#10;-----END X509 CRL-----"
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
      />
      <Form.Text className="text-muted">
        Paste or drop a PEM-encoded X.509 Certificate Revocation List. HAProxy validates the file
        contents at <code>haproxy -c</code> time; patchpanel only checks the PEM envelope here.
      </Form.Text>
    </Form.Group>
  );
};

PemTextarea.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  fileInputKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

const ValidationPanel = ({ result }) => {
  if (!result) {
    return null;
  }
  if (result.ok) {
    return (
      <Alert variant="success" className="mb-2 small">
        <div className="d-flex justify-content-between mb-1">
          <strong>PEM envelope OK.</strong>
          <Badge bg="success">ready to save</Badge>
        </div>
        <div>
          <strong>Fingerprint (SHA-256):</strong>{' '}
          <code className="small">{result.info?.fingerprint}</code>
        </div>
      </Alert>
    );
  }
  return (
    <Alert variant="danger" className="mb-2 small">
      <strong>Validation failed.</strong>
      <ul className="mb-0 ps-3 mt-1">
        {(result.errors ?? []).map(err => (
          <li key={err}>{err}</li>
        ))}
      </ul>
    </Alert>
  );
};

ValidationPanel.propTypes = {
  result: PropTypes.object,
};

const buildAugmentedDoc = ({ doc, id, name, description, info }) => {
  const entry = {
    id,
    name,
    addedAt: new Date().toISOString(),
  };
  if (description?.trim()) {
    entry.description = description.trim();
  }
  if (info?.fingerprint) {
    entry.fingerprint = info.fingerprint;
  }
  return { ...doc, trustedCrls: [...(doc.trustedCrls ?? []), entry] };
};

export const TrustedCRLUploadModal = ({ show, doc, onUploaded, onCancel }) => {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pem, setPem] = useState('');
  const [validation, setValidation] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [autoFilled, setAutoFilled] = useState(false);
  const [fileInputBump, setFileInputBump] = useState(0);

  const takenIds = useMemo(
    () => new Set((doc?.trustedCrls ?? []).map(t => t.id)),
    [doc?.trustedCrls]
  );
  const takenNames = useMemo(
    () => new Set((doc?.trustedCrls ?? []).map(t => t.name)),
    [doc?.trustedCrls]
  );

  const idValid = ID_REGEX.test(id) && !takenIds.has(id);
  const nameValid = NAME_REGEX.test(name) && !takenNames.has(name);
  const canValidate = pem.trim().length > 0;
  const canUpload =
    idValid && nameValid && pem.trim().length > 0 && validation?.ok === true && Boolean(doc);

  const handleValidate = async () => {
    setNetworkError(null);
    setValidation(null);
    try {
      const result = await apiPost('api/trusted-crls/validate', { pem });
      setValidation(result);
      if (result?.ok && !autoFilled && !id && name) {
        setId(uniqueId(deriveIdFromName(name), takenIds));
        setAutoFilled(true);
      }
    } catch (err) {
      setNetworkError(err.message ?? 'validation request failed');
    }
  };

  const handleUpload = async () => {
    setNetworkError(null);
    setUploading(true);
    try {
      const uploadResult = await apiPost('api/trusted-crls/upload', { id, pem });
      if (!uploadResult.ok) {
        setValidation(uploadResult);
        return;
      }
      const nextDoc = buildAugmentedDoc({ doc, id, name, description, info: uploadResult.info });
      await onUploaded(nextDoc, { id, name, info: uploadResult.info });
    } catch (err) {
      setNetworkError(err.message ?? 'upload request failed');
    } finally {
      setUploading(false);
    }
  };

  const updatePem = next => {
    setPem(next);
    setValidation(null);
    setFileInputBump(n => n + 1);
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-shield-x me-2" />
          Upload trusted CRL
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="info" className="small mb-3">
          A Certificate Revocation List is a signed list of certificates that have been revoked by
          their issuing CA. HAProxy uses it on a <strong>frontend bind</strong> alongside{' '}
          <code>verify required</code> + a Trusted CA to reject revoked client certs at the TLS
          handshake.
        </Alert>
        <Row className="g-3">
          <Col xs={12}>
            <PemTextarea value={pem} onChange={updatePem} fileInputKey={`pem-${fileInputBump}`} />
          </Col>
          <Col xs={12}>
            <ValidationPanel result={validation} />
            {networkError ? (
              <Alert variant="warning" className="mb-0 small">
                Request failed: {networkError}
              </Alert>
            ) : null}
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Friendly name</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. CorpCA-2026-Q2"
                isInvalid={name.length > 0 ? !nameValid : null}
              />
              <Form.Text className="text-muted">
                Display name. Letters/digits/<code>._-</code>, starting with a letter.
              </Form.Text>
              {takenNames.has(name) ? (
                <Form.Text className="text-danger">name already used</Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>ID</Form.Label>
              <Form.Control
                type="text"
                value={id}
                onChange={e => {
                  setId(e.target.value);
                  setAutoFilled(true);
                }}
                placeholder="auto-derived from name"
                isInvalid={id.length > 0 ? !idValid : null}
              />
              <Form.Text className="text-muted">
                Stable id; on-disk filename. Lowercase a-z, 0-9, <code>_-</code>, start with letter.
              </Form.Text>
              {takenIds.has(id) ? (
                <Form.Text className="text-danger">id already used</Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>Description (optional)</Form.Label>
              <Form.Control
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What this CRL covers"
              />
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
        <Button
          variant="outline-primary"
          onClick={handleValidate}
          disabled={!canValidate || uploading}
        >
          Validate
        </Button>
        <Button variant="primary" onClick={handleUpload} disabled={!canUpload || uploading}>
          {uploading ? (
            <>
              <Spinner as="span" animation="border" size="sm" /> Uploading…
            </>
          ) : (
            'Upload'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

TrustedCRLUploadModal.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: PropTypes.object.isRequired,
  onUploaded: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
