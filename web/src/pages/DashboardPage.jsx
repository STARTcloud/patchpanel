import HighchartsReact from 'highcharts-react-official';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Col, Row, Spinner, Table } from 'react-bootstrap';
import { Link } from 'react-router';

import { apiGet } from '../api/client.js';
import { createChartOptions } from '../components/chartDefaults.js';
import {
  AlertsPanel,
  ConnectionPoolPanel,
  ErrorRatePanel,
  GeoOriginsPanel,
  LiveRatePanel,
  LiveTotalsPanel,
  SnapshotTimelinePanel,
  TlsCoveragePanel,
  TopClientsPanel,
  TopHostsPanel,
  WorldOriginMapPanel,
} from '../components/DashboardPanels.jsx';
import { ExpandedChartModal } from '../components/ExpandedChartModal.jsx';
import { HaproxyStatusBadge } from '../components/HaproxyStatusBadge.jsx';
import Highcharts from '../components/Highcharts.jsx';
import { PanelLayoutPopover } from '../components/PanelLayoutPopover.jsx';
import { deriveRouteRows } from '../components/RouteWizard.jsx';
import { TrafficChart } from '../components/TrafficChart.jsx';
import { useActions } from '../hooks/useActions.jsx';
import { useConfirmation } from '../hooks/useConfirmation.jsx';
import { useDashboardLayout } from '../hooks/useDashboardLayout.jsx';
import { useHaproxyLive } from '../hooks/useHaproxyLive.jsx';
import { useStatsHistory } from '../hooks/useStatsHistory.jsx';
import { stateDocShape } from '../prop-shapes.js';
import { findCoveringCertsForRoute } from '../utils/certMatch.js';

// v0.2.40 — Smarter KPI tile. Optional `statusBadge` shows an inline
// indicator below the count so the four top tiles read as "27 routes
// · 2 missing cert" instead of just "27".
const Tile = ({ title, value, icon, variant = 'secondary', to = null, statusBadge = null }) => {
  const body = (
    <Card.Body>
      <div className="d-flex align-items-center justify-content-between">
        <div>
          <Card.Subtitle className="mb-2 text-muted">{title}</Card.Subtitle>
          <Card.Title className="display-6 mb-0">{value}</Card.Title>
          {statusBadge ? (
            <div className="mt-1">
              <Badge
                bg={statusBadge.variant}
                text={statusBadge.text === 'dark' ? 'dark' : undefined}
              >
                {statusBadge.label}
              </Badge>
            </div>
          ) : null}
        </div>
        <i className={`bi bi-${icon} display-4 text-${variant}`} />
      </div>
    </Card.Body>
  );
  if (!to) {
    return <Card className="h-100">{body}</Card>;
  }
  return (
    <Card
      as={Link}
      to={to}
      className="h-100 text-decoration-none text-reset shadow-sm patchpanel-kpi-tile"
    >
      {body}
    </Card>
  );
};

Tile.propTypes = {
  title: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  icon: PropTypes.string.isRequired,
  variant: PropTypes.string,
  to: PropTypes.string,
  statusBadge: PropTypes.shape({
    label: PropTypes.string.isRequired,
    variant: PropTypes.string.isRequired,
    text: PropTypes.string,
  }),
};

const OUTCOME_VARIANTS = Object.freeze({ ok: 'success', error: 'danger' });

const formatTimestamp = ts => {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
};

const RUNTIME_GROUPS = Object.freeze([
  {
    label: 'Process',
    fields: ['Version', 'Pid', 'Nbthread', 'Uptime', 'Node'],
  },
  {
    label: 'Connections',
    fields: ['CurrConns', 'MaxConn', 'CurrSslConns', 'MaxSslConns', 'Maxpipes', 'PipesUsed'],
  },
  {
    label: 'Rates',
    fields: ['ConnRate', 'MaxConnRate', 'SessRate', 'MaxSessRate', 'SslRate', 'MaxSslRate'],
  },
  {
    label: 'Cumulative',
    fields: ['CumConns', 'CumReq', 'CumSslConns', 'Tasks', 'Run_queue'],
  },
  {
    label: 'Health',
    fields: ['Idle_pct', 'Jobs', 'Listeners', 'Stopping', 'Hard_maxconn', 'Maxsock'],
  },
]);

const idlePctVariant = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 'secondary';
  }
  if (n >= 70) {
    return 'success';
  }
  if (n >= 30) {
    return 'warning';
  }
  return 'danger';
};

const renderRuntimeValue = (key, value) => {
  if (key === 'Idle_pct') {
    return <Badge bg={idlePctVariant(value)}>{value}%</Badge>;
  }
  return <code>{value}</code>;
};

