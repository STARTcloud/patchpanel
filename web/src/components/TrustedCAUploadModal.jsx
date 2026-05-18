import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';

// Upload a trusted CA bundle (PEM with one or more X.509 certs). Mirrors the
// BYO-cert upload flow but simpler — no private key, no SAN check, no need to
// auto-create a TLS provider. The server validates the PEM, writes
// /data/trusted-cas/<id>.pem, and returns parsed metadata. The modal then
// augments state.trustedCas with the new entry and calls onUploaded so the
// page can persist via PUT /api/state.

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
    .replace(/[^a-z0-9-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (ID_REGEX.test(base)) {
    return base.slice(0, 63);
  }
  return `ca-${base.slice(0, 60)}`;
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
  const { t } = useTranslation(['cert']);
  const onFile = async e => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      onChange(text);
    } catch {
      // FileReader error — user can paste manually instead.
    }
  };
  return (
    <Form.Group className="mb-2">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">
          {t('cert:trustedCa.upload.pemLabel', 'CA bundle PEM')}
        </Form.Label>
        <Form.Control
          key={fileInputKey}
          type="file"
          size="sm"
          accept=".pem,.crt,.cer,.ca-bundle"
          onChange={onFile}
          style={{ maxWidth: '14rem' }}
        />
      </div>
      <Form.Control
        as="textarea"
        rows={8}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
      />
      <Form.Text className="text-muted">
        {t('cert:trustedCa.upload.pemHelpPrefix', 'Paste or drop a PEM bundle. Multiple')}{' '}
        <code>BEGIN CERTIFICATE</code>{' '}
        {t('cert:trustedCa.upload.pemHelpSuffix', 'blocks (root + intermediates) are fine.')}
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
  const { t } = useTranslation(['cert']);
  if (!result) {
    return null;
  }
  if (result.ok) {
    const info = result.info ?? {};
    return (
      <Alert variant="success" className="mb-2 small">
        <div className="d-flex justify-content-between mb-1">
          <strong>{t('cert:trustedCa.upload.validated', 'Validated.')}</strong>
          <Badge bg="success">{t('cert:trustedCa.upload.readyToSave', 'ready to save')}</Badge>
        </div>
        <div>
          <strong>{t('cert:trustedCa.upload.subject', 'Subject:')}</strong>{' '}
          {info.subjectSummary ?? t('cert:trustedCa.upload.none', '(none)')}
        </div>
        <div>
          <strong>{t('cert:trustedCa.upload.fingerprint', 'Fingerprint (SHA-256):')}</strong>{' '}
          <code className="small">{info.fingerprint}</code>
        </div>
        <div>
          <strong>{t('cert:trustedCa.upload.earliestNotAfter', 'Earliest notAfter:')}</strong>{' '}
          {info.notAfter ? new Date(info.notAfter).toLocaleDateString() : '?'}
        </div>
        <div>
          <strong>{t('cert:trustedCa.upload.chainLength', 'Chain length:')}</strong>{' '}
          {t('cert:trustedCa.upload.certCount', '{{count}} cert', { count: info.certCount })}
        </div>
        {result.warnings?.length > 0 ? (
          <div className="mt-2">
            <strong>{t('cert:trustedCa.upload.warnings', 'Warnings:')}</strong>
            <ul className="mb-0 ps-3">
              {result.warnings.map(w => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Alert>
    );
  }
  return (
    <Alert variant="danger" className="mb-2 small">
      <strong>{t('cert:trustedCa.upload.validationFailed', 'Validation failed.')}</strong>
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
  if (info?.subjectSummary) {
    entry.subjectSummary = info.subjectSummary;
  }
  if (info?.notAfter) {
    entry.notAfter = info.notAfter;
  }
  if (info?.certCount) {
    entry.certCount = info.certCount;
  }
  return { ...doc, trustedCas: [...(doc.trustedCas ?? []), entry] };
};

export const TrustedCAUploadModal = ({ show, doc, onUploaded, onCancel }) => {
  const { t } = useTranslation(['cert', 'common']);
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
    () => new Set((doc?.trustedCas ?? []).map(ca => ca.id)),
    [doc?.trustedCas]
  );
  const takenNames = useMemo(
    () => new Set((doc?.trustedCas ?? []).map(ca => ca.name)),
    [doc?.trustedCas]
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
      const result = await apiPost('api/trusted-cas/validate', { pem });
      setValidation(result);
      if (result?.ok && !autoFilled && !id && name) {
        setId(uniqueId(deriveIdFromName(name), takenIds));
        setAutoFilled(true);
      }
    } catch (err) {
      setNetworkError(
        err.message ?? t('cert:trustedCa.upload.validationFailedReq', 'validation request failed')
      );
    }
  };

  const handleUpload = async () => {
    setNetworkError(null);
    setUploading(true);
    try {
      const uploadResult = await apiPost('api/trusted-cas/upload', { id, pem });
      if (!uploadResult.ok) {
        setValidation(uploadResult);
        return;
      }
      const nextDoc = buildAugmentedDoc({ doc, id, name, description, info: uploadResult.info });
      await onUploaded(nextDoc, { id, name, info: uploadResult.info });
    } catch (err) {
      setNetworkError(
        err.message ?? t('cert:trustedCa.upload.uploadFailedReq', 'upload request failed')
      );
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
          <i className="bi bi-shield-plus me-2" />
          {t('cert:trustedCa.upload.title', 'Upload trusted CA bundle')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="info" className="small mb-3">
          {t(
            'cert:trustedCa.upload.descPrefix',
            'A trusted CA is a PEM bundle (root + optional intermediates) that HAProxy uses to verify peer certificates. Use it on a'
          )}{' '}
          <strong>{t('cert:trustedCa.upload.frontendBind', 'frontend bind')}</strong>{' '}
          {t('cert:trustedCa.upload.descMiddle', 'for mTLS client cert validation, or on a')}{' '}
          <strong>{t('cert:trustedCa.upload.backendServer', 'backend server')}</strong>{' '}
          {t('cert:trustedCa.upload.descSuffix', "to validate an upstream's TLS chain.")}
        </Alert>
        <Row className="g-3">
          <Col xs={12}>
            <PemTextarea value={pem} onChange={updatePem} fileInputKey={`pem-${fileInputBump}`} />
          </Col>
          <Col xs={12}>
            <ValidationPanel result={validation} />
            {networkError ? (
              <Alert variant="warning" className="mb-0 small">
                {t('cert:trustedCa.upload.requestFailed', 'Request failed: {{message}}', {
                  message: networkError,
                })}
              </Alert>
            ) : null}
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('cert:trustedCa.upload.friendlyName', 'Friendly name')}</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('cert:trustedCa.upload.namePlaceholder', 'e.g. Corporate-Root-2026')}
                isInvalid={name.length > 0 ? !nameValid : null}
              />
              <Form.Text className="text-muted">
                {t('cert:trustedCa.upload.nameHelpPrefix', 'Display name. Letters/digits/')}
                <code>._-</code>
                {t('cert:trustedCa.upload.nameHelpSuffix', ', starting with a letter.')}
              </Form.Text>
              {takenNames.has(name) ? (
                <Form.Text className="text-danger">
                  {t('cert:trustedCa.upload.nameTaken', 'name already used')}
                </Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('cert:trustedCa.upload.idLabel', 'ID')}</Form.Label>
              <Form.Control
                type="text"
                value={id}
                onChange={e => {
                  setId(e.target.value);
                  setAutoFilled(true);
                }}
                placeholder={t('cert:trustedCa.upload.idPlaceholder', 'auto-derived from name')}
                isInvalid={id.length > 0 ? !idValid : null}
              />
              <Form.Text className="text-muted">
                {t(
                  'cert:trustedCa.upload.idHelpPrefix',
                  'Stable identifier; used in state refs and as the on-disk filename. Lowercase a-z, 0-9,'
                )}{' '}
                <code>_-</code>
                {t('cert:trustedCa.upload.idHelpSuffix', ', starting with a letter.')}
              </Form.Text>
              {takenIds.has(id) ? (
                <Form.Text className="text-danger">
                  {t('cert:trustedCa.upload.idTaken', 'id already used')}
                </Form.Text>
              ) : null}
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>
                {t('cert:trustedCa.upload.description', 'Description (optional)')}
              </Form.Label>
              <Form.Control
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t(
                  'cert:trustedCa.upload.descriptionPlaceholder',
                  'What this CA is for'
                )}
              />
            </Form.Group>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={uploading}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button
          variant="outline-primary"
          onClick={handleValidate}
          disabled={!canValidate || uploading}
        >
          {t('cert:trustedCa.upload.validate', 'Validate')}
        </Button>
        <Button variant="primary" onClick={handleUpload} disabled={!canUpload || uploading}>
          {uploading ? (
            <>
              <Spinner as="span" animation="border" size="sm" />{' '}
              {t('cert:trustedCa.upload.uploading', 'Uploading…')}
            </>
          ) : (
            t('common:buttons.upload', 'Upload')
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

TrustedCAUploadModal.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: PropTypes.object.isRequired,
  onUploaded: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
