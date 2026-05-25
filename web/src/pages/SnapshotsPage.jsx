import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';

import { apiGet, apiPost } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { formatTimestamp } from '../utils/format.js';

const formatBytes = n => {
  if (!Number.isFinite(n)) {
    return '—';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const fetchSnapshot = id => apiGet(`api/snapshots/${encodeURIComponent(id)}`);

export const SnapshotsPage = () => {
  const { t } = useTranslation(['state', 'common']);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreSuccess, setRestoreSuccess] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [previewText, setPreviewText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet('api/snapshots');
      setSnapshots(payload.snapshots ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        load();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRestore = async () => {
    if (!confirming) {
      return;
    }
    const target = confirming;
    setConfirming(null);
    setRestoring(true);
    setRestoreError(null);
    setRestoreSuccess(null);
    try {
      const result = await apiPost(`api/snapshots/${encodeURIComponent(target.name)}/restore`);
      setRestoreSuccess(result);
      await load();
    } catch (err) {
      setRestoreError(err);
    } finally {
      setRestoring(false);
    }
  };

  const handlePreview = async snap => {
    setPreviewing(snap);
    setPreviewText('');
    try {
      const payload = await fetchSnapshot(snap.name);
      setPreviewText(JSON.stringify(payload, null, 2));
    } catch (err) {
      setPreviewText(
        t('state:snapshot.previewLoadFailed', '(failed to load snapshot: {{message}})', {
          message: err.message,
        })
      );
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">{t('state:snapshot.title', 'Snapshots')}</Card.Title>
            <Card.Text className="text-muted small mb-0">
              <Trans
                i18nKey="state:snapshot.description"
                t={t}
                defaults="Every successful Apply writes a timestamped JSON snapshot of state to <0>/data/snapshots/</0>. Restore replays the snapshot through the normal validate → render → reload pipeline (with rollback on failure). Retention: last 50 + one per day for 30 days."
                components={[<code key="0" />]}
              />
            </Card.Text>
          </div>
          <Button variant="outline-secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Spinner as="span" animation="border" size="sm" />
            ) : (
              t('common:buttons.refresh', 'Refresh')
            )}
          </Button>
        </div>
        {error ? (
          <Alert variant="danger">
            {t('state:snapshot.listFailed', 'Failed to list snapshots: {{message}}', {
              message: error.message,
            })}
          </Alert>
        ) : null}
        {restoreError ? (
          <Alert variant="danger" onClose={() => setRestoreError(null)} dismissible>
            {t('state:snapshot.restoreFailed', 'Restore failed: {{message}}', {
              message: restoreError.message,
            })}
          </Alert>
        ) : null}
        {restoreSuccess ? (
          <Alert variant="success" onClose={() => setRestoreSuccess(null)} dismissible>
            <Trans
              i18nKey="state:snapshot.restoreSuccess"
              t={t}
              defaults="Restored from <0>{{from}}</0> (taken {{takenAt}}). HAProxy reloaded."
              values={{
                from: restoreSuccess.restoredFrom,
                takenAt: formatTimestamp(restoreSuccess.snapshotAt),
              }}
              components={[<code key="0" />]}
            />
          </Alert>
        ) : null}
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>{t('state:snapshot.col.takenAt', 'Taken at')}</th>
              <th>{t('state:snapshot.col.sha', 'SHA')}</th>
              <th>{t('state:snapshot.col.size', 'Size')}</th>
              <th className="text-end">{t('state:snapshot.col.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-muted small py-3">
                  {loading
                    ? t('common:status.loading', 'Loading…')
                    : t(
                        'state:snapshot.empty',
                        'No snapshots yet — they accumulate as you save state.'
                      )}
                </td>
              </tr>
            ) : null}
            {snapshots.map(snap => (
              <tr key={snap.name}>
                <td>{formatTimestamp(snap.iso)}</td>
                <td>
                  <code className="small">{snap.sha}</code>
                </td>
                <td>{formatBytes(snap.size)}</td>
                <td className="text-end text-nowrap">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="me-1"
                    onClick={() => handlePreview(snap)}
                  >
                    {t('state:snapshot.preview', 'Preview')}
                  </Button>
                  <Button
                    variant="outline-warning"
                    size="sm"
                    onClick={() => setConfirming(snap)}
                    disabled={restoring}
                  >
                    {restoring ? (
                      <Spinner as="span" animation="border" size="sm" />
                    ) : (
                      t('state:snapshot.restore', 'Restore')
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {previewing ? (
          <Card className="mt-3">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div>
                  <strong>{t('state:snapshot.previewLabel', 'Preview:')}</strong>{' '}
                  <span className="text-muted">{formatTimestamp(previewing.iso)}</span>{' '}
                  <Badge bg="secondary">{previewing.sha}</Badge>
                </div>
                <Button size="sm" variant="link" onClick={() => setPreviewing(null)}>
                  {t('common:buttons.close', 'Close')}
                </Button>
              </div>
              <pre
                className="bg-body-tertiary border rounded p-3 mb-0"
                style={{
                  maxHeight: '40vh',
                  overflow: 'auto',
                  fontSize: '0.75rem',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                }}
              >
                {previewText || t('common:status.loading', 'Loading…')}
              </pre>
            </Card.Body>
          </Card>
        ) : null}
      </Card.Body>
      {confirming ? (
        <ConfirmDialog
          show
          title={t('state:snapshot.confirmTitle', 'Restore from snapshot?')}
          body={
            <Trans
              i18nKey="state:snapshot.confirmBody"
              t={t}
              defaults="This will replace the current state with the snapshot taken <0>{{takenAt}}</0> (<1>{{sha}}</1>) and reload HAProxy. The current state will itself be snapshotted on the next save, so the operation is reversible."
              values={{ takenAt: formatTimestamp(confirming.iso), sha: confirming.sha }}
              components={[<strong key="0" />, <code key="1" />]}
            />
          }
          confirmLabel={t('state:snapshot.restore', 'Restore')}
          confirmVariant="warning"
          onConfirm={handleRestore}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </Card>
  );
};