const RuntimeFieldGroup = ({ label, fields, info }) => {
  const present = fields.filter(k => info[k] !== undefined && info[k] !== '');
  if (present.length === 0) {
    return null;
  }
  return (
    <Col md={6} lg={4} className="mb-2">
      <div className="text-muted small text-uppercase mb-1" style={{ letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="d-flex flex-column gap-1 small">
        {present.map(k => (
          <div key={k} className="d-flex justify-content-between gap-2">
            <span className="text-muted">{k}</span>
            <span>{renderRuntimeValue(k, info[k])}</span>
          </div>
        ))}
      </div>
    </Col>
  );
};

RuntimeFieldGroup.propTypes = {
  label: PropTypes.string.isRequired,
  fields: PropTypes.arrayOf(PropTypes.string).isRequired,
  info: PropTypes.objectOf(PropTypes.string).isRequired,
};

const RuntimeCard = ({ info }) => {
  if (!info) {
    return null;
  }
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-speedometer2 me-2" />
          HAProxy runtime
        </Card.Title>
        <Row className="g-2">
          {RUNTIME_GROUPS.map(group => (
            <RuntimeFieldGroup
              key={group.label}
              label={group.label}
              fields={group.fields}
              info={info}
            />
          ))}
        </Row>
      </Card.Body>
    </Card>
  );
};

RuntimeCard.propTypes = {
  info: PropTypes.objectOf(PropTypes.string),
};

const BackendHealthCard = ({ rows }) => {
  const backends = rows.filter(r => r.svname === 'BACKEND');
  const servers = rows.filter(r => r.svname && r.svname !== 'BACKEND' && r.svname !== 'FRONTEND');
  const bucketize = list => {
    const buckets = { up: 0, down: 0, other: 0 };
    for (const row of list) {
      const status = row.status ?? '';
      if (status.startsWith('UP')) {
        buckets.up += 1;
      } else if (status.startsWith('DOWN')) {
        buckets.down += 1;
      } else {
        buckets.other += 1;
      }
    }
    return buckets;
  };
  const beBuckets = bucketize(backends);
  const svBuckets = bucketize(servers);
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-heart-pulse me-2" />
          Backend health
        </Card.Title>
        <div className="d-flex flex-column gap-2 small">
          <div>
            <strong>Backends:</strong> <Badge bg="success">{beBuckets.up} UP</Badge>{' '}
            <Badge bg="danger">{beBuckets.down} DOWN</Badge>{' '}
            <Badge bg="secondary">{beBuckets.other} other</Badge>
          </div>
          <div>
            <strong>Servers:</strong> <Badge bg="success">{svBuckets.up} UP</Badge>{' '}
            <Badge bg="danger">{svBuckets.down} DOWN</Badge>{' '}
            <Badge bg="secondary">{svBuckets.other} other</Badge>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

BackendHealthCard.propTypes = {
  rows: PropTypes.array.isRequired,
};

const ActionButton = ({ variant, busy, busyLabel, icon, label, onClick, disabled, title }) => (
  <Button variant={variant} size="sm" onClick={onClick} disabled={disabled} title={title}>
    {busy ? (
      <>
        <Spinner as="span" animation="border" size="sm" /> {busyLabel}
      </>
    ) : (
      <>
        <i className={`bi bi-${icon} me-1`} /> {label}
      </>
    )}
  </Button>
);

ActionButton.propTypes = {
  variant: PropTypes.string.isRequired,
  busy: PropTypes.bool.isRequired,
  busyLabel: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  title: PropTypes.string,
};

const QUICK_ACTION_MESSAGES = Object.freeze({
  reload: () => 'HAProxy reloaded.',
  stop: () => 'HAProxy stopped.',
  start: () => 'HAProxy started.',
  renew: result => `Renewal completed (loadable: ${result.loadableCertCount}).`,
});

const QuickActionResultBanner = ({ lastResult, error }) => {
  if (error) {
    return <p className="text-danger small mt-2 mb-0">{error.message}</p>;
  }
  const renderer = lastResult ? QUICK_ACTION_MESSAGES[lastResult.kind] : null;
  if (!renderer) {
    return null;
  }
  return <p className="text-success small mt-2 mb-0">{renderer(lastResult)}</p>;
};

QuickActionResultBanner.propTypes = {
  lastResult: PropTypes.shape({
    kind: PropTypes.string,
    loadableCertCount: PropTypes.number,
  }),
  error: PropTypes.shape({ message: PropTypes.string }),
};

const STOP_CONFIRM_BODY = strategy => (
  <>
    <p className="mb-2">
      This will <strong>stop the HAProxy process</strong>. All proxied connections will be dropped
      immediately and the proxy will be unreachable until you start it again.
    </p>
    <p className="mb-0 small text-muted">
      Strategy: <code>{strategy ?? 'unknown'}</code>.{' '}
      {strategy === 'direct'
        ? 'Direct mode has no supervisor — patchpanel cannot restart HAProxy from the UI.'
        : 'Restart available via the Start button.'}
    </p>
  </>
);

const QuickActionsCard = () => {
  const actions = useActions();
  const { alive, strategy, refresh } = useHaproxyLive();
  const { confirm, ConfirmationDialog } = useConfirmation();
  const isBusy = actions.busy !== null;
  const isRunning = alive === true;
  const isStopped = alive === false;
  const directStart = strategy === 'direct';

  const wrap = promise => promise.catch(() => undefined).finally(refresh);
  const handleStop = async () => {
    const ok = await confirm({
      title: 'Stop HAProxy?',
      body: STOP_CONFIRM_BODY(strategy),
      confirmLabel: 'Stop HAProxy',
      confirmVariant: 'danger',
    });
    if (ok) {
      wrap(actions.stopHaproxy());
    }
  };
  const handleStart = () => wrap(actions.startHaproxy());
  const handleReload = () => wrap(actions.reloadHaproxy());
  const handleRenew = () => actions.renewCerts({ force: false }).catch(() => undefined);

  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-tools me-2" />
          Quick actions
          <span className="ms-2 small">
            <HaproxyStatusBadge alive={alive} />
          </span>
          {strategy ? (
            <span className="ms-2 small text-muted" title="Process-control strategy">
              <code>{strategy}</code>
            </span>
          ) : null}
        </Card.Title>
        <div className="d-flex gap-2 flex-wrap">
          <ActionButton
            variant="secondary"
            busy={actions.busy === 'reload'}
            busyLabel="Reloading…"
            icon="arrow-clockwise"
            label="Reload HAProxy"
            onClick={handleReload}
            disabled={isBusy || !isRunning}
          />
          <ActionButton
            variant="danger"
            busy={actions.busy === 'stop'}
            busyLabel="Stopping…"
            icon="stop-circle"
            label="Stop HAProxy"
            onClick={handleStop}
            disabled={isBusy || !isRunning}
          />
          <ActionButton
            variant="success"
            busy={actions.busy === 'start'}
            busyLabel="Starting…"
            icon="play-circle"
            label="Start HAProxy"
            onClick={handleStart}
            disabled={isBusy || !isStopped || directStart}
            title={
              directStart
                ? 'Direct strategy cannot start HAProxy — no supervisor configured.'
                : undefined
            }
          />
          <ActionButton
            variant="primary"
            busy={actions.busy === 'renew'}
            busyLabel="Renewing…"
            icon="shield-lock"
            label="Renew all certs"
            onClick={handleRenew}
            disabled={isBusy}
          />
        </div>
        <QuickActionResultBanner lastResult={actions.lastResult} error={actions.error} />
        <ConfirmationDialog />
      </Card.Body>
    </Card>
  );
};

const PerFrontendTrafficCard = ({ name, theme }) => {
  const stats = useStatsHistory();
  const history = stats.history?.[`${name}/FRONTEND`] ?? [];
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-activity me-2" />
          {name}
        </Card.Title>
        {history.length < 2 ? (
          <p className="text-muted small mb-0">Sampling… (5s ticks)</p>
        ) : (
          <TrafficChart title={name} history={history} theme={theme} height={200} />
        )}
      </Card.Body>
    </Card>
  );
};

