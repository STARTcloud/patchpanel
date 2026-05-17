import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';

import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { useConfirmation } from '../hooks/useConfirmation.jsx';

// API token management UI. Mirrors Armor's CreateKeyModal copy-once UX:
// after POST /api/api-tokens, the secret is displayed exactly once with
// a copy button and a sample curl line. Subsequent list views show only
// keyId + name + dates.

const EXPIRY_PRESETS = Object.freeze([
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '180 days', days: 180 },
  { label: '1 year', days: 365 },
  { label: 'Never', days: null },
]);

const formatDate = iso => (iso ? new Date(iso).toLocaleString() : '—');

const expiryStatus = expiresAt => {
  if (!expiresAt) {
    return <Badge bg="secondary">never</Badge>;
  }
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms < 0) {
    return <Badge bg="danger">expired</Badge>;
  }
  const days = Math.ceil(ms / 86_400_000);
  return (
    <Badge bg={days <= 14 ? 'warning' : 'info'}>
      in {days} day{days === 1 ? '' : 's'}
    </Badge>
  );
};

const CreateTokenModal = ({ show, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [expiryDays, setExpiryDays] = useState(90);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const reset = () => {
    setName('');
    setExpiryDays(90);
    setError(null);
    setCreated(null);
  };

  const handleClose = () => {
    if (created) {
      onCreated(created.token);
    }
    reset();
    onClose();
  };

  const submit = async event => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const expiresAt =
        expiryDays === null ? null : new Date(Date.now() + expiryDays * 86_400_000).toISOString();
      const data = await apiPost('api/api-tokens', { name, expiresAt });
      setCreated(data);
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'failed to create token');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {created ? (
            <>
              <i className="bi bi-check-circle text-success me-2" />
              Token created
            </>
          ) : (
            <>
              <i className="bi bi-plus-circle me-2" />
              New API token
            </>
          )}
        </Modal.Title>
      </Modal.Header>
      {created ? (
        <>
          <Modal.Body>
            <Alert variant="warning" className="py-2 small mb-3">
              <i className="bi bi-exclamation-triangle me-2" />
              Copy this token now — it will <strong>not</strong> be shown again.
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label>Token</Form.Label>
              <div className="d-flex gap-2">
                <Form.Control type="text" value={created.wire} readOnly />
                <Button
                  variant="outline-primary"
                  onClick={() => navigator.clipboard.writeText(created.wire)}
                >
                  <i className="bi bi-clipboard" />
                </Button>
              </div>
            </Form.Group>
            <Form.Group>
              <Form.Label>Usage example</Form.Label>
              <pre
                className="small p-2 bg-body-tertiary border rounded"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
              >
                {`curl -H "Authorization: Bearer ${created.wire}" \\
     ${window.location.origin}/api/state`}
              </pre>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="primary" onClick={handleClose}>
              I&apos;ve saved the token
            </Button>
          </Modal.Footer>
        </>
      ) : (
        <Form onSubmit={submit}>
          <Modal.Body>
            {error ? (
              <Alert variant="danger" className="py-2 small mb-3">
                {error}
              </Alert>
            ) : null}
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="ci-pipeline, backup-script, …"
                required
              />
              <Form.Text className="text-muted">
                Human-readable label. Letters, digits, space, dot, underscore, hyphen.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Expires</Form.Label>
              <Form.Select
                value={expiryDays === null ? 'never' : String(expiryDays)}
                onChange={e =>
                  setExpiryDays(
                    e.target.value === 'never' ? null : Number.parseInt(e.target.value, 10)
                  )
                }
              >
                {EXPIRY_PRESETS.map(opt => (
                  <option key={opt.label} value={opt.days === null ? 'never' : String(opt.days)}>
                    {opt.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Creating…
                </>
              ) : (
                'Create token'
              )}
            </Button>
          </Modal.Footer>
        </Form>
      )}
    </Modal>
  );
};

CreateTokenModal.propTypes = {
  show: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
};

const renderTokensList = ({ loading, tokens, onRevoke }) => {
  if (loading) {
    return (
      <div className="d-flex justify-content-center py-3">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }
  if (tokens.length === 0) {
    return (
      <Alert variant="light" className="border small mb-0">
        No API tokens yet. Click <strong>New token</strong> to mint one.
      </Alert>
    );
  }
  return (
    <Table size="sm" hover className="mb-0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Key ID</th>
          <th>Created</th>
          <th>Last used</th>
          <th>Expires</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {tokens.map(t => (
          <tr key={t.keyId}>
            <td>{t.name}</td>
            <td>
              <code>{t.keyId}</code>
            </td>
            <td>{formatDate(t.createdAt)}</td>
            <td>{formatDate(t.lastUsedAt)}</td>
            <td>{expiryStatus(t.expiresAt)}</td>
            <td>
              <Button variant="outline-danger" size="sm" onClick={() => onRevoke(t.keyId)}>
                <i className="bi bi-trash" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

export const ApiTokensManager = () => {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const { confirm, ConfirmationDialog } = useConfirmation();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('api/api-tokens');
      setTokens(data?.tokens ?? []);
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load. Inlined (rather than calling reload()) so the lint rule
  // react-hooks/set-state-in-effect can see that setState only happens
  // inside the .then/.catch callback. reload remains for use after create/
  // revoke.
  useEffect(() => {
    let cancelled = false;
    apiGet('api/api-tokens')
      .then(data => {
        if (cancelled) {
          return;
        }
        setTokens(data?.tokens ?? []);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) {
          return;
        }
        setError(err.payload?.message ?? err.message ?? 'failed to load tokens');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const revoke = async keyId => {
    const ok = await confirm({
      title: 'Revoke API token?',
      body: (
        <p className="mb-2">
          Revoke token <code>{keyId}</code>? Any scripts using it will start receiving 401 responses
          immediately. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Revoke token',
      confirmVariant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await apiDelete(`api/api-tokens/${encodeURIComponent(keyId)}`);
      await reload();
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'failed to revoke');
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <Card.Title className="mb-1">
              <i className="bi bi-key me-2" />
              API tokens
            </Card.Title>
            <Card.Text className="text-muted small mb-0">
              Programmatic access via <code>Authorization: Bearer pp_…</code>. The secret is shown
              once at creation and cannot be retrieved later — revoke and re-issue if lost.
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <i className="bi bi-plus-lg me-1" />
            New token
          </Button>
        </div>
        {error ? (
          <Alert variant="danger" className="py-2 small">
            {error}
          </Alert>
        ) : null}
        {renderTokensList({ loading, tokens, onRevoke: revoke })}
      </Card.Body>
      <CreateTokenModal show={showCreate} onClose={() => setShowCreate(false)} onCreated={reload} />
      <ConfirmationDialog />
    </Card>
  );
};
