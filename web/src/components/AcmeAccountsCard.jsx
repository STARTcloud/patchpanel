import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Table } from 'react-bootstrap';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const SERVER_OPTIONS = Object.freeze([
  {
    value: 'letsencrypt',
    label: "Let's Encrypt (production)",
    requiresEab: false,
  },
  {
    value: 'letsencrypt-staging',
    label: "Let's Encrypt (staging)",
    requiresEab: false,
  },
  { value: 'zerossl', label: 'ZeroSSL', requiresEab: true },
  { value: 'buypass', label: 'Buypass', requiresEab: false },
  { value: 'google', label: 'Google Trust Services', requiresEab: true },
  { value: 'custom', label: 'Custom (specify directoryUrl)', requiresEab: false },
]);

const SERVER_BADGE_VARIANT = Object.freeze({
  letsencrypt: 'success',
  'letsencrypt-staging': 'warning',
  zerossl: 'info',
  buypass: 'info',
  google: 'info',
  custom: 'secondary',
});

const emptyAccount = () => ({
  id: '',
  description: '',
  email: '',
  server: 'letsencrypt',
  directoryUrl: '',
  eabKid: '',
  eabHmacKey: '',
});

const accountForEdit = source => ({
  ...emptyAccount(),
  ...source,
  description: source.description ?? '',
  directoryUrl: source.directoryUrl ?? '',
  eabKid: source.eabKid ?? '',
  eabHmacKey: source.eabHmacKey ?? '',
});

const sanitizeForSave = draft => {
  const out = { id: draft.id, email: draft.email, server: draft.server };
  if (draft.description?.trim()) {
    out.description = draft.description.trim();
  }
  if (draft.server === 'custom' && draft.directoryUrl?.trim()) {
    out.directoryUrl = draft.directoryUrl.trim();
  }
  if (draft.eabKid?.trim() && draft.eabHmacKey?.trim()) {
    out.eabKid = draft.eabKid.trim();
    out.eabHmacKey = draft.eabHmacKey.trim();
  }
  return out;
};

const validate = (draft, takenIds, takenTuples) => {
  if (!ID_REGEX.test(draft.id)) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  if (takenIds.has(draft.id)) {
    return `id "${draft.id}" is already used`;
  }
  if (!EMAIL_REGEX.test(draft.email)) {
    return 'email is required and must be valid';
  }
  if (!SERVER_OPTIONS.some(s => s.value === draft.server)) {
    return 'unknown server';
  }
  if (draft.server === 'custom' && !draft.directoryUrl?.trim()) {
    return 'directoryUrl is required when server is "custom"';
  }
  const serverOpt = SERVER_OPTIONS.find(s => s.value === draft.server);
  if (serverOpt?.requiresEab && (!draft.eabKid?.trim() || !draft.eabHmacKey?.trim())) {
    return `${serverOpt.label} requires External Account Binding — set both eabKid and eabHmacKey`;
  }
  const hasOneEab = Boolean(draft.eabKid?.trim()) !== Boolean(draft.eabHmacKey?.trim());
  if (hasOneEab) {
    return 'eabKid and eabHmacKey must be set together (or both empty)';
  }
  const tuple = `${draft.email}|${draft.server}|${draft.directoryUrl?.trim() ?? ''}`;
  if (takenTuples.has(tuple)) {
    return `another account already uses email "${draft.email}" on server "${draft.server}"`;
  }
  return null;
};

