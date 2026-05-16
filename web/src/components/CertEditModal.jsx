import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';

import { stateDocShape } from '../prop-shapes.js';

import { ListEditor } from './ListEditor.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const HOSTNAME_REGEX = /^[a-zA-Z0-9*][a-zA-Z0-9.*-]{0,252}$/u;
const CERT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

const emptyCert = () => ({
  id: '',
  certName: '',
  domains: [],
  providerId: '',
  acmeAccountId: '',
  expanding: true,
  keyType: 'ecdsa',
});

const validateCert = (draft, providers) => {
  if (!ID_REGEX.test(draft.id)) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  if (!CERT_NAME_REGEX.test(draft.certName)) {
    return 'certName must be a valid filesystem-safe certificate name';
  }
  if (draft.domains.length === 0) {
    return 'at least one domain is required';
  }
  if (!draft.providerId) {
    return 'provider is required';
  }
  const isByo = providers.find(p => p.id === draft.providerId)?.type === 'byo';
  if (!isByo && !draft.acmeAccountId) {
    return 'ACME account is required (only BYO certs may omit it)';
  }
  if (draft.keyType === 'rsa' && draft.rsaKeySize) {
    if (![2048, 3072, 4096, 8192].includes(draft.rsaKeySize)) {
      return 'rsaKeySize must be 2048, 3072, 4096, or 8192';
    }
  }
  return null;
};

export const CertEditModal = ({ show, cert = null, doc, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => cert ?? emptyCert());
  const [error, setError] = useState(null);

  const update = patch => setDraft(prev => ({ ...prev, ...patch }));

  const handleSave = () => {
    const message = validateCert(draft, doc.tls.providers);
    if (message) {
      setError(message);
      return;
    }
    onSave(draft);
  };

  const isExisting = Boolean(cert?.id);
  const selectedProviderType = doc.tls.providers.find(p => p.id === draft.providerId)?.type;
  const isByoSelected = selectedProviderType === 'byo';
  const acmeAccounts = doc.acmeAccounts ?? [];

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting ? `Edit certificate: ${cert.certName}` : 'New certificate'}
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
                placeholder="e.g. example-com"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>certName (used as Let&apos;s Encrypt cert name)</Form.Label>
              <Form.Control
                type="text"
                value={draft.certName}
                onChange={e => update({ certName: e.target.value })}
                placeholder="e.g. example.com"
              />
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>Domains (SANs)</Form.Label>
              <ListEditor
                items={draft.domains}
                onChange={list => update({ domains: list })}
                placeholder="e.g. www.example.com or *.example.com"
                validate={value => (HOSTNAME_REGEX.test(value) ? true : 'invalid domain')}
              />
              <Form.Text className="text-muted">
                The first entry becomes the certificate&apos;s Common Name. Wildcards are permitted
                (DNS-01 only).
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>TLS provider</Form.Label>
              <Form.Select
                value={draft.providerId}
                onChange={e => update({ providerId: e.target.value })}
              >
                <option value="">— choose —</option>
                {doc.tls.providers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.type}:{p.id}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>ACME account</Form.Label>
              <Form.Select
                value={draft.acmeAccountId ?? ''}
                onChange={e => update({ acmeAccountId: e.target.value || undefined })}
                disabled={isByoSelected}
              >
                <option value="">{isByoSelected ? 'n/a (BYO cert)' : '— choose —'}</option>
                {acmeAccounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.id} ({a.email} · {a.server})
                  </option>
                ))}
              </Form.Select>
              <Form.Text className="text-muted">
                {isByoSelected
                  ? 'BYO certs do not use ACME — leave empty.'
                  : 'Which ACME account / CA registers and renews this cert.'}
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={3}>
            <Form.Group>
              <Form.Label>Key type</Form.Label>
              <Form.Select
                value={draft.keyType}
                onChange={e => update({ keyType: e.target.value })}
              >
                <option value="ecdsa">ecdsa</option>
                <option value="rsa">rsa</option>
              </Form.Select>
            </Form.Group>
          </Col>
          {draft.keyType === 'rsa' ? (
            <Col md={3}>
              <Form.Group>
                <Form.Label>RSA key size</Form.Label>
                <Form.Select
                  value={draft.rsaKeySize ?? 2048}
                  onChange={e => update({ rsaKeySize: Number.parseInt(e.target.value, 10) })}
                >
                  <option value={2048}>2048</option>
                  <option value={3072}>3072</option>
                  <option value={4096}>4096</option>
                  <option value={8192}>8192</option>
                </Form.Select>
              </Form.Group>
            </Col>
          ) : null}
          <Col xs={12}>
            <Form.Check
              type="switch"
              label="Allow expanding existing lineage with new SANs (--expand)"
              checked={draft.expanding}
              onChange={e => update({ expanding: e.target.checked })}
            />
          </Col>
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

CertEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  cert: PropTypes.shape({ id: PropTypes.string, certName: PropTypes.string }),
  doc: stateDocShape.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
