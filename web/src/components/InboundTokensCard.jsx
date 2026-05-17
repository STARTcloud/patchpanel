import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';

import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client.js';
import { useConfirmation } from '../hooks/useConfirmation.jsx';

// Inbound bearer tokens THIS node will accept on its peer API. Operators
// mint tokens here, copy the raw value once (it's never shown again), then
// paste it into the OTHER node's "Add peer" modal so that node can call us.
//
// Server contract (confirmed):
//   POST   /api/peers/inbound-tokens                request { label? } → { id, token, label, mintedAt }
//   GET    /api/peers/inbound-tokens                → [{ id, label, mintedAt, lastUsedAt, lastUsedBy, tokenPreview }]
//   PATCH  /api/peers/inbound-tokens/:id            body { label } → { id, label, mintedAt, lastUsedAt, lastUsedBy, tokenPreview }
//   DELETE /api/peers/inbound-tokens/:id            → { ok }
//
// Mint flow per the operator UX decision: clicking the button mints
// immediately with an auto-generated label (`token-<4hex>`). The raw token
// is revealed in a banner with a copy button; the row appears in the list
// with the auto-label, which can be renamed inline via click-to-edit.

const formatDate = iso => (iso ? new Date(iso).toLocaleString() : '—');

const FreshTokenBanner = ({ minted, onDismiss }) => (
  <Alert variant="success" className="small mb-3">
    <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
      <strong>Inbound token minted</strong>
      <Button variant="outline-secondary" size="sm" onClick={onDismiss}>
        Done
      </Button>
    </div>
    <p className="mb-2">
      Copy this token now — it will <strong>not</strong> be shown again. Paste it into the OTHER
      node&apos;s <em>Add peer</em> modal so that node can call this one.
    </p>
    <div className="d-flex gap-2 align-items-center">
      <code className="flex-grow-1 p-2 bg-body-tertiary rounded" style={{ wordBreak: 'break-all' }}>
        {minted.token}
      </code>
      <Button
        variant="outline-primary"
        size="sm"
        onClick={() => navigator.clipboard.writeText(minted.token)}
        title="Copy to clipboard"
      >
        <i className="bi bi-clipboard" />
      </Button>
    </div>
    <div className="small text-muted mt-2">
      Auto-label: <code>{minted.label}</code> — rename it inline in the list below.
    </div>
  </Alert>
);

FreshTokenBanner.propTypes = {
  minted: PropTypes.shape({
    id: PropTypes.string.isRequired,
    token: PropTypes.string.isRequired,
    label: PropTypes.string,
    mintedAt: PropTypes.string,
  }).isRequired,
  onDismiss: PropTypes.func.isRequired,
};

const InlineLabelEditor = ({ token, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(token.label ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Focus the input when entering edit mode. Replaces a static autoFocus prop
  // (which the linter rejects globally for a11y) — the user has explicitly
  // toggled into edit mode here so directed focus is the expected affordance.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next === (token.label ?? '').trim()) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiPatch(`api/peers/inbound-tokens/${encodeURIComponent(token.id)}`, {
        label: next,
      });
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'rename failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <Button
        type="button"
        variant="link"
        className="d-inline-flex align-items-center gap-1 p-0 text-decoration-none text-reset"
        onClick={() => {
          setDraft(token.label ?? '');
          setEditing(true);
        }}
        title="Click to rename"
      >
        <span>{token.label ?? <em className="text-muted">(no label)</em>}</span>
        <i className="bi bi-pencil-square text-muted small" />
      </Button>
    );
  }

  return (
    <div className="d-flex gap-1 align-items-center">
      <Form.Control
        size="sm"
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
            setError(null);
          }
        }}
        ref={inputRef}
        disabled={submitting}
      />
      <Button variant="outline-primary" size="sm" onClick={commit} disabled={submitting}>
        {submitting ? (
          <Spinner as="span" animation="border" size="sm" />
        ) : (
          <i className="bi bi-check-lg" />
        )}
      </Button>
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        disabled={submitting}
      >
        <i className="bi bi-x-lg" />
      </Button>
      {error ? <span className="text-danger small">{error}</span> : null}
    </div>
  );
};

