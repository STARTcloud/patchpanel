import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';

import { apiPost } from '../api/client.js';

// Manual peer setup. No handshake protocol — the operator types in the
// peer's URL, picks a friendly display name, and pastes an inbound token
// that the OTHER node minted on its "My inbound tokens" card.
//
// One POST to /api/peers stores the local peer record. Pairing is
// unidirectional per setup — to make the other node able to call us, the
// operator repeats this flow on the peer with a token THIS node minted.

export const PairWithPeerModal = ({ show, onClose, onPaired }) => {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setUrl('');
    setName('');
    setToken('');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = async event => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const peer = await apiPost('api/peers', {
        url: url.trim(),
        name: name.trim(),
        token: token.trim(),
      });
      onPaired(peer);
      reset();
      onClose();
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'failed to add peer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-link-45deg me-2" />
          Add peer
        </Modal.Title>
      </Modal.Header>
      <Form onSubmit={submit}>
        <Modal.Body>
          <Alert variant="info" className="py-2 small mb-3">
            On the peer node, open this same page and click <strong>Mint inbound token</strong>.
            Paste the resulting token here alongside the peer&apos;s URL and a friendly display
            name.
            <br />
            This sets up the <strong>outbound</strong> direction only (this node → peer). To receive
            sync pushes from the peer, repeat the flow on the peer&apos;s HA page using a token{' '}
            <em>this</em> node minted.
          </Alert>
          {error ? (
            <Alert variant="danger" className="py-2 small mb-3">
              {error}
            </Alert>
          ) : null}
          <Form.Group className="mb-3">
            <Form.Label>Peer URL</Form.Label>
            <Form.Control
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://haproxy-s2-n2.example.com:8099"
              required
            />
            <Form.Text className="text-muted">
              Base URL of the peer&apos;s patchpanel (same hostname/port you&apos;d use to reach its
              UI). The peer must be reachable from this host.
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Display name</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="haproxy-s2-n2"
              required
            />
            <Form.Text className="text-muted">
              Human label shown in this node&apos;s peer list. Free-form; doesn&apos;t need to match
              the peer&apos;s actual node id.
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Inbound token from peer</Form.Label>
            <Form.Control
              type="text"
              value={token}
              onChange={e => setToken(e.target.value)}
              required
              style={{ fontFamily: 'monospace' }}
            />
            <Form.Text className="text-muted">
              Paste the raw token from the peer&apos;s &ldquo;My inbound tokens&rdquo; card.
              It&apos;s never re-displayable on the peer side after first reveal.
            </Form.Text>
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
                Adding…
              </>
            ) : (
              'Add peer'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

PairWithPeerModal.propTypes = {
  show: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onPaired: PropTypes.func.isRequired,
};
