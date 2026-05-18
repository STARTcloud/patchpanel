import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { useConfirmation } from '../hooks/useConfirmation.jsx';

import { PairWithPeerModal } from './PairWithPeerModal.jsx';

// Outbound peers — entries describing where THIS node pushes state to.
// Manually configured via "Add peer" modal; no automatic handshake.
//
// To mint a token for an INCOMING peer to use against this node, the
// operator uses the sibling InboundTokensCard. The two concerns are
// deliberately split.
//
// Server contracts:
//   GET    /api/peers                     → [{ id, name, url, addedAt, lastSyncAt, clockSkewMs, healthy }]
//   POST   /api/peers                     body: { url, name, token }  (handled in PairWithPeerModal)
//   POST   /api/peers/:id/sync-now        → { ok, pushed, pulled }
//   DELETE /api/peers/:id                 → { ok }
//
// Clock skew matters for VRRP: nodes that drift past advert_int can split-brain.
// Surfaced with yellow/red badges when it crosses thresholds.

const SKEW_WARN_MS = 1_000;
const SKEW_CRIT_MS = 5_000;

const formatSkew = ms => {
  if (ms === null || ms === undefined) {
    return null;
  }
  const abs = Math.abs(ms);
  if (abs < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
};

const SkewBadge = ({ clockSkewMs }) => {
  const { t } = useTranslation(['cluster', 'common']);
  if (clockSkewMs === null || clockSkewMs === undefined) {
    return <Badge bg="secondary">{t('common:status.unknown', 'unknown')}</Badge>;
  }
  const abs = Math.abs(clockSkewMs);
  if (abs >= SKEW_CRIT_MS) {
    return (
      <Badge
        bg="danger"
        title={t(
          'cluster:peer.list.skewCritTitle',
          'VRRP may flap — synchronize clocks via chronyd / systemd-timesyncd'
        )}
      >
        {formatSkew(clockSkewMs)}
      </Badge>
    );
  }
  if (abs >= SKEW_WARN_MS) {
    return (
      <Badge
        bg="warning"
        text="dark"
        title={t(
          'cluster:peer.list.skewWarnTitle',
          'Approaching VRRP advert_int — check time sync'
        )}
      >
        {formatSkew(clockSkewMs)}
      </Badge>
    );
  }
  return <Badge bg="success">{formatSkew(clockSkewMs)}</Badge>;
};

SkewBadge.propTypes = {
  clockSkewMs: PropTypes.number,
};

const formatDate = iso => (iso ? new Date(iso).toLocaleString() : '—');

const HealthBadge = ({ healthy }) => {
  const { t } = useTranslation(['cluster', 'common']);
  if (healthy === true) {
    return <Badge bg="success">{t('cluster:peer.list.healthy', 'healthy')}</Badge>;
  }
  if (healthy === false) {
    return <Badge bg="danger">{t('cluster:peer.list.unreachable', 'unreachable')}</Badge>;
  }
  return <Badge bg="secondary">{t('common:status.unknown', 'unknown')}</Badge>;
};

HealthBadge.propTypes = {
  healthy: PropTypes.bool,
};

const PeerRow = ({ peer, busyId, onSyncNow, onUnpair }) => {
  const { t } = useTranslation(['cluster']);
  return (
    <tr>
      <td>
        <code>{peer.name ?? peer.id}</code>
        <div className="text-muted small">{peer.url}</div>
      </td>
      <td>
        <HealthBadge healthy={peer.healthy} />
      </td>
      <td>
        <SkewBadge clockSkewMs={peer.clockSkewMs} />
      </td>
      <td className="small text-muted">{formatDate(peer.addedAt)}</td>
      <td className="small text-muted">{formatDate(peer.lastSyncAt)}</td>
      <td className="text-end">
        <Button
          variant="outline-primary"
          size="sm"
          className="me-1"
          disabled={busyId === peer.id}
          onClick={() => onSyncNow(peer)}
          title={t('cluster:peer.list.syncTitle', 'Force a state + cert blob sync now')}
        >
          {busyId === peer.id ? (
            <Spinner as="span" animation="border" size="sm" />
          ) : (
            <>
              <i className="bi bi-arrow-repeat me-1" />
              {t('cluster:peer.list.syncButton', 'Sync')}
            </>
          )}
        </Button>
        <Button
          variant="outline-danger"
          size="sm"
          onClick={() => onUnpair(peer)}
          title={t(
            'cluster:peer.list.unpairTitle',
            'Remove this peer relationship. State on the peer is not touched.'
          )}
        >
          <i className="bi bi-link-45deg" style={{ textDecoration: 'line-through' }} />
          {t('cluster:peer.list.unpairButton', 'Unpair')}
        </Button>
      </td>
    </tr>
  );
};

PeerRow.propTypes = {
  peer: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    url: PropTypes.string,
    addedAt: PropTypes.string,
    lastSyncAt: PropTypes.string,
    clockSkewMs: PropTypes.number,
    healthy: PropTypes.bool,
  }).isRequired,
  busyId: PropTypes.string,
  onSyncNow: PropTypes.func.isRequired,
  onUnpair: PropTypes.func.isRequired,
};

