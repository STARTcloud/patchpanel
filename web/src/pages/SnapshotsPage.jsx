import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner, Table } from 'react-bootstrap';

import { apiGet, apiPost } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';

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

const formatTimestamp = iso => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const fetchSnapshot = id => apiGet(`api/snapshots/${encodeURIComponent(id)}`);

export const SnapshotsPage = () => {
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
    load();
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
      setPreviewText(`(failed to load snapshot: ${err.message})`);
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">Snapshots</Card.Title>
            <Card.Text className="text-muted small mb-0">
              Every successful Apply writes a timestamped JSON snapshot of state to{' '}
              <code>/data/snapshots/</code>. Restore replays the snapshot through the normal
              validate → render → reload pipeline (with rollback on failure). Retention: last 50 +
              one per day for 30 days.
            </Card.Text>
          </div>
          <Button variant="outline-secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Refresh'}
          </Button>
        </div>
        {error ? <Alert variant="danger">Failed to list snapshots: {error.message}</Alert> : null}
        {restoreError ? (
          <Alert variant="danger" onClose={() => setRestoreError(null)} dismissible>
            Restore failed: {restoreError.message}
          </Alert>
        ) : null}
        {restoreSuccess ? (
          <Alert variant="success" onClose={() => setRestoreSuccess(null)} dismissible>
            Restored from <code>{restoreSuccess.restoredFrom}</code> (taken{' '}
            {formatTimestamp(restoreSuccess.snapshotAt)}). HAProxy reloaded.
          </Alert>
        ) : null}
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>Taken at</th>
              <th>SHA</th>
              <th>Size</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-muted small py-3">
                  {loading ? 'Loading…' : 'No snapshots yet — they accumulate as you save state.'}
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
                    Preview
                  </Button>
                  <Button
                    variant="outline-warning"
                    size="sm"
                    onClick={() => setConfirming(snap)}
                    disabled={restoring}
                  >
                    {restoring ? <Spinner as="span" animation="border" size="sm" /> : 'Restore'}
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
                  <strong>Preview:</strong>{' '}
                  <span className="text-muted">{formatTimestamp(previewing.iso)}</span>{' '}
                  <Badge bg="secondary">{previewing.sha}</Badge>
                </div>
                <Button size="sm" variant="link" onClick={() => setPreviewing(null)}>
                  Close
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
                {previewText || 'Loading…'}
              </pre>
            </Card.Body>
          </Card>
        ) : null}
      </Card.Body>
      {confirming ? (
        <ConfirmDialog
          show
          title="Restore from snapshot?"
          body={
            <>
              This will replace the current state with the snapshot taken{' '}
              <strong>{formatTimestamp(confirming.iso)}</strong> (<code>{confirming.sha}</code>) and
              reload HAProxy. The current state will itself be snapshotted on the next save, so the
              operation is reversible.
            </>
          }
          confirmLabel="Restore"
          confirmVariant="warning"
          onConfirm={handleRestore}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </Card>
  );
};