InlineLabelEditor.propTypes = {
  token: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string,
  }).isRequired,
  onSaved: PropTypes.func.isRequired,
};

const TokenRow = ({ token, onRevoke, onPatched }) => (
  <tr>
    <td>
      <InlineLabelEditor token={token} onSaved={onPatched} />
    </td>
    <td>
      <code className="small">{token.tokenPreview ?? '—'}</code>
    </td>
    <td className="small text-muted">{formatDate(token.mintedAt)}</td>
    <td className="small text-muted">{formatDate(token.lastUsedAt)}</td>
    <td className="small">
      {token.lastUsedBy ? <code>{token.lastUsedBy}</code> : <span className="text-muted">—</span>}
    </td>
    <td className="text-end">
      <Button
        variant="outline-danger"
        size="sm"
        onClick={() => onRevoke(token)}
        title="Revoke this inbound token. Any peer using it will start getting 401s."
      >
        <i className="bi bi-trash" />
      </Button>
    </td>
  </tr>
);

TokenRow.propTypes = {
  token: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string,
    tokenPreview: PropTypes.string,
    mintedAt: PropTypes.string,
    lastUsedAt: PropTypes.string,
    lastUsedBy: PropTypes.string,
  }).isRequired,
  onRevoke: PropTypes.func.isRequired,
  onPatched: PropTypes.func.isRequired,
};

export const InboundTokensCard = () => {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [minting, setMinting] = useState(false);
  const [fresh, setFresh] = useState(null);
  const { confirm, ConfirmationDialog } = useConfirmation();

  const reload = useCallback(async () => {
    try {
      const list = await apiGet('api/peers/inbound-tokens');
      setTokens(Array.isArray(list) ? list : (list?.tokens ?? []));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet('api/peers/inbound-tokens')
      .then(list => {
        if (cancelled) {
          return;
        }
        setTokens(Array.isArray(list) ? list : (list?.tokens ?? []));
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) {
          return;
        }
        setError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mint = async () => {
    setMinting(true);
    setError(null);
    try {
      const minted = await apiPost('api/peers/inbound-tokens');
      setFresh(minted);
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setMinting(false);
    }
  };

  const revoke = async token => {
    const ok = await confirm({
      title: 'Revoke this inbound token?',
      body: (
        <p className="mb-0">
          Revoke <code>{token.label ?? token.id}</code>? Any peer currently using it will
          immediately start getting 401 responses. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Revoke',
      confirmVariant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await apiDelete(`api/peers/inbound-tokens/${encodeURIComponent(token.id)}`);
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  const patchOne = updated => {
    setTokens(prev => prev.map(t => (t.id === updated.id ? { ...t, ...updated } : t)));
  };

  const renderTokensBody = () => {
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
          No inbound tokens minted yet. Click <strong>Mint inbound token</strong> to create one.
        </Alert>
      );
    }
    return (
      <Table size="sm" hover className="mb-0">
        <thead>
          <tr>
            <th>Label</th>
            <th>Preview</th>
            <th>Minted</th>
            <th>Last used</th>
            <th>Last used by</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tokens.map(token => (
            <TokenRow key={token.id} token={token} onRevoke={revoke} onPatched={patchOne} />
          ))}
        </tbody>
      </Table>
    );
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">My inbound tokens</Card.Title>
            <Card.Text className="text-muted small mb-0">
              Bearer tokens THIS node will accept from peers. Mint here, copy once, paste on the
              other node&apos;s <em>Add peer</em> modal. Each token is independently revocable; the
              raw value is never shown again after mint.
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={mint} disabled={minting}>
            {minting ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                Minting…
              </>
            ) : (
              <>
                <i className="bi bi-key me-1" />
                Mint inbound token
              </>
            )}
          </Button>
        </div>

        {fresh ? <FreshTokenBanner minted={fresh} onDismiss={() => setFresh(null)} /> : null}

        {error ? (
          <Alert variant="danger" className="py-2 small">
            {error.payload?.message ?? error.message ?? 'Inbound tokens list unavailable.'}
          </Alert>
        ) : null}

        {renderTokensBody()}
      </Card.Body>
      <ConfirmationDialog />
    </Card>
  );
};
