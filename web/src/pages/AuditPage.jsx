import { useEffect, useState } from 'react';
import { Badge, Card, Table } from 'react-bootstrap';

import { apiGet } from '../api/client.js';

const OUTCOME_VARIANTS = Object.freeze({
  ok: 'success',
  error: 'danger',
});

const formatTimestamp = ts => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

const formatDetails = details => {
  if (!details) {
    return null;
  }
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
};

export const AuditPage = () => {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/audit?limit=200')
        .then(payload => {
          if (active) {
            setEntries(payload.entries);
            setError(null);
            setLoading(false);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
            setLoading(false);
          }
        });
    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <Card>
      <Card.Body>
        <Card.Title>Audit log</Card.Title>
        <Card.Text className="text-muted">
          Last 200 recorded operations (state changes, cert renewals, manual reloads). Refreshes
          every 30 seconds.
        </Card.Text>
        {error ? <p className="text-danger">{error.message}</p> : null}
        {loading ? <p className="text-muted">Loading…</p> : null}
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Category</th>
              <th>Action</th>
              <th>Target</th>
              <th>Outcome</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id}>
                <td className="text-nowrap">{formatTimestamp(entry.ts)}</td>
                <td>
                  <code>{entry.actor ?? '—'}</code>
                </td>
                <td>{entry.category}</td>
                <td>{entry.action}</td>
                <td>
                  <code>{entry.target ?? '—'}</code>
                </td>
                <td>
                  <Badge bg={OUTCOME_VARIANTS[entry.outcome] ?? 'secondary'}>{entry.outcome}</Badge>
                </td>
                <td className="small text-muted">{formatDetails(entry.details)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};
