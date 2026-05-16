import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Form, InputGroup, Spinner } from 'react-bootstrap';

import { useSSE } from '../hooks/useSSE.jsx';

const REFRESH_INTERVALS = Object.freeze([
  { label: 'live (SSE)', value: -1 },
  { label: 'off', value: 0 },
  { label: '2s', value: 2_000 },
  { label: '5s', value: 5_000 },
  { label: '15s', value: 15_000 },
  { label: '60s', value: 60_000 },
]);

const MAX_BUFFERED_LINES = 5_000;
const LOGS_PATH = 'api/logs';
const LOGS_STREAM_PATH = 'api/logs/stream';

const refreshDescription = (live, refreshMs) => {
  if (live) {
    return '';
  }
  if (refreshMs > 0) {
    return `Auto-refreshing every ${refreshMs / 1000}s.`;
  }
  return 'Auto-refresh disabled — use Refresh.';
};

const fetchLogs = async () => {
  const url = new URL(LOGS_PATH, document.baseURI).toString();
  const response = await fetch(url, {
    headers: { accept: 'text/plain' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let payload = '';
    try {
      payload = await response.text();
    } catch {
      // ignore
    }
    const message = payload
      ? `${response.status}: ${payload.slice(0, 200)}`
      : `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return response.text();
};

export const LogsPage = () => {
  const [filter, setFilter] = useState('');
  const [refreshMs, setRefreshMs] = useState(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const preRef = useRef(null);

  const live = refreshMs === -1;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await fetchLogs();
      setText(fetched);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (live) {
      load();
      return undefined;
    }
    let active = true;
    let intervalHandle = null;
    const run = async () => {
      try {
        const fetched = await fetchLogs();
        if (active) {
          setText(fetched);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    setLoading(true);
    run();
    if (refreshMs > 0) {
      intervalHandle = setInterval(run, refreshMs);
    }
    return () => {
      active = false;
      if (intervalHandle) {
        clearInterval(intervalHandle);
      }
    };
  }, [refreshMs, live, load]);

  const handleLines = useCallback(payload => {
    if (!payload?.lines?.length) {
      return;
    }
    setText(prev => {
      const next = prev ? `${prev}\n${payload.lines.join('\n')}` : payload.lines.join('\n');
      const lines = next.split('\n');
      if (lines.length > MAX_BUFFERED_LINES) {
        return lines.slice(-MAX_BUFFERED_LINES).join('\n');
      }
      return next;
    });
  }, []);

  const handleSnapshot = useCallback(payload => {
    if (!payload?.lines) {
      return;
    }
    setText(payload.lines.join('\n'));
  }, []);

  const handleStreamError = useCallback(payload => {
    if (payload?.message) {
      setError(new Error(payload.message));
    }
  }, []);

  const sse = useSSE(LOGS_STREAM_PATH, {
    enabled: live,
    events: {
      lines: handleLines,
      snapshot: handleSnapshot,
      error: handleStreamError,
    },
  });

  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, autoScroll]);

  const lines = text.split('\n');
  const trimmed = filter.trim().toLowerCase();
  const filteredLines = trimmed
    ? lines.filter(line => line.toLowerCase().includes(trimmed))
    : lines;
  const filteredText = filteredLines.join('\n');

  return (
    <Card className="patchpanel-fullheight-page">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <Card.Title className="mb-0">HAProxy addon logs</Card.Title>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <InputGroup size="sm" style={{ width: '15rem' }}>
              <InputGroup.Text>
                <i className="bi bi-funnel" />
              </InputGroup.Text>
              <Form.Control
                placeholder="Filter lines…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              {filter ? (
                <Button variant="outline-secondary" onClick={() => setFilter('')}>
                  ×
                </Button>
              ) : null}
            </InputGroup>
            <Form.Select
              size="sm"
              value={refreshMs}
              onChange={e => setRefreshMs(Number(e.target.value))}
              style={{ width: '7rem' }}
              aria-label="Refresh interval"
              title="Refresh interval"
            >
              {REFRESH_INTERVALS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Check
              type="switch"
              id="logs-auto-scroll"
              label="auto-scroll"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            <Button variant="outline-primary" size="sm" onClick={load} disabled={loading}>
              {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Refresh'}
            </Button>
          </div>
        </div>
        <Card.Text className="text-muted small d-flex align-items-center gap-2 flex-wrap">
          <span>
            Live tail of this addon&apos;s logs as captured by the Home Assistant supervisor.{' '}
            {refreshDescription(live, refreshMs)}
          </span>
          {live ? (
            <Badge bg={sse.connected ? 'success' : 'warning'}>
              {sse.connected ? 'live (SSE connected)' : 'live (reconnecting…)'}
            </Badge>
          ) : null}
          <span>
            Showing {filteredLines.length} of {lines.length} lines
            {trimmed ? ` (filter: "${filter.trim()}")` : ''}.
          </span>
        </Card.Text>
        {error ? (
          <Alert variant="danger">
            Failed to load logs: {error.message}
            {error.status === 501
              ? ' — this likely means patchpanel is running outside a Home Assistant addon.'
              : ''}
          </Alert>
        ) : null}
        <pre
          ref={preRef}
          className="bg-body-tertiary border rounded p-3 mb-0 patchpanel-fullheight-scroller"
          style={{
            fontSize: '0.78rem',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            whiteSpace: 'pre',
          }}
        >
          {filteredText || (loading ? '' : '(empty)')}
        </pre>
      </Card.Body>
    </Card>
  );
};
