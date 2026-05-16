import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

import { apiPost } from '../api/client.js';

// v0.2.39 — Upload an existing PEM (cert + key) end-to-end. The user
// picks two PEM files (or pastes them), gives the cert a friendly name,
// hits Upload. patchpanel:
//   1. Validates the PEM pair server-side (parse, key/cert match, expiry,
//      ≥1 SAN)
//   2. Writes /data/certs/byo/<name>/{fullchain,privkey,cert}.pem mode 600
//   3. Augments state with a singleton `byo` TLS provider (if none exists)
//      + a new Certificate entry whose `certName === name` and whose
//      `domains[]` come from the parsed cert SANs
//   4. Sends the augmented state through the standard apply-state
//      pipeline so haproxy.cfg gets re-rendered + validated + reloaded
// The user does NOT have to manually create a TLS provider or a
// Certificate entry — one upload action does the whole wiring.

const NAME_REGEX = /^[a-zA-Z0-9._-]+$/u;
const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const PemTextarea = ({ label, value, onChange, placeholder, fileAccept, fileInputKey }) => {
  const onFile = async e => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      onChange(text);
    } catch {
      // FileReader error path — non-fatal; user can paste manually instead.
    }
  };
  return (
    <Form.Group className="mb-2">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">{label}</Form.Label>
        <Form.Control
          key={fileInputKey}
          type="file"
          size="sm"
          accept={fileAccept}
          onChange={onFile}
          style={{ maxWidth: '14rem' }}
        />
      </div>
      <Form.Control
        as="textarea"
        rows={6}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
      />
    </Form.Group>
  );
};

PemTextarea.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  fileAccept: PropTypes.string,
  fileInputKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

