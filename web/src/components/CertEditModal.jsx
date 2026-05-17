import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';

import { apiPost, buildUrl } from '../api/client.js';
import { stateDocShape } from '../prop-shapes.js';

import { ListEditor } from './ListEditor.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const HOSTNAME_REGEX = /^[a-zA-Z0-9*][a-zA-Z0-9.*-]{0,252}$/u;
const CERT_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const NAME_REGEX = /^[a-zA-Z0-9._-]+$/u;
const BYO_UPLOAD_OPTION = '__byo_upload__';

const emptyCert = () => ({
  id: '',
  certName: '',
  domains: [],
  providerId: '',
  acmeAccountId: '',
  expanding: true,
  keyType: 'ecdsa',
});

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

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

const buildAugmentedDocForByoUpload = ({ doc, name, info }) => {
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

const validateAcmeMetadata = draft => {
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
  if (!draft.acmeAccountId) {
    return 'ACME account is required';
  }
  if (draft.keyType === 'rsa' && draft.rsaKeySize) {
    if (![2048, 3072, 4096, 8192].includes(draft.rsaKeySize)) {
      return 'rsaKeySize must be 2048, 3072, 4096, or 8192';
    }
  }
  return null;
};

const validateByoMetadata = draft => {
  if (!CERT_NAME_REGEX.test(draft.certName)) {
    return 'certName must be a valid filesystem-safe certificate name';
  }
  if (draft.domains.length === 0) {
    return 'at least one domain is required';
  }
  return null;
};

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
      // FileReader error — user can paste manually instead.
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
          <Badge bg="success">ready</Badge>
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

const ProviderSelectField = ({ value, onChange, providers, locked }) => (
  <Form.Group>
    <Form.Label>TLS provider</Form.Label>
    <Form.Select value={value} disabled={locked} onChange={e => onChange(e.target.value)}>
      <option value="">— choose —</option>
      {providers.map(p => (
        <option key={p.id} value={p.id}>
          {p.type}:{p.id}
        </option>
      ))}
      <option value={BYO_UPLOAD_OPTION}>Upload my own cert (BYO)</option>
    </Form.Select>
    {locked ? (
      <Form.Text className="text-muted">Provider is locked once a cert is created.</Form.Text>
    ) : null}
  </Form.Group>
);

ProviderSelectField.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  providers: PropTypes.array.isRequired,
  locked: PropTypes.bool,
};

const AcmeMetadataBody = ({ draft, update, doc, isExisting }) => {
  const acmeAccounts = doc.acmeAccounts ?? [];
  return (
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
          <Form.Label>ACME account</Form.Label>
          <Form.Select
            value={draft.acmeAccountId ?? ''}
            onChange={e => update({ acmeAccountId: e.target.value || undefined })}
          >
            <option value="">— choose —</option>
            {acmeAccounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.id} ({a.email} · {a.server})
              </option>
            ))}
          </Form.Select>
        </Form.Group>
      </Col>
      <Col md={3}>
        <Form.Group>
          <Form.Label>Key type</Form.Label>
          <Form.Select value={draft.keyType} onChange={e => update({ keyType: e.target.value })}>
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
  );
};

AcmeMetadataBody.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: stateDocShape.isRequired,
  isExisting: PropTypes.bool.isRequired,
};

const PemEditor = ({
  fullchainPem,
  setFullchainPem,
  privkeyPem,
  setPrivkeyPem,
  validation,
  networkError,
  fileInputBump,
}) => (
  <>
    <PemTextarea
      label="Fullchain PEM (leaf + intermediates)"
      value={fullchainPem}
      onChange={setFullchainPem}
      placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
      fileAccept=".pem,.crt,.cer,.cert"
      fileInputKey={`fc-${fileInputBump}`}
    />
    <PemTextarea
      label="Private key PEM (matching private key)"
      value={privkeyPem}
      onChange={setPrivkeyPem}
      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
      fileAccept=".pem,.key"
      fileInputKey={`pk-${fileInputBump}`}
    />
    <ValidationPanel result={validation} />
    {networkError ? (
      <Alert variant="warning" className="mb-0 small">
        Request failed: {networkError}
      </Alert>
    ) : null}
  </>
);