PerFrontendTrafficCard.propTypes = {
  name: PropTypes.string.isRequired,
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
};

const RecentActivity = () => {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/audit?limit=10')
        .then(payload => {
          if (active) {
            setEntries(payload.entries);
          }
        })
        .catch(() => undefined);
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
        <Card.Title className="mb-2">
          <i className="bi bi-journal-text me-2" />
          Recent activity
        </Card.Title>
        {entries.length === 0 ? (
          <p className="text-muted small mb-0">No audit entries yet.</p>
        ) : (
          <Table size="sm" responsive>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="small text-nowrap">{formatTimestamp(entry.ts)}</td>
                  <td>
                    <Badge bg={OUTCOME_VARIANTS[entry.outcome] ?? 'secondary'}>
                      {entry.outcome}
                    </Badge>
                  </td>
                  <td className="small">
                    <code>{entry.category}</code>.{entry.action}
                    {entry.target ? (
                      <>
                        {' '}
                        → <code>{entry.target}</code>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

const CertStatusCard = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/certificates')
        .then(payload => {
          if (active) {
            setData(payload);
          }
        })
        .catch(() => undefined);
    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  if (!data || !data.certs) {
    return null;
  }
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-shield-lock me-2" />
          Certificate status
        </Card.Title>
        {data.certs.length === 0 ? (
          <p className="text-muted small mb-0">No certificates configured.</p>
        ) : (
          <Table size="sm" responsive>
            <tbody>
              {data.certs.map(cert => {
                const { newest } = cert;
                const days = newest?.notAfter
                  ? Math.round(
                      (new Date(newest.notAfter).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
                    )
                  : null;
                let variant = 'secondary';
                let label = 'missing';
                if (days !== null) {
                  if (days < 0) {
                    variant = 'danger';
                    label = 'expired';
                  } else if (days < 14) {
                    variant = 'warning';
                    label = `${days}d`;
                  } else {
                    variant = 'success';
                    label = `${days}d`;
                  }
                }
                return (
                  <tr key={cert.id}>
                    <td>
                      <code>{cert.certName}</code>
                    </td>
                    <td className="text-end">
                      <Badge bg={variant}>{label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

const StatsSocketUnavailable = ({ message = null }) => (
  <Card>
    <Card.Body>
      <Card.Title className="d-flex align-items-center gap-2">
        <i className="bi bi-plug-fill text-warning" />
        HAProxy stats socket unavailable
      </Card.Title>
      <p className="text-muted small mb-0">
        {message ?? 'HAProxy may not be running yet, or the runtime socket is unreachable.'}
      </p>
    </Card.Body>
  </Card>
);

StatsSocketUnavailable.propTypes = {
  message: PropTypes.string,
};

const SlowestBackendsCard = () => {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/slowest-backends?limit=5')
        .then(payload => {
          if (active) {
            setRows(payload.rows ?? []);
          }
        })
        .catch(() => undefined);
    fetchOnce();
    const interval = setInterval(fetchOnce, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-stopwatch me-2" />
          Slowest backends
        </Card.Title>
        <Card.Text className="text-muted small mb-2">
          Sorted by HAProxy <code>rtime</code> (average response time over the last 1024 requests
          per backend).
        </Card.Text>
        {rows.length === 0 ? (
          <p className="text-muted small mb-0">No backends with recorded response times.</p>
        ) : (
          <Table size="sm" responsive>
            <thead>
              <tr>
                <th>Backend</th>
                <th className="text-end">rtime</th>
                <th className="text-end">rtime-max</th>
                <th className="text-end">qtime</th>
                <th className="text-end">scur</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td>
                    <code className="small">{r.pxname}</code>
                  </td>
                  <td className="text-end">{r.rtime} ms</td>
                  <td className="text-end text-muted">{r.rtimeMax} ms</td>
                  <td className="text-end text-muted">{r.qtime} ms</td>
                  <td className="text-end">{r.scur}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
};

const HTTP_CODE_COLORS = Object.freeze({
  '1xx': '#6c757d',
  '2xx': '#198754',
  '3xx': '#0dcaf0',
  '4xx': '#ffc107',
  '5xx': '#dc3545',
  other: '#6610f2',
});

const HttpCodePieCard = ({ theme }) => {
  const [totals, setTotals] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/http-codes')
        .then(payload => {
          if (active) {
            setTotals(payload.totals ?? null);
          }
        })
        .catch(() => undefined);
    fetchOnce();
    const interval = setInterval(fetchOnce, 15_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  if (!totals) {
    return null;
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    return (
      <Card>
        <Card.Body>
          <Card.Title className="mb-2">
            <i className="bi bi-pie-chart me-2" />
            HTTP status codes
          </Card.Title>
          <p className="text-muted small mb-0">No traffic in the sampled window yet.</p>
        </Card.Body>
      </Card>
    );
  }
  const data = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([name, y]) => ({ name, y, color: HTTP_CODE_COLORS[name] }));
  const base = createChartOptions({ title: '', height: 220, theme, series: [] });
  const options = {
    ...base,
    chart: { ...base.chart, type: 'pie' },
    plotOptions: {
      pie: {
        innerSize: '55%',
        dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
      },
    },
    series: [{ name: 'responses', data }],
    legend: { enabled: false },
  };
  return (
    <Card>
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-pie-chart me-2" />
          HTTP status codes
        </Card.Title>
        <Card.Text className="text-muted small mb-2">
          Distribution across all frontends in the last hour (delta-based).
        </Card.Text>
        <HighchartsReact highcharts={Highcharts} options={options} />
      </Card.Body>
    </Card>
  );
};

HttpCodePieCard.propTypes = {
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
};

// v0.3.0 — Panel definitions. Each entry declares its `defaultWidth` (col
// span 3-12 on a 12-col CSS grid), `defaultHeight` (row span 1-4), and
// `defaultAutoHeight` (when true, the panel sizes to its content rather
// than spanning a fixed number of rows). User overrides persist in
// localStorage via useDashboardLayout.
const PANEL_DEFS = Object.freeze([
  {
    id: 'kpi-routes',
    title: 'Routes',
    subtitle: 'Total routes (click for full table).',
    defaultWidth: 3,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 1,
    minHeight: 1,
    requiresStats: false,
    category: 'metric',
    link: '/routes',
  },
  {
    id: 'kpi-backends',
    title: 'Backends',
    subtitle: 'Total backends (click for full table).',
    defaultWidth: 3,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 1,
    minHeight: 1,
    requiresStats: false,
    category: 'metric',
    link: '/backends',
  },
  {
    id: 'kpi-certs',
    title: 'Certificates',
    subtitle: 'Total certs (click for full table).',
    defaultWidth: 3,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 1,
    minHeight: 1,
    requiresStats: false,
    category: 'metric',
    link: '/certificates',
  },
  {
    id: 'kpi-providers',
    title: 'TLS Providers',
    subtitle: 'Total providers (click for full table).',
    defaultWidth: 3,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 1,
    minHeight: 1,
    requiresStats: false,
    category: 'metric',
    link: '/providers',
  },
  {
    id: 'live-totals',
    title: 'Live totals',
    subtitle: 'Request rate · Bandwidth · Sessions · CPU idle (always-live).',
    defaultWidth: 12,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 1,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'alerts',
    title: 'Active alerts',
    subtitle: 'Backends down, certs expiring, uncovered routes.',
    defaultWidth: 6,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'status',
    link: '/stats',
  },
  {
    id: 'live-rate',
    title: 'Live request rate',
    subtitle: 'req/s aggregated across all frontends + sparkline.',
    defaultWidth: 3,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 2,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'error-rate',
    title: 'Error rate',
    subtitle: '4xx + 5xx % over the sampled hour.',
    defaultWidth: 3,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 2,
    minHeight: 1,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'connection-pool',
    title: 'Connection pool',
    subtitle: 'Current sessions vs MaxConn ceiling.',
    defaultWidth: 4,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 2,
    minHeight: 1,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'runtime',
    title: 'HAProxy runtime',
    subtitle: 'Process / Connections / Rates / Cumulative / Health.',
    defaultWidth: 8,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/runtime',
  },
  {
    id: 'health',
    title: 'Backend health',
    subtitle: 'UP / DOWN / other counts per backend + per server.',
    defaultWidth: 4,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 2,
    minHeight: 1,
    requiresStats: true,
    category: 'status',
    link: '/backends',
  },
  {
    id: 'tls-coverage',
    title: 'TLS coverage',
    subtitle: 'Routes by cert status — valid / expiring / expired / missing.',
    defaultWidth: 4,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 3,
    minHeight: 2,
    requiresStats: false,
    category: 'status',
    link: '/certificates',
  },
  {
    id: 'top-hosts',
    title: 'Top hosts',
    subtitle: 'Busiest 10 routes by request rate.',
    defaultWidth: 6,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/routes',
  },
  {
    id: 'geo-origins',
    title: 'Top countries',
    subtitle: 'Client request origins by country (requires GeoIP).',
    defaultWidth: 6,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'origin-map',
    title: 'Origin map',
    subtitle: 'World choropleth shaded by client session count (requires GeoIP).',
    defaultWidth: 6,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'top-clients',
    title: 'Top clients',
    subtitle: 'Per-IP breakdown with country / location (requires GeoIP for enrichment).',
    defaultWidth: 6,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'snapshot-timeline',
    title: 'Snapshot timeline',
    subtitle: 'Last 8 state snapshots with relative timestamps.',
    defaultWidth: 6,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: false,
    category: 'status',
    link: '/snapshots',
  },
  {
    id: 'slowest',
    title: 'Slowest backends',
    subtitle: 'Top 5 by rtime average.',
    defaultWidth: 6,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/backends',
  },
  {
    id: 'httpcodes',
    title: 'HTTP status codes',
    subtitle: 'Donut chart of the sampled hour.',
    defaultWidth: 4,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 3,
    minHeight: 2,
    requiresStats: true,
    category: 'metric',
    link: '/stats',
  },
  {
    id: 'actions',
    title: 'Quick actions',
    subtitle: 'Reload HAProxy + Renew all certs.',
    defaultWidth: 4,
    defaultHeight: 1,
    defaultAutoHeight: true,
    minWidth: 2,
    minHeight: 1,
    requiresStats: false,
    category: 'action',
    link: null,
  },
  {
    id: 'certs',
    title: 'Certificate status',
    subtitle: 'Per-cert remaining lifetime badges.',
    defaultWidth: 6,
    defaultHeight: 2,
    defaultAutoHeight: true,
    minWidth: 4,
    minHeight: 2,
    requiresStats: false,
    category: 'status',
    link: '/certificates',
  },
  {
    id: 'activity',
    title: 'Recent activity',
    subtitle: 'Last 10 audit entries.',
    defaultWidth: 12,
    defaultHeight: 3,
    defaultAutoHeight: true,
    minWidth: 6,
    minHeight: 2,
    requiresStats: false,
    category: 'status',
    link: '/audit',
  },
]);

const computeRoutesBadge = (doc, rows) => {
  if (!rows || rows.length === 0) {
    return null;
  }
  const uncovered = rows.filter(
    row => row.enabled && findCoveringCertsForRoute(doc.tls.certs ?? [], row).length === 0
  );
  if (uncovered.length > 0) {
    return { label: `${uncovered.length} no cert`, variant: 'warning', text: 'dark' };
  }
  return { label: 'all covered', variant: 'success' };
};

const computeBackendsBadge = rows => {
  if (!rows || rows.length === 0) {
    return null;
  }
  const backends = rows.filter(r => r.svname === 'BACKEND');
  const up = backends.filter(r => r.status?.startsWith('UP')).length;
  const down = backends.filter(r => r.status?.startsWith('DOWN')).length;
  if (down > 0) {
    return { label: `${down} DOWN`, variant: 'danger' };
  }
  if (up > 0) {
    return { label: `${up} UP`, variant: 'success' };
  }
  return null;
};

const useCertSummary = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/certificates')
        .then(payload => {
          if (active) {
            setData(payload);
          }
        })
        .catch(() => undefined);
    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  return data;
};

const computeCertsBadge = liveCerts => {
  if (!liveCerts?.certs) {
    return null;
  }
  let expired = 0;
  let expiring = 0;
  for (const cert of liveCerts.certs) {
    if (!cert.newest?.notAfter) {
      expired += 1;
      continue;
    }
    const days = Math.round(
      (new Date(cert.newest.notAfter).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    if (days < 0) {
      expired += 1;
    } else if (days < 14) {
      expiring += 1;
    }
  }
  if (expired > 0) {
    return { label: `${expired} expired`, variant: 'danger' };
  }
  if (expiring > 0) {
    return { label: `${expiring} expiring`, variant: 'warning', text: 'dark' };
  }
  if (liveCerts.certs.length > 0) {
    return { label: 'all valid', variant: 'success' };
  }
  return null;
};

const computeProvidersBadge = doc => {
  if (!doc?.tls?.providers?.length) {
    return null;
  }
  const usedIds = new Set(doc.tls.certs.map(c => c.providerId));
  const unused = doc.tls.providers.filter(p => !usedIds.has(p.id)).length;
  if (unused > 0) {
    return { label: `${unused} unused`, variant: 'secondary' };
  }
  return null;
};

const renderKpiPanel = (id, ctx, doc) => {
  switch (id) {
    case 'kpi-routes': {
      const routeRows = ctx.routeRows ?? [];
      return (
        <Tile
          title="Routes"
          value={routeRows.length}
          icon="signpost-2"
          variant="info"
          statusBadge={computeRoutesBadge(doc, routeRows)}
        />
      );
    }
    case 'kpi-backends':
      return (
        <Tile
          title="Backends"
          value={doc.backends.length}
          icon="hdd-network"
          variant="info"
          statusBadge={ctx.statsReady ? computeBackendsBadge(ctx.rows) : null}
        />
      );
    case 'kpi-certs':
      return (
        <Tile
          title="Certificates"
          value={doc.tls.certs.length}
          icon="shield-lock"
          variant="info"
          statusBadge={computeCertsBadge(ctx.liveCerts)}
        />
      );
    case 'kpi-providers':
      return (
        <Tile
          title="TLS Providers"
          value={doc.tls.providers.length}
          icon="plug"
          variant="info"
          statusBadge={computeProvidersBadge(doc)}
        />
      );
    default:
      return null;
  }
};

const PANEL_RENDERERS = Object.freeze({
  'live-totals': ({ ctx }) => <LiveTotalsPanel ctx={ctx} />,
  alerts: ({ ctx, doc }) => <AlertsPanel doc={doc} ctx={ctx} />,
  'live-rate': ({ ctx }) => <LiveRatePanel ctx={ctx} />,
  'error-rate': () => <ErrorRatePanel />,
  'connection-pool': ({ ctx }) => <ConnectionPoolPanel ctx={ctx} />,
  'tls-coverage': ({ ctx, doc }) => <TlsCoveragePanel doc={doc} ctx={ctx} />,
  'top-hosts': ({ doc }) => <TopHostsPanel doc={doc} />,
  'geo-origins': () => <GeoOriginsPanel />,
  'origin-map': ({ ctx }) => <WorldOriginMapPanel ctx={ctx} />,
  'top-clients': () => <TopClientsPanel />,
  'snapshot-timeline': () => <SnapshotTimelinePanel />,
  runtime: ({ ctx }) => <RuntimeCard info={ctx.info} />,
  health: ({ ctx }) => <BackendHealthCard rows={ctx.rows} />,
  slowest: () => <SlowestBackendsCard />,
  httpcodes: ({ ctx }) => <HttpCodePieCard theme={ctx.theme} />,
  actions: () => <QuickActionsCard />,
  certs: () => <CertStatusCard />,
  activity: () => <RecentActivity />,
});

const renderPanel = (id, ctx, doc) => {
  if (id.startsWith('kpi-')) {
    return renderKpiPanel(id, ctx, doc);
  }
  if (id.startsWith('traffic:')) {
    return <PerFrontendTrafficCard name={id.slice('traffic:'.length)} theme={ctx.theme} />;
  }
  const renderer = PANEL_RENDERERS[id];
  return renderer ? renderer({ ctx, doc }) : null;
};

const buildTrafficPanelDef = name => ({
  id: `traffic:${name}`,
  title: `Frontend traffic — ${name}`,
  subtitle: `Live in/out bandwidth for frontend ${name}.`,
  defaultWidth: 6,
  defaultHeight: 3,
  defaultAutoHeight: true,
  minWidth: 3,
  minHeight: 1,
  requiresStats: true,
  category: 'metric',
  link: '/stats',
});

// v0.3.0 — Panel chrome. Each card on the dashboard is wrapped here. The
// chrome surfaces three controls in the top-right corner (auto-dimmed,
// brighten on panel hover):
//
//   1. Layout — opens a popover styled like Home Assistant's card-layout
//      dialog: visual 12-col grid, width slider, height stepper, auto-
//      height toggle. Also surfaces the Hide action.
//   2. Expand — opens the panel content full-screen in a modal.
//   3. Drag handle — drag to reorder. Drop target is the whole panel.
//
// The whole panel chrome accepts onDragOver/onDrop so dropping anywhere
// on the target panel works, not just on the tiny grip button.

const PanelChrome = ({
  panelId,
  panelTitle,
  panelLink,
  category,
  width,
  heightRows,
  autoHeight,
  minWidth,
  minHeight,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onWidth,
  onHeightRows,
  onAutoHeight,
  onExpand,
  onHide,
  children,
}) => {
  const [showLayout, setShowLayout] = useState(false);
  const isDragOver = dragState.overId === panelId && dragState.sourceId !== panelId;
  const isSource = dragState.sourceId === panelId;
  const classes = [`patchpanel-panel`, `patchpanel-panel-${category}`];
  if (isDragOver) {
    classes.push('patchpanel-panel-is-drop-target');
  }
  if (isSource) {
    classes.push('patchpanel-panel-is-source');
  }
  const gridStyle = {
    gridColumn: `span ${width}`,
    gridRow: `span ${heightRows}`,
    position: 'relative',
    borderRadius: '0.5rem',
  };
  return (
    <div
      className={classes.join(' ')}
      style={gridStyle}
      onDragOver={e => onDragOver(e, panelId)}
      onDrop={e => onDrop(e, panelId)}
    >
      <div
        className="patchpanel-panel-controls"
        style={{
          position: 'absolute',
          top: '0.4rem',
          right: '0.4rem',
          zIndex: 6,
          display: 'flex',
          gap: '0.25rem',
        }}
      >
        {panelLink ? (
          <Button
            as={Link}
            to={panelLink}
            variant="outline-secondary"
            size="sm"
            title={`Open ${panelTitle} page`}
            style={{ padding: '0.1rem 0.35rem', fontSize: '0.7rem', lineHeight: 1 }}
          >
            <i className="bi bi-box-arrow-up-right" />
          </Button>
        ) : null}
        <Button
          variant="outline-secondary"
          size="sm"
          title="Configure layout"
          onClick={() => setShowLayout(true)}
          style={{ padding: '0.1rem 0.35rem', fontSize: '0.7rem', lineHeight: 1 }}
        >
          <i className="bi bi-aspect-ratio" />
        </Button>
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() => onExpand(panelId)}
          title="Expand to full-screen"
          style={{ padding: '0.1rem 0.35rem', fontSize: '0.7rem', lineHeight: 1 }}
        >
          <i className="bi bi-arrows-fullscreen" />
        </Button>
        <Button
          variant="outline-secondary"
          size="sm"
          draggable
          onDragStart={e => onDragStart(e, panelId)}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          style={{
            padding: '0.1rem 0.35rem',
            fontSize: '0.7rem',
            cursor: 'grab',
            lineHeight: 1,
          }}
        >
          <i className="bi bi-grip-vertical" />
        </Button>
      </div>
      {children}
      {showLayout ? (
        <PanelLayoutPopover
          show
          panelTitle={panelTitle}
          width={width}
          heightRows={heightRows}
          autoHeight={autoHeight}
          minWidth={minWidth}
          minHeight={minHeight}
          onWidth={next => onWidth(panelId, next)}
          onHeightRows={next => onHeightRows(panelId, next)}
          onAutoHeight={next => onAutoHeight(panelId, next)}
          onHide={() => {
            onHide(panelId);
            setShowLayout(false);
          }}
          onClose={() => setShowLayout(false)}
        />
      ) : null}
    </div>
  );
};

PanelChrome.propTypes = {
  panelId: PropTypes.string.isRequired,
  panelTitle: PropTypes.string.isRequired,
  panelLink: PropTypes.string,
  category: PropTypes.oneOf(['metric', 'status', 'action']).isRequired,
  width: PropTypes.number.isRequired,
  heightRows: PropTypes.number.isRequired,
  autoHeight: PropTypes.bool.isRequired,
  minWidth: PropTypes.number,
  minHeight: PropTypes.number,
  dragState: PropTypes.shape({
    overId: PropTypes.string,
    sourceId: PropTypes.string,
  }).isRequired,
  onDragStart: PropTypes.func.isRequired,
  onDragOver: PropTypes.func.isRequired,
  onDrop: PropTypes.func.isRequired,
  onDragEnd: PropTypes.func.isRequired,
  onWidth: PropTypes.func.isRequired,
  onHeightRows: PropTypes.func.isRequired,
  onAutoHeight: PropTypes.func.isRequired,
  onExpand: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired,
};

const useDashboardDrag = onMoveTo => {
  const sourceRef = useRef(null);
  const [sourceId, setSourceId] = useState(null);
  const [overId, setOverId] = useState(null);

  const onDragStart = (e, id) => {
    sourceRef.current = id;
    setSourceId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      // Older browsers; non-fatal.
    }
  };

  const onDragOver = (e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) {
      setOverId(id);
    }
  };

  const onDrop = (e, targetId) => {
    e.preventDefault();
    const src = sourceRef.current;
    sourceRef.current = null;
    setSourceId(null);
    setOverId(null);
    if (src && src !== targetId) {
      onMoveTo(src, targetId);
    }
  };

  const onDragEnd = () => {
    sourceRef.current = null;
    setSourceId(null);
    setOverId(null);
  };

  return { dragState: { overId, sourceId }, onDragStart, onDragOver, onDrop, onDragEnd };
};

export const DashboardPage = ({ doc = null, theme = 'light' }) => {
  const { info, rows, error } = useHaproxyLive();
  const stats = useStatsHistory();
  const liveCerts = useCertSummary();
  const [expandedPanel, setExpandedPanel] = useState(null);

  const [knownFrontendNames, setKnownFrontendNames] = useState([]);
  useEffect(() => {
    const names = Object.keys(stats.history ?? {})
      .filter(key => key.endsWith('/FRONTEND'))
      .map(key => key.replace('/FRONTEND', ''))
      .sort();
    setKnownFrontendNames(prev => {
      if (prev.length === names.length && prev.every((n, i) => n === names[i])) {
        return prev;
      }
      return names;
    });
  }, [stats.history]);

  const allPanelDefs = useMemo(
    () => [...PANEL_DEFS, ...knownFrontendNames.map(buildTrafficPanelDef)],
    [knownFrontendNames]
  );
  const allPanelIds = useMemo(() => allPanelDefs.map(p => p.id), [allPanelDefs]);

  const layout = useDashboardLayout(allPanelIds);
  const drag = useDashboardDrag(layout.moveTo);

  if (!doc) {
    return <p className="text-muted">No state document loaded.</p>;
  }
  const statsReady = !error && info !== null;
  const routeRows = deriveRouteRows(doc);
  const ctx = { info, rows, theme, statsReady, liveCerts, routeRows };
  const isDragging = drag.dragState.sourceId !== null;

  const visiblePanels = layout.order
    .filter(id => !layout.hidden.has(id))
    .map(id => allPanelDefs.find(p => p.id === id))
    .filter(Boolean);
  const hiddenPanels = layout.order
    .filter(id => layout.hidden.has(id))
    .map(id => allPanelDefs.find(p => p.id === id))
    .filter(Boolean);

  return (
    <>
      {!statsReady ? (
        <Row className="g-3 mb-3">
          <Col xs={12}>
            <StatsSocketUnavailable message={error?.message} />
          </Col>
        </Row>
      ) : null}

      <div className={`patchpanel-dashboard-grid${isDragging ? ' is-dragging' : ''}`}>
        {visiblePanels.map(panel => {
          if (panel.requiresStats && !statsReady) {
            return null;
          }
          const width = layout.widths[panel.id] ?? panel.defaultWidth;
          const userOverrodeHeight = layout.heights[panel.id] !== undefined;
          const autoHeight = layout.autoHeights.has(panel.id) ? true : !userOverrodeHeight;
          const heightRows = autoHeight
            ? panel.defaultHeight
            : (layout.heights[panel.id] ?? panel.defaultHeight);
          return (
            <PanelChrome
              key={panel.id}
              panelId={panel.id}
              panelTitle={panel.title}
              panelLink={panel.link ?? null}
              category={panel.category}
              width={width}
              heightRows={heightRows}
              autoHeight={autoHeight}
              minWidth={panel.minWidth ?? 1}
              minHeight={panel.minHeight ?? 1}
              dragState={drag.dragState}
              onDragStart={drag.onDragStart}
              onDragOver={drag.onDragOver}
              onDrop={drag.onDrop}
              onDragEnd={drag.onDragEnd}
              onWidth={layout.setWidth}
              onHeightRows={layout.setHeight}
              onAutoHeight={layout.setAutoHeight}
              onExpand={setExpandedPanel}
              onHide={layout.hide}
            >
              {renderPanel(panel.id, ctx, doc)}
            </PanelChrome>
          );
        })}
      </div>

      {hiddenPanels.length > 0 ? (
        <div className="mt-4">
          <div className="text-muted small mb-2">
            <i className="bi bi-eye-slash me-1" />
            Hidden panels
          </div>
          <div className="d-flex flex-wrap gap-2">
            {hiddenPanels.map(panel => (
              <Button
                key={panel.id}
                variant="outline-secondary"
                size="sm"
                onClick={() => layout.show(panel.id)}
                title={`Show ${panel.title}`}
              >
                <i className="bi bi-plus-lg me-1" />
                {panel.title}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {expandedPanel ? (
        <ExpandedChartModal
          show
          title={allPanelDefs.find(p => p.id === expandedPanel)?.title ?? 'Panel'}
          onClose={() => setExpandedPanel(null)}
        >
          {renderPanel(expandedPanel, ctx, doc)}
        </ExpandedChartModal>
      ) : null}
    </>
  );
};

DashboardPage.propTypes = {
  doc: stateDocShape,
  theme: PropTypes.oneOf(['light', 'dark']),
};
