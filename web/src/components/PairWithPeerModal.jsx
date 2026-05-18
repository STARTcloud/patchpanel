import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';

// Manual peer setup. No handshake protocol — the operator types in the
// peer's URL, picks a friendly display name, and pastes an inbound token
// that the OTHER node minted on its "My inbound tokens" card.
//
// One POST to /api/peers stores the local peer record. Pairing is
// unidirectional per setup — to make the other node able to call us, the
// operator repeats this flow on the peer with a token THIS node minted.

export const PairWithPeerModal = ({ show, onClose, onPaired }) => {
  const { t } = useTranslation(['cluster', 'common']);
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
          {t('cluster:peer.pair.title', 'Add peer')}
        </Modal.Title>
      </Modal.Header>
      <Form onSubmit={submit}>
        <Modal.Body>
          <Alert variant="info" className="py-2 small mb-3">
            <Trans
              i18nKey="cluster:peer.pair.intro"
              defaults="On the peer node, open this same page and click <1>Mint inbound token</1>. Paste the resulting token here alongside the peer's URL and a friendly display name.<3/>This sets up the <5>outbound</5> direction only (this node → peer). To receive sync pushes from the peer, repeat the flow on the peer's HA page using a token <7>this</7> node minted."
              components={{
                1: <strong />,
                3: <br />,
                5: <strong />,
                7: <em />,
              }}
            />
          </Alert>
          {error ? (
            <Alert variant="danger" className="py-2 small mb-3">
              {error}
            </Alert>
          ) : null}
          <Form.Group className="mb-3">
            <Form.Label>{t('cluster:peer.pair.urlLabel', 'Peer URL')}</Form.Label>
            <Form.Control
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://haproxy-s2-n2.example.com:8099"
              required
            />
            <Form.Text className="text-muted">
              {t(
                'cluster:peer.pair.urlHint',
                "Base URL of the peer's patchpanel (same hostname/port you'd use to reach its UI). The peer must be reachable from this host."
              )}
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>{t('cluster:peer.pair.nameLabel', 'Display name')}</Form.Label>
            <Form.Control
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="haproxy-s2-n2"
              required
            />
            <Form.Text className="text-muted">
              {t(
                'cluster:peer.pair.nameHint',
                "Human label shown in this node's peer list. Free-form; doesn't need to match the peer's actual node id."
              )}
            </Form.Text>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>{t('cluster:peer.pair.tokenLabel', 'Inbound token from peer')}</Form.Label>
            <Form.Control
              type="text"
              value={token}
              onChange={e => setToken(e.target.value)}
              required
              style={{ fontFamily: 'monospace' }}
            />
            <Form.Text className="text-muted">
              {t(
                'cluster:peer.pair.tokenHint',
                'Paste the raw token from the peer\'s "My inbound tokens" card. It\'s never re-displayable on the peer side after first reveal.'
              )}
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            {t('common:buttons.cancel', 'Cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {t('cluster:peer.pair.adding', 'Adding…')}
              </>
            ) : (
              t('cluster:peer.pair.submit', 'Add peer')
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
