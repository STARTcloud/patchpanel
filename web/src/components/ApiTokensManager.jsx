import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { useConfirmation } from '../hooks/useConfirmation.jsx';

// API token management UI. Mirrors Armor's CreateKeyModal copy-once UX:
// after POST /api/api-tokens, the secret is displayed exactly once with
// a copy button and a sample curl line. Subsequent list views show only
// keyId + name + dates.

const EXPIRY_PRESETS = Object.freeze([
  { labelKey: 'auth:apiTokens.expiry30days', fallback: '30 days', days: 30 },
  { labelKey: 'auth:apiTokens.expiry90days', fallback: '90 days', days: 90 },
  { labelKey: 'auth:apiTokens.expiry180days', fallback: '180 days', days: 180 },
  { labelKey: 'auth:apiTokens.expiry1year', fallback: '1 year', days: 365 },
  { labelKey: 'auth:apiTokens.expiryNever', fallback: 'Never', days: null },
]);

const formatDate = iso => (iso ? new Date(iso).toLocaleString() : '—');

const ExpiryStatus = ({ expiresAt }) => {
  const { t } = useTranslation(['auth', 'common']);
  const [now] = useState(() => Date.now());
  if (!expiresAt) {
    return <Badge bg="secondary">{t('auth:apiTokens.statusNever', 'never')}</Badge>;
  }
  const ms = new Date(expiresAt).getTime() - now;
  if (ms < 0) {
    return <Badge bg="danger">{t('auth:apiTokens.statusExpired', 'expired')}</Badge>;
  }
  const days = Math.ceil(ms / 86_400_000);
  return (
    <Badge bg={days <= 14 ? 'warning' : 'info'}>
      {t('auth:apiTokens.statusInDays', { count: days, defaultValue: 'in {{count}} day' })}
    </Badge>
  );
};

ExpiryStatus.propTypes = {
  expiresAt: PropTypes.string,
};