const AccountEditModal = ({ show, account, takenIds, takenTuples, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => (account ? accountForEdit(account) : emptyAccount()));
  const [error, setError] = useState(null);
  const isExisting = Boolean(account?.id);
  const update = patch => setDraft(prev => ({ ...prev, ...patch }));
  const serverOpt = SERVER_OPTIONS.find(s => s.value === draft.server);

  const handleSave = () => {
    const idsForCheck = new Set(takenIds);
    if (isExisting) {
      idsForCheck.delete(account.id);
    }
    const tuplesForCheck = new Set(takenTuples);
    if (isExisting) {
      tuplesForCheck.delete(`${account.email}|${account.server}|${account.directoryUrl ?? ''}`);
    }
    const message = validate(draft, idsForCheck, tuplesForCheck);
    if (message) {
      setError(message);
      return;
    }
    onSave(sanitizeForSave(draft));
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting ? `Edit ACME account: ${account.id}` : 'New ACME account'}
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
                placeholder="e.g. default or work-zerossl"
              />
              <Form.Text className="text-muted">
                Stable identifier. Certs reference accounts by id.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Description (optional)</Form.Label>
              <Form.Control
                type="text"
                value={draft.description}
                onChange={e => update({ description: e.target.value })}
                placeholder="What this account is for"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Account email</Form.Label>
              <Form.Control
                type="email"
                value={draft.email}
                onChange={e => update({ email: e.target.value })}
                placeholder="you@example.com"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>ACME server</Form.Label>
              <Form.Select value={draft.server} onChange={e => update({ server: e.target.value })}>
                {SERVER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          {draft.server === 'custom' ? (
            <Col xs={12}>
              <Form.Group>
                <Form.Label>Directory URL</Form.Label>
                <Form.Control
                  type="text"
                  value={draft.directoryUrl}
                  onChange={e => update({ directoryUrl: e.target.value })}
                  placeholder="https://acme.example.com/directory"
                />
              </Form.Group>
            </Col>
          ) : null}
          <Col md={6}>
            <Form.Group>
              <Form.Label>
                EAB Key ID
                {serverOpt?.requiresEab ? (
                  <Badge bg="warning" text="dark" className="ms-2">
                    required
                  </Badge>
                ) : null}
              </Form.Label>
              <Form.Control
                type="text"
                value={draft.eabKid}
                onChange={e => update({ eabKid: e.target.value })}
                placeholder={serverOpt?.requiresEab ? 'from CA dashboard' : 'optional'}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>
                EAB HMAC Key
                {serverOpt?.requiresEab ? (
                  <Badge bg="warning" text="dark" className="ms-2">
                    required
                  </Badge>
                ) : null}
              </Form.Label>
              <Form.Control
                type="text"
                value={draft.eabHmacKey}
                onChange={e => update({ eabHmacKey: e.target.value })}
                placeholder={serverOpt?.requiresEab ? 'from CA dashboard' : 'optional'}
              />
            </Form.Group>
          </Col>
        </Row>
        {serverOpt?.requiresEab ? (
          <Alert variant="info" className="small mt-3 mb-0">
            {serverOpt.label} requires External Account Binding. Generate the key ID + HMAC pair in
            the CA dashboard and paste them above before saving.
          </Alert>
        ) : null}
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

AccountEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  account: PropTypes.object,
  takenIds: PropTypes.instanceOf(Set).isRequired,
  takenTuples: PropTypes.instanceOf(Set).isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export const AcmeAccountsCard = ({ doc, onSave }) => {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState(null);
  const accounts = doc.acmeAccounts ?? [];
  const takenIds = new Set(accounts.map(a => a.id));
  const takenTuples = new Set(accounts.map(a => `${a.email}|${a.server}|${a.directoryUrl ?? ''}`));

  const certsByAccountId = (() => {
    const map = new Map();
    for (const cert of doc.tls?.certs ?? []) {
      if (cert.acmeAccountId) {
        map.set(cert.acmeAccountId, (map.get(cert.acmeAccountId) ?? 0) + 1);
      }
    }
    return map;
  })();

  const persist = async nextAccounts => {
    setError(null);
    try {
      await onSave({ ...doc, acmeAccounts: nextAccounts });
    } catch (err) {
      setError(err);
    }
  };

  const handleAdd = next => {
    setShowNew(false);
    persist([...accounts, next]);
  };
  const handleUpdate = next => {
    setEditing(null);
    persist(accounts.map(a => (a.id === next.id ? next : a)));
  };
  const handleDelete = id => {
    const refCount = certsByAccountId.get(id) ?? 0;
    if (refCount > 0) {
      setError(new Error(`Cannot delete: ${refCount} cert(s) still reference this account`));
      return;
    }
    persist(accounts.filter(a => a.id !== id));
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
        <div>
          <h6 className="mb-0">ACME accounts</h6>
          <p className="text-muted small mb-0">
            Each account = an email registered with one ACME CA. Multiple accounts let you split
            certs across CAs, separate rate-limit pools, or run staging + prod side-by-side.
          </p>
        </div>
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => setShowNew(true)}
          disabled={!onSave}
        >
          <i className="bi bi-plus-lg me-1" />
          Add account
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      {accounts.length === 0 ? (
        <Alert variant="warning" className="small mb-0">
          No ACME accounts defined. Every non-BYO cert needs one — add at least one before issuing.
        </Alert>
      ) : (
        <Table size="sm" responsive className="mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Server</th>
              <th>EAB</th>
              <th>Used by</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => {
              const refCount = certsByAccountId.get(a.id) ?? 0;
              const variant = SERVER_BADGE_VARIANT[a.server] ?? 'secondary';
              return (
                <tr key={a.id}>
                  <td>
                    <code>{a.id}</code>
                    {a.description ? <div className="text-muted small">{a.description}</div> : null}
                  </td>
                  <td>
                    <code className="small">{a.email}</code>
                  </td>
                  <td>
                    <Badge bg={variant} text={variant === 'warning' ? 'dark' : undefined}>
                      {a.server}
                    </Badge>
                    {a.server === 'custom' && a.directoryUrl ? (
                      <div className="text-muted small">{a.directoryUrl}</div>
                    ) : null}
                  </td>
                  <td>
                    {a.eabKid ? (
                      <Badge bg="success">set</Badge>
                    ) : (
                      <span className="text-muted small">—</span>
                    )}
                  </td>
                  <td>
                    <Badge bg={refCount > 0 ? 'info' : 'secondary'}>{refCount} cert(s)</Badge>
                  </td>
                  <td className="text-end text-nowrap">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="me-1"
                      onClick={() => setEditing(a)}
                      disabled={!onSave}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDelete(a.id)}
                      disabled={!onSave || refCount > 0}
                      title={
                        refCount > 0 ? `${refCount} cert(s) still reference this account` : 'Delete'
                      }
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {showNew ? (
        <AccountEditModal
          show
          takenIds={takenIds}
          takenTuples={takenTuples}
          onSave={handleAdd}
          onCancel={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <AccountEditModal
          show
          account={editing}
          takenIds={takenIds}
          takenTuples={takenTuples}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </>
  );
};

AcmeAccountsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