PemEditor.propTypes = {
  fullchainPem: PropTypes.string.isRequired,
  setFullchainPem: PropTypes.func.isRequired,
  privkeyPem: PropTypes.string.isRequired,
  setPrivkeyPem: PropTypes.func.isRequired,
  validation: PropTypes.object,
  networkError: PropTypes.string,
  fileInputBump: PropTypes.number.isRequired,
};

const ByoNewBody = ({ pem, name, setName, nameValid }) => (
  <Row className="g-3">
    <Col xs={12}>
      <Alert variant="info" className="small mb-0">
        Paste in your fullchain + private key, give it a name, click Validate then Upload.
        patchpanel writes the PEM files to disk and adds the matching Certificate entry — no need to
        wire up a TLS provider separately.
      </Alert>
    </Col>
    <Col xs={12}>
      <PemEditor {...pem} />
    </Col>
    <Col md={8}>
      <Form.Group>
        <Form.Label>Name</Form.Label>
        <Form.Control
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="auto-filled from the cert's first SAN"
          isInvalid={name.length > 0 ? !nameValid : null}
        />
        <Form.Text className="text-muted">
          Used as the on-disk folder name and the entry name in the certificates list.
          Filesystem-safe characters only. Auto-filled from the cert&apos;s first SAN after
          validation; override before uploading if you want.
        </Form.Text>
      </Form.Group>
    </Col>
  </Row>
);

ByoNewBody.propTypes = {
  pem: PropTypes.object.isRequired,
  name: PropTypes.string.isRequired,
  setName: PropTypes.func.isRequired,
  nameValid: PropTypes.bool.isRequired,
};