const CreateTokenModal = ({ show, onClose, onCreated }) => {
  const { t } = useTranslation(['auth', 'common']);
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
      setError(
        err.payload?.message ??
          err.message ??
          t('auth:apiTokens.createFailed', 'failed to create token')
      );
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
              {t('auth:apiTokens.tokenCreatedTitle', 'Token created')}
            </>
          ) : (
            <>
              <i className="bi bi-plus-circle me-2" />
              {t('auth:apiTokens.newTokenTitle', 'New API token')}
            </>
          )}
        </Modal.Title>
      </Modal.Header>
      {created ? (
        <>
          <Modal.Body>
            <Alert variant="warning" className="py-2 small mb-3">
              <i className="bi bi-exclamation-triangle me-2" />
              {t('auth:apiTokens.copyWarning')}
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:apiTokens.tokenLabel', 'Token')}</Form.Label>
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
              <Form.Label>{t('auth:apiTokens.usageExample', 'Usage example')}</Form.Label>
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
              {t('auth:apiTokens.savedTokenAck', "I've saved the token")}
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
              <Form.Label>{t('auth:apiTokens.name')}</Form.Label>
              <Form.Control
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('auth:apiTokens.namePlaceholder', 'ci-pipeline, backup-script, …')}
                required
              />
              <Form.Text className="text-muted">
                {t(
                  'auth:apiTokens.nameHelp',
                  'Human-readable label. Letters, digits, space, dot, underscore, hyphen.'
                )}
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:apiTokens.expiresLabel', 'Expires')}</Form.Label>
              <Form.Select
                value={expiryDays === null ? 'never' : String(expiryDays)}
                onChange={e =>
                  setExpiryDays(
                    e.target.value === 'never' ? null : Number.parseInt(e.target.value, 10)
                  )
                }
              >
                {EXPIRY_PRESETS.map(opt => (
                  <option key={opt.labelKey} value={opt.days === null ? 'never' : String(opt.days)}>
                    {t(opt.labelKey, opt.fallback)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleClose} disabled={submitting}>
              {t('common:buttons.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  {t('auth:apiTokens.creating', 'Creating…')}
                </>
              ) : (
                t('auth:apiTokens.create')
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

const TokensList = ({ loading, tokens, onRevoke }) => {
  const { t } = useTranslation(['auth', 'common']);
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
        {t('auth:apiTokens.emptyHintPrefix', 'No API tokens yet. Click')}{' '}
        <strong>{t('auth:apiTokens.newToken', 'New token')}</strong>{' '}
        {t('auth:apiTokens.emptyHintSuffix', 'to mint one.')}
      </Alert>
    );
  }
  return (
    <Table size="sm" hover className="mb-0">
      <thead>
        <tr>
          <th>{t('auth:apiTokens.name')}</th>
          <th>{t('auth:apiTokens.keyId', 'Key ID')}</th>
          <th>{t('auth:apiTokens.createdAt')}</th>
          <th>{t('auth:apiTokens.lastUsed')}</th>
          <th>{t('auth:apiTokens.expiresLabel', 'Expires')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {tokens.map(row => (
          <tr key={row.keyId}>
            <td>{row.name}</td>
            <td>
              <code>{row.keyId}</code>
            </td>
            <td>{formatDate(row.createdAt)}</td>
            <td>{formatDate(row.lastUsedAt)}</td>
            <td>
              <ExpiryStatus expiresAt={row.expiresAt} />
            </td>
            <td>
              <Button variant="outline-danger" size="sm" onClick={() => onRevoke(row.keyId)}>
                <i className="bi bi-trash" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
};

TokensList.propTypes = {
  loading: PropTypes.bool.isRequired,
  tokens: PropTypes.array.isRequired,
  onRevoke: PropTypes.func.isRequired,
};

export const ApiTokensManager = () => {
  const { t } = useTranslation(['auth', 'common']);
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
      setError(
        err.payload?.message ??
          err.message ??
          t('auth:apiTokens.loadFailed', 'failed to load tokens')
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        setError(
          err.payload?.message ??
            err.message ??
            t('auth:apiTokens.loadFailed', 'failed to load tokens')
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const revoke = async keyId => {
    const ok = await confirm({
      title: t('auth:apiTokens.revokeConfirmTitle', 'Revoke API token?'),
      body: (
        <p className="mb-2">
          {t('auth:apiTokens.revokeConfirmBodyPrefix', 'Revoke token')} <code>{keyId}</code>?{' '}
          {t(
            'auth:apiTokens.revokeConfirmBodySuffix',
            'Any scripts using it will start receiving 401 responses immediately. This cannot be undone.'
          )}
        </p>
      ),
      confirmLabel: t('auth:apiTokens.revokeConfirmLabel', 'Revoke token'),
      confirmVariant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await apiDelete(`api/api-tokens/${encodeURIComponent(keyId)}`);
      await reload();
    } catch (err) {
      setError(
        err.payload?.message ?? err.message ?? t('auth:apiTokens.revokeFailed', 'failed to revoke')
      );
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <Card.Title className="mb-1">
              <i className="bi bi-key me-2" />
              {t('auth:apiTokens.title')}
            </Card.Title>
            <Card.Text className="text-muted small mb-0">
              {t('auth:apiTokens.subtitlePrefix', 'Programmatic access via')}{' '}
              <code>Authorization: Bearer pp_…</code>.{' '}
              {t(
                'auth:apiTokens.subtitleSuffix',
                'The secret is shown once at creation and cannot be retrieved later — revoke and re-issue if lost.'
              )}
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <i className="bi bi-plus-lg me-1" />
            {t('auth:apiTokens.newToken', 'New token')}
          </Button>
        </div>
        {error ? (
          <Alert variant="danger" className="py-2 small">
            {error}
          </Alert>
        ) : null}
        <TokensList loading={loading} tokens={tokens} onRevoke={revoke} />
      </Card.Body>
      <CreateTokenModal show={showCreate} onClose={() => setShowCreate(false)} onCreated={reload} />
      <ConfirmationDialog />
    </Card>
  );
};