const ValidationPanel = ({ result }) => {
  if (!result) {
    return null;
  }
  if (result.ok) {
    const info = result.info ?? {};
    return (
      <Alert variant="success" className="mb-2 small">
        <div className="d-flex justify-content-between mb-1">
          <strong>PEM validated successfully.</strong>
          <Badge bg="success">ready to save</Badge>
        </div>
        <div>
          <strong>CN:</strong> {info.commonName ?? '(none)'}
        </div>
        <div>
          <strong>SANs:</strong>{' '}
          {(info.sans ?? []).map(s => (
            <Badge bg="info" key={s} className="me-1">
              {s}
            </Badge>
          ))}
        </div>
        <div>
          <strong>Valid:</strong>{' '}
          {info.notBefore ? new Date(info.notBefore).toLocaleDateString() : '?'} →{' '}
          {info.notAfter ? new Date(info.notAfter).toLocaleDateString() : '?'}
        </div>
        <div>
          <strong>Chain length:</strong> {info.chainLength ?? 1} cert
          {(info.chainLength ?? 1) === 1 ? '' : 's'}
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

// Derive a sensible default cert name from the first SAN. Strip leading
// wildcard, replace dots with hyphens, lowercase. Falls back to "uploaded-cert"
// when no SAN is present (won't validate, but at least the field has something).
const deriveDefaultName = info => {
  const first = info?.sans?.[0] ?? info?.commonName ?? null;
  if (!first) {
    return 'uploaded-cert';
  }
  return first
    .replace(/^\*\./u, '')
    .replace(/[^a-zA-Z0-9.-]/gu, '-')
    .toLowerCase();
};

// Derive a state.id from the cert name. Schema requires id to start with a
// letter and contain only a-z / 0-9 / _ / -.
const deriveId = name => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (ID_REGEX.test(base)) {
    return base.slice(0, 63);
  }
  return `cert-${base.slice(0, 56)}`;
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

const ensureByoProvider = doc => {
  const existing = doc.tls.providers.find(p => p.type === 'byo');
  if (existing) {
    return { providerId: existing.id, nextDoc: doc };
  }
  const takenProviderIds = new Set(doc.tls.providers.map(p => p.id));
  const providerId = uniqueId('byo', takenProviderIds);
  const nextDoc = {
    ...doc,
    tls: {
      ...doc.tls,
      providers: [
        ...doc.tls.providers,
        { id: providerId, type: 'byo', credentialsRef: null, options: {} },
      ],
    },
  };
  return { providerId, nextDoc };
};

const buildAugmentedDoc = ({ doc, name, info }) => {
  const { providerId, nextDoc } = ensureByoProvider(doc);
  const takenCertIds = new Set(nextDoc.tls.certs.map(c => c.id));
  const certId = uniqueId(deriveId(name), takenCertIds);
  const domains = (info?.sans ?? []).filter(Boolean);
  const newCert = {
    id: certId,
    certName: name,
    domains: domains.length > 0 ? domains : [info?.commonName].filter(Boolean),
    providerId,
    expanding: false,
    keyType: 'ecdsa',
  };
  return {
    ...nextDoc,
    tls: { ...nextDoc.tls, certs: [...nextDoc.tls.certs, newCert] },
  };
};

export const BYOUploadModal = ({ show, doc, onUploaded, onCancel, suggestedName = '' }) => {
  const [name, setName] = useState(suggestedName);
  const [fullchainPem, setFullchainPem] = useState('');
  const [privkeyPem, setPrivkeyPem] = useState('');
  const [validation, setValidation] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [nameAutoFilled, setNameAutoFilled] = useState(false);

  // When validation succeeds and the user hasn't touched the name field
  // yet, fill it from the cert's first SAN. After that the user can edit.
  useEffect(() => {
    if (validation?.ok && !nameAutoFilled && !name) {
      setName(deriveDefaultName(validation.info));
      setNameAutoFilled(true);
    }
  }, [validation, nameAutoFilled, name]);

  const nameValid = NAME_REGEX.test(name);
  const pemsPresent = fullchainPem.trim().length > 0 && privkeyPem.trim().length > 0;
  const canValidate = pemsPresent;
  const canUpload = nameValid && pemsPresent && validation?.ok === true && Boolean(doc);

  const handleValidate = async () => {
    setNetworkError(null);
    setValidation(null);
    try {
      const result = await apiPost('api/byo-certs/validate', { fullchainPem, privkeyPem });
      setValidation(result);
    } catch (err) {
      setNetworkError(err.message ?? 'validation request failed');
    }
  };

  const handleUpload = async () => {
    setNetworkError(null);
    setUploading(true);
    try {
      const uploadResult = await apiPost('api/byo-certs/upload', {
        name,
        fullchainPem,
        privkeyPem,
      });
      if (!uploadResult.ok) {
        setValidation(uploadResult);
        return;
      }
      // PEM is on disk; now augment state so the cert + provider exist and
      // haproxy.cfg picks up the new lineage via the apply-state pipeline.
      const nextDoc = buildAugmentedDoc({ doc, name, info: uploadResult.info });
      await onUploaded(nextDoc, { name, info: uploadResult.info });
    } catch (err) {
      setNetworkError(err.message ?? 'upload request failed');
    } finally {
      setUploading(false);
    }
  };

  const [fileInputBump, setFileInputBump] = useState(0);
  const updateFullchain = next => {
    setFullchainPem(next);
    setValidation(null);
    setFileInputBump(n => n + 1);
  };
  const updatePrivkey = next => {
    setPrivkeyPem(next);
    setValidation(null);
    setFileInputBump(n => n + 1);
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-cloud-upload me-2" />
          Upload existing certificate
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="info" className="small mb-3">
          Drop in your fullchain + private key, give it a name, hit Upload. patchpanel validates the
          PEM pair, writes the files to disk, and creates the matching Certificate entry
          automatically — you don&apos;t need to wire up a TLS provider or a cert entry by hand.
        </Alert>
        <Row className="g-3">
          <Col xs={12}>
            <PemTextarea
              label="Fullchain PEM (leaf + intermediates)"
              value={fullchainPem}
              onChange={updateFullchain}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              fileAccept=".pem,.crt,.cer,.cert"
              fileInputKey={`fc-${fileInputBump}`}
            />
          </Col>
          <Col xs={12}>
            <PemTextarea
              label="Private key PEM (matching private key)"
              value={privkeyPem}
              onChange={updatePrivkey}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              fileAccept=".pem,.key"
              fileInputKey={`pk-${fileInputBump}`}
            />
          </Col>
          <Col xs={12}>
            <ValidationPanel result={validation} />
            {networkError ? (
              <Alert variant="warning" className="mb-0 small">
                Request failed: {networkError}
              </Alert>
            ) : null}
          </Col>
          <Col md={8}>
            <Form.Group>
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={e => {
                  setName(e.target.value);
                  setNameAutoFilled(true);
                }}
                placeholder="auto-filled from the cert's first SAN"
                isInvalid={name.length > 0 ? !nameValid : null}
              />
              <Form.Text className="text-muted">
                Identifier for this certificate. Used as the on-disk folder name and the entry name
                in the certificates list. Filesystem-safe characters only (letters, digits,{' '}
                <code>.</code> <code>-</code> <code>_</code>). Auto-filled from the cert&apos;s
                first SAN after validation; you can change it before uploading.
              </Form.Text>
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

BYOUploadModal.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: PropTypes.object.isRequired,
  onUploaded: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  suggestedName: PropTypes.string,
};