const ByoEditBody = ({
  cert,
  liveCert,
  draft,
  update,
  pem,
  replaceState,
  canReplace,
  onReplace,
}) => {
  const fullchainUrl = buildUrl(`api/byo-certs/${encodeURIComponent(cert.certName)}/fullchain.pem`);
  const privkeyUrl = buildUrl(`api/byo-certs/${encodeURIComponent(cert.certName)}/privkey.pem`);
  const newest = liveCert?.newest;
  return (
    <>
      <Row className="g-2 mb-3">
        <Col xs={12}>
          <div className="small">
            <div>
              <strong>certName:</strong> <code>{cert.certName}</code>
            </div>
            <div>
              <strong>SANs:</strong>{' '}
              {(cert.domains ?? []).map(d => (
                <Badge key={d} bg="info" className="me-1">
                  {d}
                </Badge>
              ))}
            </div>
            <div>
              <strong>Lineage on disk:</strong>{' '}
              {newest ? (
                <>
                  valid {newest.notBefore ? new Date(newest.notBefore).toLocaleDateString() : '?'} →{' '}
                  {newest.notAfter ? new Date(newest.notAfter).toLocaleDateString() : '?'}
                </>
              ) : (
                <span className="text-warning">no PEM loaded</span>
              )}
            </div>
          </div>
        </Col>
        <Col xs={12} className="d-flex gap-2 flex-wrap">
          <Button
            variant="outline-secondary"
            size="sm"
            href={fullchainUrl}
            download={`${cert.certName}-fullchain.pem`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <i className="bi bi-download me-1" />
            Download fullchain.pem
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            href={privkeyUrl}
            download={`${cert.certName}-privkey.pem`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <i className="bi bi-download me-1" />
            Download privkey.pem
          </Button>
        </Col>
      </Row>
      <details className="mb-3">
        <summary className="small fw-semibold text-muted text-uppercase">Replace PEM</summary>
        <div className="pt-2">
          <Alert variant="warning" className="small">
            Paste new fullchain + private key below, click Validate, then Replace. The old PEM is
            overwritten on disk; if the new cert has different SANs the cert entry&apos;s domains
            are updated to match.
          </Alert>
          <PemEditor {...pem} />
          <div className="d-flex gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              onClick={pem.onValidate}
              disabled={!pem.canValidate || replaceState.running}
            >
              Validate
            </Button>
            <Button
              variant="warning"
              size="sm"
              onClick={onReplace}
              disabled={!canReplace || replaceState.running}
            >
              {replaceState.running ? (
                <>
                  <Spinner as="span" size="sm" animation="border" /> Replacing…
                </>
              ) : (
                'Replace PEM'
              )}
            </Button>
          </div>
          {replaceState.message ? (
            <Alert variant={replaceState.ok ? 'success' : 'danger'} className="small mt-2 mb-0">
              {replaceState.message}
            </Alert>
          ) : null}
        </div>
      </details>
      <details>
        <summary className="small fw-semibold text-muted text-uppercase">Metadata</summary>
        <div className="pt-2">
          <Row className="g-3">
            <Col md={6}>
              <Form.Group>
                <Form.Label>certName</Form.Label>
                <Form.Control
                  type="text"
                  value={draft.certName}
                  onChange={e => update({ certName: e.target.value })}
                />
                <Form.Text className="text-muted">
                  The folder name on disk. Renaming after upload is not recommended — the existing
                  PEM files stay under the original name.
                </Form.Text>
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <Form.Label>Domains (SANs)</Form.Label>
                <ListEditor
                  items={draft.domains}
                  onChange={list => update({ domains: list })}
                  placeholder="e.g. www.example.com"
                  validate={value => (HOSTNAME_REGEX.test(value) ? true : 'invalid domain')}
                />
                <Form.Text className="text-muted">
                  Auto-derived from the cert&apos;s SANs at upload time. Edits here only change what
                  HAProxy advertises for SNI; they don&apos;t change the actual PEM bytes.
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>
        </div>
      </details>
    </>
  );
};

ByoEditBody.propTypes = {
  cert: PropTypes.object.isRequired,
  liveCert: PropTypes.object,
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  pem: PropTypes.object.isRequired,
  replaceState: PropTypes.object.isRequired,
  canReplace: PropTypes.bool.isRequired,
  onReplace: PropTypes.func.isRequired,
};

const findProvider = (providers, id) => providers.find(p => p.id === id) ?? null;
const isByoProviderType = (providers, id) => findProvider(providers, id)?.type === 'byo';
const resolveByoMode = (selection, providers) => {
  if (selection === BYO_UPLOAD_OPTION) {
    return true;
  }
  return isByoProviderType(providers, selection);
};

const computeHeaderTitle = (isExisting, byoMode, cert) => {
  if (isExisting) {
    return `Edit certificate: ${cert.certName}`;
  }
  return byoMode ? 'Add certificate (upload PEM)' : 'New certificate';
};

const computePrimaryLabel = (isExisting, byoMode, saving) => {
  if (!isExisting && byoMode) {
    return saving ? 'Uploading…' : 'Upload';
  }
  return isExisting ? 'Update' : 'Add';
};

// Picks the body content based on which provider/mode combination is active.
// Pulled out of CertEditModal so the cyclomatic complexity of the main
// component stays under the eslint cap.
const CertEditModalBody = ({
  providerSelection,
  byoMode,
  isExisting,
  cert,
  liveCert,
  draft,
  update,
  doc,
  pemBag,
  byoName,
  setByoName,
  byoNameValid,
  setByoNameAutoFilled,
  replaceState,
  canReplace,
  onReplace,
}) => {
  if (!providerSelection) {
    return (
      <Alert variant="secondary" className="small mb-0">
        Pick a TLS provider above to continue.
      </Alert>
    );
  }
  if (byoMode && !isExisting) {
    return (
      <ByoNewBody
        pem={pemBag}
        name={byoName}
        setName={v => {
          setByoName(v);
          setByoNameAutoFilled(true);
        }}
        nameValid={byoNameValid}
      />
    );
  }
  if (byoMode && isExisting) {
    return (
      <ByoEditBody
        cert={cert}
        liveCert={liveCert}
        draft={draft}
        update={update}
        pem={pemBag}
        replaceState={replaceState}
        canReplace={canReplace}
        onReplace={onReplace}
      />
    );
  }
  return <AcmeMetadataBody draft={draft} update={update} doc={doc} isExisting={isExisting} />;
};

CertEditModalBody.propTypes = {
  providerSelection: PropTypes.string.isRequired,
  byoMode: PropTypes.bool.isRequired,
  isExisting: PropTypes.bool.isRequired,
  cert: PropTypes.object,
  liveCert: PropTypes.object,
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: stateDocShape.isRequired,
  pemBag: PropTypes.object.isRequired,
  byoName: PropTypes.string.isRequired,
  setByoName: PropTypes.func.isRequired,
  byoNameValid: PropTypes.bool.isRequired,
  setByoNameAutoFilled: PropTypes.func.isRequired,
  replaceState: PropTypes.object.isRequired,
  canReplace: PropTypes.bool.isRequired,
  onReplace: PropTypes.func.isRequired,
};

export const CertEditModal = ({ show, cert = null, doc, liveCert = null, onSave, onCancel }) => {
  const isExisting = Boolean(cert?.id);
  const [draft, setDraft] = useState(() => cert ?? emptyCert());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [providerSelection, setProviderSelection] = useState(() =>
    isExisting ? cert.providerId : ''
  );
  const [fullchainPem, setFullchainPem] = useState('');
  const [privkeyPem, setPrivkeyPem] = useState('');
  const [validation, setValidation] = useState(null);
  const [networkError, setNetworkError] = useState(null);
  const [fileInputBump, setFileInputBump] = useState(0);
  const [byoName, setByoName] = useState(isExisting ? cert.certName : '');
  const [byoNameAutoFilled, setByoNameAutoFilled] = useState(isExisting);
  const [replaceState, setReplaceState] = useState({
    running: false,
    ok: null,
    message: null,
  });

  const byoMode = resolveByoMode(providerSelection, doc.tls.providers);
  // Derived rather than mirrored-via-effect: PEM validation result is the
  // sole gate on whether "Replace PEM" is allowed.
  const canReplace = validation?.ok === true;

  const update = patch => setDraft(prev => ({ ...prev, ...patch }));

  // Provider selection drives draft.providerId via the onChange handler
  // (see ProviderSelectField below) rather than via a useEffect — keeps
  // the dataflow linear and avoids cascading renders.
  const handleProviderSelectionChange = next => {
    setProviderSelection(next);
    setValidation(null);
    setNetworkError(null);
    if (next && next !== BYO_UPLOAD_OPTION && !isByoProviderType(doc.tls.providers, next)) {
      setDraft(prev => ({ ...prev, providerId: next }));
    }
  };

  const handleValidatePem = async () => {
    setNetworkError(null);
    setValidation(null);
    try {
      const result = await apiPost('api/byo-certs/validate', { fullchainPem, privkeyPem });
      setValidation(result);
      if (!isExisting && result?.ok && !byoNameAutoFilled && !byoName) {
        setByoName(deriveDefaultName(result.info));
        setByoNameAutoFilled(true);
      }
    } catch (err) {
      setNetworkError(err.message ?? 'validation request failed');
    }
  };

  const handleUploadNewByo = async () => {
    setNetworkError(null);
    setSaving(true);
    try {
      const result = await apiPost('api/byo-certs/upload', {
        name: byoName,
        fullchainPem,
        privkeyPem,
      });
      if (!result.ok) {
        setValidation(result);
        return;
      }
      const nextDoc = buildAugmentedDocForByoUpload({ doc, name: byoName, info: result.info });
      await onSave(nextDoc);
    } catch (err) {
      setNetworkError(err.message ?? 'upload request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReplaceExistingPem = async () => {
    setReplaceState({ running: true, ok: null, message: null });
    try {
      const result = await apiPost('api/byo-certs/upload', {
        name: cert.certName,
        fullchainPem,
        privkeyPem,
      });
      if (!result.ok) {
        setReplaceState({
          running: false,
          ok: false,
          message: result.errors?.join('; ') ?? 'replace failed',
        });
        return;
      }
      const nextDomains = (result.info?.sans ?? []).filter(Boolean);
      const updatedCert = {
        ...cert,
        ...draft,
        domains: nextDomains.length > 0 ? nextDomains : draft.domains,
      };
      const nextDoc = {
        ...doc,
        tls: {
          ...doc.tls,
          certs: doc.tls.certs.map(c => (c.id === cert.id ? updatedCert : c)),
        },
      };
      await onSave(nextDoc);
      setReplaceState({
        running: false,
        ok: true,
        message: 'PEM replaced and state applied.',
      });
      setFullchainPem('');
      setPrivkeyPem('');
      setValidation(null);
      setDraft(updatedCert);
    } catch (err) {
      setReplaceState({
        running: false,
        ok: false,
        message: err.message ?? 'replace request failed',
      });
    }
  };

  const docWithCert = nextCert => {
    if (isExisting) {
      return {
        ...doc,
        tls: {
          ...doc.tls,
          certs: doc.tls.certs.map(c => (c.id === nextCert.id ? nextCert : c)),
        },
      };
    }
    return {
      ...doc,
      tls: { ...doc.tls, certs: [...doc.tls.certs, nextCert] },
    };
  };

  const handleSaveAcmeMetadata = () => {
    const message = validateAcmeMetadata(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(docWithCert(draft));
  };

  const handleSaveByoMetadata = () => {
    const message = validateByoMetadata(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(docWithCert(draft));
  };

  const handlePrimary = () => {
    setError(null);
    if (!isExisting && byoMode) {
      handleUploadNewByo();
    } else if (byoMode) {
      handleSaveByoMetadata();
    } else {
      handleSaveAcmeMetadata();
    }
  };

  const byoNameValid = NAME_REGEX.test(byoName);
  const pemsPresent = fullchainPem.trim().length > 0 && privkeyPem.trim().length > 0;
  const canValidate = pemsPresent;
  const canUploadNew =
    byoMode && !isExisting && byoNameValid && pemsPresent && validation?.ok === true;
  const headerTitle = computeHeaderTitle(isExisting, byoMode, cert);
  const primaryLabel = computePrimaryLabel(isExisting, byoMode, saving);
  const primaryDisabled = saving || (!isExisting && byoMode && !canUploadNew);
  const showValidateButton = !isExisting && byoMode;

  const onPemChange = setter => next => {
    setter(next);
    setValidation(null);
    setFileInputBump(n => n + 1);
  };

  const pemBag = {
    fullchainPem,
    setFullchainPem: onPemChange(setFullchainPem),
    privkeyPem,
    setPrivkeyPem: onPemChange(setPrivkeyPem),
    validation,
    networkError,
    fileInputBump,
    canValidate,
    onValidate: handleValidatePem,
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{headerTitle}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <div className="mb-3">
          <ProviderSelectField
            value={providerSelection}
            onChange={handleProviderSelectionChange}
            providers={doc.tls.providers}
            locked={isExisting}
          />
        </div>
        <CertEditModalBody
          providerSelection={providerSelection}
          byoMode={byoMode}
          isExisting={isExisting}
          cert={cert}
          liveCert={liveCert}
          draft={draft}
          update={update}
          doc={doc}
          pemBag={pemBag}
          byoName={byoName}
          setByoName={setByoName}
          byoNameValid={byoNameValid}
          setByoNameAutoFilled={setByoNameAutoFilled}
          replaceState={replaceState}
          canReplace={canReplace}
          onReplace={handleReplaceExistingPem}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {showValidateButton ? (
          <Button
            variant="outline-primary"
            onClick={handleValidatePem}
            disabled={!canValidate || saving}
          >
            Validate
          </Button>
        ) : null}
        <Button variant="primary" onClick={handlePrimary} disabled={primaryDisabled}>
          {saving ? (
            <>
              <Spinner as="span" size="sm" animation="border" /> {primaryLabel}
            </>
          ) : (
            primaryLabel
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

CertEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  cert: PropTypes.shape({
    id: PropTypes.string,
    certName: PropTypes.string,
    providerId: PropTypes.string,
    domains: PropTypes.arrayOf(PropTypes.string),
  }),
  doc: stateDocShape.isRequired,
  liveCert: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