export const PeerListCard = () => {
  const { t } = useTranslation(['cluster', 'common']);
  const [peers, setPeers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showPair, setShowPair] = useState(false);
  const { confirm, ConfirmationDialog } = useConfirmation();

  const reload = useCallback(async () => {
    try {
      const list = await apiGet('api/peers');
      setPeers(Array.isArray(list) ? list : (list?.peers ?? []));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet('api/peers')
      .then(list => {
        if (cancelled) {
          return;
        }
        setPeers(Array.isArray(list) ? list : (list?.peers ?? []));
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

  const syncNow = async peer => {
    setBusyId(peer.id);
    try {
      await apiPost(`api/peers/${encodeURIComponent(peer.id)}/sync-now`);
      await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const unpair = async peer => {
    const ok = await confirm({
      title: t('cluster:peer.list.unpairConfirm.title', 'Unpair this peer?'),
      body: (
        <p className="mb-0">
          {t('cluster:peer.list.unpairConfirm.bodyPrefix', 'Remove')}{' '}
          <code>{peer.name ?? peer.id}</code>{' '}
          {t(
            'cluster:peer.list.unpairConfirm.bodySuffix',
            "from this node's peer list. The peer itself is not modified — you'll also need to unpair from the other side. This node will stop receiving sync pushes from this peer."
          )}
        </p>
      ),
      confirmLabel: t('cluster:peer.list.unpairButton', 'Unpair'),
      confirmVariant: 'danger',
    });
    if (!ok) {
      return;
    }
    try {
      await apiDelete(`api/peers/${encodeURIComponent(peer.id)}`);
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  const renderPeersBody = () => {
    if (loading) {
      return (
        <div className="d-flex justify-content-center py-3">
          <Spinner animation="border" size="sm" />
        </div>
      );
    }
    if (peers.length === 0) {
      return (
        <Alert variant="light" className="border small mb-0">
          {t(
            'cluster:peer.list.empty',
            'No peers configured. This node is standalone — VRRP failover requires at least two nodes paired in both directions.'
          )}
        </Alert>
      );
    }
    return (
      <Table size="sm" hover className="mb-0">
        <thead>
          <tr>
            <th>{t('cluster:peer.list.col.peer', 'Peer')}</th>
            <th>{t('cluster:peer.list.col.health', 'Health')}</th>
            <th>{t('cluster:peer.list.col.clockSkew', 'Clock skew')}</th>
            <th>{t('cluster:peer.list.col.added', 'Added')}</th>
            <th>{t('cluster:peer.list.col.lastSync', 'Last sync')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {peers.map(peer => (
            <PeerRow
              key={peer.id}
              peer={peer}
              busyId={busyId}
              onSyncNow={syncNow}
              onUnpair={unpair}
            />
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
            <Card.Title className="mb-1">
              {t('cluster:peer.list.title', 'Cluster peers')}
            </Card.Title>
            <Card.Text className="text-muted small mb-0">
              {t(
                'cluster:peer.list.description',
                'Outbound peers — patchpanel nodes THIS one pushes state to. State, certs, users, and API tokens sync over a bearer-token API. To add a peer, get an inbound token from the other node\'s "My inbound tokens" card, then paste it here alongside that node\'s URL.'
              )}
            </Card.Text>
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowPair(true)}>
            <i className="bi bi-plus-lg me-1" />
            {t('cluster:peer.list.addButton', 'Add peer…')}
          </Button>
        </div>

        {error ? (
          <Alert variant="danger" className="py-2 small">
            {error.payload?.message ??
              error.message ??
              t('cluster:peer.list.errorFallback', 'Peer list unavailable.')}
          </Alert>
        ) : null}

        {renderPeersBody()}
      </Card.Body>
      <PairWithPeerModal
        show={showPair}
        onClose={() => setShowPair(false)}
        onPaired={() => reload()}
      />
      <ConfirmationDialog />
    </Card>
  );
};
