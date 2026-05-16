import worldMap from '@highcharts/map-collection/custom/world.topo.json';
import HighchartsReact from 'highcharts-react-official';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, ProgressBar, Table } from 'react-bootstrap';
import { Link } from 'react-router';

import { apiGet } from '../api/client.js';
import { useStatsHistory } from '../hooks/useStatsHistory.jsx';
import { findCoveringCertsForRoute } from '../utils/certMatch.js';

import { createChartOptions } from './chartDefaults.js';
import Highcharts from './Highcharts.jsx';
import { deriveRouteRows } from './RouteWizard.jsx';

// v0.2.40 — New dashboard panels. Each one owns its data fetching, polling,
// and rendering. They're plain components that take `doc` (state) and
// `ctx` (the dashboard's shared { info, rows, theme }) and render a Card.

const formatBps = bps => {
  if (!Number.isFinite(bps) || bps <= 0) {
    return '0 B/s';
  }
  if (bps < 1024) {
    return `${Math.round(bps)} B/s`;
  }
  if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(1)} KB/s`;
  }
  if (bps < 1024 * 1024 * 1024) {
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  }
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
};

const formatRate = rate => {
  if (!Number.isFinite(rate) || rate <= 0) {
    return '0';
  }
  if (rate < 10) {
    return rate.toFixed(2);
  }
  if (rate < 1000) {
    return rate.toFixed(1);
  }
  return Math.round(rate).toLocaleString();
};

// ---------------- Active alerts ----------------

const backendDownAlerts = rows =>
  rows
    .filter(r => r.svname === 'BACKEND' && r.status && r.status.startsWith('DOWN'))
    .map(be => ({
      severity: 'error',
      icon: 'exclamation-triangle-fill',
      title: `Backend ${be.pxname} is DOWN`,
      detail: `${be.status} — no healthy servers`,
      to: `/backends?focus=${encodeURIComponent(be.pxname)}`,
    }));

const groupServersDown = rows => {
  const out = new Map();
  for (const row of rows) {
    if (row.svname === 'FRONTEND' || row.svname === 'BACKEND') {
      continue;
    }
    if (row.status?.startsWith('DOWN')) {
      const list = out.get(row.pxname) ?? [];
      list.push(row.svname);
      out.set(row.pxname, list);
    }
  }
  return out;
};

const serverDownAlerts = (rows, downBackendNames) => {
  const grouped = groupServersDown(rows);
  const alerts = [];
  for (const [pxname, svnames] of grouped) {
    if (downBackendNames.has(pxname)) {
      continue;
    }
    alerts.push({
      severity: 'warning',
      icon: 'exclamation-circle',
      title: `${svnames.length} server${svnames.length === 1 ? '' : 's'} down in ${pxname}`,
      detail: svnames.slice(0, 3).join(', ') + (svnames.length > 3 ? ', …' : ''),
      to: `/backends?focus=${encodeURIComponent(pxname)}`,
    });
  }
  return alerts;
};

const certAlertFor = cert => {
  if (!cert.newest?.notAfter) {
    return {
      severity: 'warning',
      icon: 'shield-exclamation',
      title: `Cert ${cert.certName} has no lineage on disk`,
      detail: "No PEM loaded — HAProxy can't serve TLS for this cert yet",
      to: `/certificates?focus=${encodeURIComponent(cert.id)}`,
    };
  }
  const days = Math.round(
    (new Date(cert.newest.notAfter).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );
  if (days < 0) {
    return {
      severity: 'error',
      icon: 'shield-slash',
      title: `Cert ${cert.certName} expired ${-days}d ago`,
      detail: `notAfter ${new Date(cert.newest.notAfter).toLocaleDateString()}`,
      to: `/certificates?focus=${encodeURIComponent(cert.id)}`,
    };
  }
  if (days < 14) {
    return {
      severity: 'warning',
      icon: 'shield-exclamation',
      title: `Cert ${cert.certName} expires in ${days}d`,
      detail: 'Renewal recommended',
      to: `/certificates?focus=${encodeURIComponent(cert.id)}`,
    };
  }
  return null;
};

const certAlerts = liveCerts => (liveCerts?.certs ?? []).map(certAlertFor).filter(Boolean);

const uncoveredRouteAlert = doc => {
  if (!doc) {
    return null;
  }
  const rows = deriveRouteRows(doc);
  const uncovered = rows.filter(
    row => row.enabled && findCoveringCertsForRoute(doc?.tls?.certs ?? [], row).length === 0
  );
  if (uncovered.length === 0) {
    return null;
  }
  return {
    severity: 'warning',
    icon: 'patch-exclamation',
    title: `${uncovered.length} route${uncovered.length === 1 ? '' : 's'} without a covering cert`,
    detail:
      uncovered
        .slice(0, 3)
        .map(r => r.hostnames?.[0] ?? r.rowKey)
        .join(', ') + (uncovered.length > 3 ? ', …' : ''),
    to: '/routes',
  };
};

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });

const buildAlerts = ({ doc, rows, liveCerts }) => {
  const downBackends = backendDownAlerts(rows);
  const downBackendNames = new Set(
    rows.filter(r => r.svname === 'BACKEND' && r.status?.startsWith('DOWN')).map(r => r.pxname)
  );
  const alerts = [
    ...downBackends,
    ...serverDownAlerts(rows, downBackendNames),
    ...certAlerts(liveCerts),
    uncoveredRouteAlert(doc),
  ].filter(Boolean);
  alerts.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  return alerts;
};

const SEVERITY_VARIANTS = Object.freeze({
  error: 'danger',
  warning: 'warning',
  info: 'info',
});

export const AlertsPanel = ({ doc, ctx }) => {
  const [liveCerts, setLiveCerts] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/certificates')
        .then(payload => {
          if (active) {
            setLiveCerts(payload);
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

  const alerts = useMemo(
    () => buildAlerts({ doc, rows: ctx.rows ?? [], liveCerts }),
    [doc, ctx.rows, liveCerts]
  );

  return (
    <Card className="patchpanel-panel-status h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-bell me-2" />
          Active alerts
          {alerts.length > 0 ? (
            <Badge bg={SEVERITY_VARIANTS[alerts[0].severity] ?? 'secondary'} className="ms-2">
              {alerts.length}
            </Badge>
          ) : (
            <Badge bg="success" className="ms-2">
              <i className="bi bi-check-lg" />
            </Badge>
          )}
        </Card.Title>
        {alerts.length === 0 ? (
          <p className="text-muted small mb-0">
            <i className="bi bi-check-circle text-success me-1" />
            All systems nominal — no degraded backends, no expiring certs, every route is covered.
          </p>
        ) : (
          <ul className="list-unstyled mb-0">
            {alerts.slice(0, 8).map((alert, idx) => {
              const variant = SEVERITY_VARIANTS[alert.severity] ?? 'secondary';
              const body = (
                <>
                  <i className={`bi bi-${alert.icon} text-${variant} me-2`} />
                  <span>
                    <strong>{alert.title}</strong>
                  </span>
                  <div className="ms-4 text-muted small">{alert.detail}</div>
                </>
              );
              return (
                <li
                  // eslint-disable-next-line react/no-array-index-key
                  key={`${alert.title}-${idx}`}
                  className="small py-1 border-bottom border-light"
                >
                  {alert.to ? (
                    <Link to={alert.to} className="text-decoration-none text-reset">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
            {alerts.length > 8 ? (
              <li className="small text-muted mt-1">+ {alerts.length - 8} more…</li>
            ) : null}
          </ul>
        )}
      </Card.Body>
    </Card>
  );
};

AlertsPanel.propTypes = {
  doc: PropTypes.object.isRequired,
  ctx: PropTypes.object.isRequired,
};

// ---------------- Connection pool ----------------

const connPoolVariant = pct => {
  if (pct >= 90) {
    return 'danger';
  }
  if (pct >= 70) {
    return 'warning';
  }
  return 'success';
};

export const ConnectionPoolPanel = ({ ctx }) => {
  const info = ctx.info ?? {};
  const cur = Number(info.CurrConns) || 0;
  const max = Number(info.Maxconn) || Number(info.MaxConn) || 1;
  const pct = Math.min(100, Math.round((cur / max) * 100));
  const variant = connPoolVariant(pct);

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-arrows-collapse-vertical me-2" />
          Connection pool
        </Card.Title>
        <div className="d-flex justify-content-between align-items-end mb-1">
          <span className="display-6 fw-semibold">{cur.toLocaleString()}</span>
          <span className="text-muted small">/ {max.toLocaleString()}</span>
        </div>
        <ProgressBar variant={variant} now={pct} className="mb-1" style={{ height: '0.5rem' }} />
        <div className="d-flex justify-content-between small text-muted">
          <span>active sessions</span>
          <span>{pct}% of cap</span>
        </div>
      </Card.Body>
    </Card>
  );
};

ConnectionPoolPanel.propTypes = {
  ctx: PropTypes.object.isRequired,
};

// ---------------- Live request rate ----------------

const sumLatestReqRate = history => {
  let total = 0;
  for (const [key, series] of Object.entries(history ?? {})) {
    if (!key.endsWith('/FRONTEND') || !Array.isArray(series) || series.length === 0) {
      continue;
    }
    const last = series[series.length - 1];
    total += last.reqRate ?? 0;
  }
  return total;
};

const aggregateReqRateSeries = history => {
  const tsBuckets = new Map();
  for (const [key, series] of Object.entries(history ?? {})) {
    if (!key.endsWith('/FRONTEND')) {
      continue;
    }
    for (const point of series) {
      tsBuckets.set(point.ts, (tsBuckets.get(point.ts) ?? 0) + (point.reqRate ?? 0));
    }
  }
  return [...tsBuckets.entries()].sort((a, b) => a[0] - b[0]);
};

export const LiveRatePanel = ({ ctx }) => {
  const stats = useStatsHistory();
  const total = sumLatestReqRate(stats.history);
  const aggregated = aggregateReqRateSeries(stats.history);

  const options = createChartOptions({
    title: '',
    height: 90,
    theme: ctx.theme,
    yAxisTitle: '',
    yAxisAllowDecimals: false,
    tooltipValueDecimals: 1,
    tooltipValueSuffix: ' req/s',
    series: [
      {
        name: 'req/s',
        data: aggregated,
        color: '#0d6efd',
      },
    ],
    animation: false,
  });
  options.legend = { enabled: false };
  options.chart.spacing = [4, 4, 4, 4];

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-lightning-charge me-2" />
          Live request rate
        </Card.Title>
        <div className="d-flex justify-content-between align-items-baseline mb-1">
          <span className="display-6 fw-semibold">{formatRate(total)}</span>
          <span className="text-muted small">req/s · all frontends</span>
        </div>
        {aggregated.length > 1 ? (
          <HighchartsReact highcharts={Highcharts} options={options} />
        ) : (
          <div className="text-muted small">Sampling… (5s ticks)</div>
        )}
      </Card.Body>
    </Card>
  );
};

LiveRatePanel.propTypes = {
  ctx: PropTypes.object.isRequired,
};

// ---------------- Error rate ----------------

const errorRateVariant = pct => {
  if (pct >= 5) {
    return 'danger';
  }
  if (pct >= 1) {
    return 'warning';
  }
  return 'success';
};

export const ErrorRatePanel = () => {
  const [totals, setTotals] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/http-codes')
        .then(payload => {
          if (active) {
            setTotals(payload?.totals ?? null);
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
    return (
      <Card className="patchpanel-panel-metric h-100">
        <Card.Body>
          <Card.Title className="mb-2">
            <i className="bi bi-exclamation-octagon me-2" />
            Error rate
          </Card.Title>
          <div className="text-muted small">Sampling…</div>
        </Card.Body>
      </Card>
    );
  }

  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const errs = (totals['4xx'] ?? 0) + (totals['5xx'] ?? 0);
  const pct = sum === 0 ? 0 : (errs / sum) * 100;
  const variant = errorRateVariant(pct);

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-exclamation-octagon me-2" />
          Error rate
        </Card.Title>
        <div className="d-flex justify-content-between align-items-baseline mb-1">
          <span className={`display-6 fw-semibold text-${variant}`}>{pct.toFixed(2)}%</span>
          <span className="text-muted small">
            {errs.toLocaleString()} / {sum.toLocaleString()}
          </span>
        </div>
        <ProgressBar
          variant={variant}
          now={Math.min(100, pct)}
          className="mb-1"
          style={{ height: '0.4rem' }}
        />
        <div className="small text-muted">4xx + 5xx over the sampled hour</div>
      </Card.Body>
    </Card>
  );
};

// ---------------- TLS coverage donut ----------------

const TLS_COLORS = Object.freeze({
  valid: '#198754',
  expiring: '#ffc107',
  expired: '#dc3545',
  missing: '#6c757d',
});

// State rank: lower number = worse. Coverage walks each cert covering the
// route and keeps the BEST state — i.e. if any covering cert is valid the
// route is valid; otherwise if any is expiring, the route is expiring;
// only when all covering certs are expired/missing is the route worst-case.
const STATE_RANK = Object.freeze({ missing: 0, expired: 1, expiring: 2, valid: 3 });

const certStateFor = (cert, certById) => {
  const live = certById.get(cert.id);
  if (!live?.newest?.notAfter) {
    return 'expired';
  }
  const days = Math.round(
    (new Date(live.newest.notAfter).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  );
  if (days < 0) {
    return 'expired';
  }
  if (days < 14) {
    return 'expiring';
  }
  return 'valid';
};

const routeCoverageState = (route, certs, certById) => {
  const covering = findCoveringCertsForRoute(certs, route);
  if (covering.length === 0) {
    return 'missing';
  }
  let best = 'expired';
  for (const cert of covering) {
    const state = certStateFor(cert, certById);
    if (STATE_RANK[state] > STATE_RANK[best]) {
      best = state;
    }
    if (best === 'valid') {
      break;
    }
  }
  return best;
};

const computeTlsCoverage = (doc, liveCerts) => {
  const buckets = { valid: 0, expiring: 0, expired: 0, missing: 0 };
  const certById = new Map((liveCerts?.certs ?? []).map(c => [c.id, c]));
  const certs = doc?.tls?.certs ?? [];
  const rows = doc ? deriveRouteRows(doc) : [];
  for (const row of rows) {
    if (!row.enabled) {
      continue;
    }
    const state = routeCoverageState(row, certs, certById);
    buckets[state] += 1;
  }
  return buckets;
};

export const TlsCoveragePanel = ({ doc, ctx }) => {
  const [liveCerts, setLiveCerts] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/certificates')
        .then(payload => {
          if (active) {
            setLiveCerts(payload);
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

  const buckets = useMemo(() => computeTlsCoverage(doc, liveCerts), [doc, liveCerts]);
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <Card className="patchpanel-panel-status h-100">
        <Card.Body>
          <Card.Title className="mb-2">
            <i className="bi bi-shield-check me-2" />
            TLS coverage
          </Card.Title>
          <p className="text-muted small mb-0">
            No enabled routes yet. Add a route on the Routes tab to start.
          </p>
        </Card.Body>
      </Card>
    );
  }

  const data = [
    { name: 'Valid (≥14d)', y: buckets.valid, color: TLS_COLORS.valid },
    { name: 'Expiring (<14d)', y: buckets.expiring, color: TLS_COLORS.expiring },
    { name: 'Expired', y: buckets.expired, color: TLS_COLORS.expired },
    { name: 'No cert', y: buckets.missing, color: TLS_COLORS.missing },
  ].filter(d => d.y > 0);

  const base = createChartOptions({ title: '', height: 180, theme: ctx.theme, series: [] });
  const options = {
    ...base,
    chart: { ...base.chart, type: 'pie' },
    plotOptions: {
      pie: { innerSize: '60%', dataLabels: { enabled: false } },
    },
    series: [{ name: 'routes', data }],
    legend: {
      enabled: true,
      align: 'right',
      verticalAlign: 'middle',
      layout: 'vertical',
      itemStyle: base.legend.itemStyle,
    },
  };

  return (
    <Card className="patchpanel-panel-status h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-shield-check me-2" />
          TLS coverage
        </Card.Title>
        <HighchartsReact highcharts={Highcharts} options={options} />
        <div className="text-muted small text-center">
          {total} enabled route{total === 1 ? '' : 's'}
        </div>
      </Card.Body>
    </Card>
  );
};

TlsCoveragePanel.propTypes = {
  doc: PropTypes.object.isRequired,
  ctx: PropTypes.object.isRequired,
};

// ---------------- Top hosts (by request rate) ----------------

const TOP_HOSTS_LIMIT = 10;

export const TopHostsPanel = ({ doc }) => {
  const stats = useStatsHistory();

  // Aggregate the latest reqRate by backend, then resolve backend → route
  // → first hostname.
  const rows = useMemo(() => {
    const byBackend = new Map();
    for (const [key, series] of Object.entries(stats.history ?? {})) {
      if (!key.endsWith('/BACKEND') || !Array.isArray(series) || series.length === 0) {
        continue;
      }
      const backendName = key.replace('/BACKEND', '');
      const last = series[series.length - 1];
      byBackend.set(backendName, last.reqRate ?? 0);
    }
    const backendNameToRouteLabel = new Map();
    const routeRows = doc ? deriveRouteRows(doc) : [];
    for (const row of routeRows) {
      const backend = doc?.backends?.find(b => b.id === row.backendId);
      if (backend) {
        backendNameToRouteLabel.set(backend.name, {
          label: row.hostnames?.[0] ?? row.ruleLabel,
          routeId: row.rowKey,
        });
      }
    }
    const aggregated = [...byBackend.entries()]
      .map(([backendName, rate]) => ({
        backendName,
        rate,
        ...(backendNameToRouteLabel.get(backendName) ?? {
          label: backendName,
          routeId: null,
        }),
      }))
      .filter(r => r.rate > 0)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, TOP_HOSTS_LIMIT);
    return aggregated;
  }, [doc, stats.history]);

  if (rows.length === 0) {
    return (
      <Card className="patchpanel-panel-metric h-100">
        <Card.Body>
          <Card.Title className="mb-2">
            <i className="bi bi-bar-chart me-2" />
            Top hosts (req/s)
          </Card.Title>
          <p className="text-muted small mb-0">No traffic in the sampled window yet.</p>
        </Card.Body>
      </Card>
    );
  }

  const max = rows[0].rate;
  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-bar-chart me-2" />
          Top hosts (req/s)
        </Card.Title>
        <Table size="sm" responsive className="mb-0">
          <tbody>
            {rows.map(r => {
              const pct = max === 0 ? 0 : (r.rate / max) * 100;
              return (
                <tr key={r.backendName}>
                  <td style={{ width: '40%' }}>
                    {r.routeId ? (
                      <Link
                        to={`/routes?focus=${encodeURIComponent(r.routeId)}`}
                        className="text-decoration-none small"
                      >
                        {r.label}
                      </Link>
                    ) : (
                      <code className="small">{r.label}</code>
                    )}
                  </td>
                  <td>
                    <ProgressBar
                      now={pct}
                      variant="info"
                      style={{ height: '0.55rem' }}
                      className="mt-1"
                    />
                  </td>
                  <td className="text-end small text-muted" style={{ width: '5rem' }}>
                    {formatRate(r.rate)}/s
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
};

TopHostsPanel.propTypes = {
  doc: PropTypes.object.isRequired,
};

// ---------------- Snapshot timeline ----------------
// v0.2.41 — Lists the last N state snapshots as a vertical timeline so users
// can see "when did things change". Each row is a clickable link to the
// Snapshots tab focused on that snapshot for preview / restore.

const formatRelative = iso => {
  if (!iso) {
    return '?';
  }
  const ts = new Date(iso).getTime();
  const deltaSec = Math.max(0, (Date.now() - ts) / 1000);
  if (deltaSec < 60) {
    return `${Math.round(deltaSec)}s ago`;
  }
  if (deltaSec < 3600) {
    return `${Math.round(deltaSec / 60)}m ago`;
  }
  if (deltaSec < 86_400) {
    return `${Math.round(deltaSec / 3600)}h ago`;
  }
  return `${Math.round(deltaSec / 86_400)}d ago`;
};

export const SnapshotTimelinePanel = () => {
  const [snapshots, setSnapshots] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/snapshots')
        .then(payload => {
          if (active) {
            setSnapshots(payload?.snapshots ?? []);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
          }
        });
    fetchOnce();
    const interval = setInterval(fetchOnce, 60_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  const recent = snapshots.slice(0, 8);
  return (
    <Card className="patchpanel-panel-status h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-clock-history me-2" />
          Snapshot timeline
        </Card.Title>
        {error ? (
          <Alert variant="warning" className="small mb-0">
            Snapshots unavailable: {error.message}
          </Alert>
        ) : null}
        {!error && recent.length === 0 ? (
          <p className="text-muted small mb-0">
            No snapshots yet. They accumulate as you save state.
          </p>
        ) : null}
        {recent.length > 0 ? (
          <ul className="list-unstyled mb-0">
            {recent.map(snap => (
              <li
                key={snap.name}
                className="small py-1 border-bottom border-light d-flex justify-content-between align-items-center gap-2"
              >
                <Link to="/snapshots" className="text-decoration-none text-reset flex-grow-1">
                  <i className="bi bi-dot text-primary" />
                  <span className="ms-1">{formatRelative(snap.iso)}</span>
                  <span className="text-muted ms-2">{new Date(snap.iso).toLocaleString()}</span>
                </Link>
                <Badge bg="secondary" className="font-monospace">
                  {snap.sha}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Card.Body>
    </Card>
  );
};

// ---------------- Geo origins (top countries) ----------------
// v0.2.41 — When GeoIP is enabled, /api/stats/sessions enriches topClients
// with `geo.country` / `geo.countryName`. We aggregate by country and show
// the top N. Falls back to a friendly hint when GeoIP isn't on.

const computeGeoBreakdown = sessions => {
  let resolved = 0;
  let privateLan = 0;
  let unresolved = 0;
  let totalClients = 0;
  for (const client of sessions?.topClients ?? []) {
    totalClients += client.count ?? 0;
    if (client.geo?.country) {
      // Covers both online-lookup resolutions AND `source: 'home'` (private
      // IPs mapped to the user's configured home coordinates).
      resolved += client.count ?? 0;
    } else if (client.geo?.source === 'private') {
      privateLan += client.count ?? 0;
    } else {
      unresolved += client.count ?? 0;
    }
  }
  return { resolved, privateLan, unresolved, totalClients };
};

const geoEmptyStateBody = (geoStatus, breakdown) => {
  if (!geoStatus) {
    return <span className="text-muted small">Checking GeoIP status…</span>;
  }
  if (!geoStatus.enabled) {
    return (
      <>
        GeoIP enrichment is <strong>off</strong>. Turn it on under{' '}
        <Link to="/geoip">Settings → GeoIP</Link> to start resolving client IPs to countries.
      </>
    );
  }
  if (breakdown.totalClients === 0) {
    return <>No active sessions yet. Origins aggregate here once public-IP traffic comes in.</>;
  }
  if (breakdown.privateLan > 0 && breakdown.resolved === 0 && breakdown.unresolved === 0) {
    return (
      <>
        Only LAN / private-IP traffic right now ({breakdown.privateLan} session
        {breakdown.privateLan === 1 ? '' : 's'}). Private addresses don&apos;t resolve to a country.
        Public-IP sessions will show up here when they arrive.
      </>
    );
  }
  if (breakdown.unresolved > 0 && breakdown.resolved === 0) {
    const usingOnlineOnly = geoStatus.localDbSource === 'none';
    return (
      <>
        GeoIP is enabled but {breakdown.unresolved} public-IP session
        {breakdown.unresolved === 1 ? '' : 's'} couldn&apos;t be resolved.{' '}
        {usingOnlineOnly ? (
          <>
            You&apos;re using online-only fallback ({geoStatus.fallbackProvider}); check the addon
            logs for &apos;online geoip lookup failed&apos; to see why the provider is rejecting
            requests (rate limit / bad token / network).
          </>
        ) : (
          <>
            Local DB source is <code>{geoStatus.localDbSource}</code> but the DB is{' '}
            {geoStatus.dbExists ? 'present' : 'missing'}. Click <strong>Download now</strong> under{' '}
            <Link to="/geoip">Settings → GeoIP</Link>.
          </>
        )}
      </>
    );
  }
  return (
    <>
      No country-resolved sessions yet ({breakdown.privateLan} private, {breakdown.unresolved}{' '}
      unresolved).
    </>
  );
};

export const GeoOriginsPanel = () => {
  const [sessions, setSessions] = useState(null);
  const [geoStatus, setGeoStatus] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () => {
      apiGet('api/stats/sessions')
        .then(payload => {
          if (active) {
            setSessions(payload);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
          }
        });
      apiGet('api/geoip/status')
        .then(payload => {
          if (active) {
            setGeoStatus(payload);
          }
        })
        .catch(() => undefined);
    };
    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const countries = useMemo(() => {
    const byCountry = new Map();
    for (const client of sessions?.topClients ?? []) {
      const cc = client.geo?.country ?? null;
      const label = client.geo?.countryName ?? cc ?? 'Unknown';
      if (!cc) {
        continue;
      }
      const entry = byCountry.get(cc) ?? { country: cc, label, count: 0 };
      entry.count += client.count;
      byCountry.set(cc, entry);
    }
    return [...byCountry.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }, [sessions]);

  const breakdown = useMemo(() => computeGeoBreakdown(sessions), [sessions]);

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-globe-americas me-2" />
          Top countries
        </Card.Title>
        {error ? (
          <p className="text-muted small mb-0">Live sessions unavailable: {error.message}</p>
        ) : null}
        {!error && countries.length === 0 ? (
          <p className="text-muted small mb-0">{geoEmptyStateBody(geoStatus, breakdown)}</p>
        ) : null}
        {countries.length > 0 ? (
          <Table size="sm" responsive className="mb-0">
            <tbody>
              {countries.map(c => {
                const max = countries[0].count;
                const pct = max === 0 ? 0 : (c.count / max) * 100;
                return (
                  <tr key={c.country}>
                    <td style={{ width: '4rem' }}>
                      <Badge bg="info">{c.country}</Badge>
                    </td>
                    <td className="small">{c.label}</td>
                    <td>
                      <ProgressBar
                        now={pct}
                        variant="info"
                        style={{ height: '0.5rem' }}
                        className="mt-1"
                      />
                    </td>
                    <td className="text-end small text-muted" style={{ width: '4rem' }}>
                      {c.count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}
      </Card.Body>
    </Card>
  );
};

// ---------------- Live totals (replaces former HeroStrip) ----------------
// v0.3.0 — Was hardcoded at the top of the dashboard. Now a normal panel
// that participates in the layout grid — reorderable, hideable, resizable
// like every other panel. Default width 12 cols, one row tall.

export const LiveTotalsPanel = ({ ctx }) => {
  const stats = useStatsHistory();
  const reqRate = sumLatestReqRate(stats.history);
  let bandwidth = 0;
  for (const [key, series] of Object.entries(stats.history ?? {})) {
    if (!key.endsWith('/FRONTEND') || !Array.isArray(series) || series.length === 0) {
      continue;
    }
    const last = series[series.length - 1];
    bandwidth += (last.binRate ?? 0) + (last.boutRate ?? 0);
  }
  const info = ctx.info ?? {};
  const cur = Number(info.CurrConns) || 0;
  const max = Number(info.Maxconn) || Number(info.MaxConn) || 1;
  const idle = info.Idle_pct ? `${info.Idle_pct}%` : '—';

  const stat = (label, value) => (
    <div className="d-flex flex-column" key={label}>
      <span className="text-muted small text-uppercase" style={{ letterSpacing: '0.05em' }}>
        {label}
      </span>
      <span className="fw-semibold fs-4">{value}</span>
    </div>
  );

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-activity me-2" />
          Live totals
        </Card.Title>
        <div className="d-flex flex-wrap gap-4">
          {stat('Request rate', `${formatRate(reqRate)} req/s`)}
          {stat('Bandwidth', formatBps(bandwidth))}
          {stat(
            'Sessions',
            <>
              {cur.toLocaleString()}{' '}
              <span className="text-muted fs-6">/ {max.toLocaleString()}</span>
            </>
          )}
          {stat('CPU idle', idle)}
        </div>
      </Card.Body>
    </Card>
  );
};

LiveTotalsPanel.propTypes = {
  ctx: PropTypes.object.isRequired,
};

// ---------------- World origin map (choropleth) ----------------
// v0.3.x — Companion to the Top countries table. Shows the same per-country
// session counts as a choropleth: each country shaded by total sessions
// resolved to it. Uses Highcharts Maps + the world topojson from
// @highcharts/map-collection. Joins by hc-key (lowercase ISO 3166-1 alpha-2).

const buildOriginMapOptions = (byCountry, theme) => ({
  chart: {
    map: worldMap,
    spacing: [4, 4, 4, 4],
    backgroundColor: 'transparent',
  },
  title: { text: null },
  credits: { enabled: false },
  mapNavigation: { enabled: true, enableMouseWheelZoom: true },
  legend: { enabled: false },
  colorAxis: {
    min: 0,
    minColor: theme === 'dark' ? 'rgba(13,110,253,0.08)' : 'rgba(13,110,253,0.05)',
    maxColor: '#0d6efd',
  },
  tooltip: {
    headerFormat: '',
    pointFormat: '<b>{point.name}</b>: {point.value} session(s)',
  },
  series: [
    {
      type: 'map',
      data: [...byCountry.entries()].map(([k, v]) => ({ 'hc-key': k, value: v })),
      name: 'Sessions',
      states: { hover: { color: '#a4edba' } },
      nullColor: theme === 'dark' ? '#22262a' : '#fafafa',
      borderColor: theme === 'dark' ? '#3a3f44' : '#dee2e6',
      borderWidth: 0.5,
    },
  ],
});

export const WorldOriginMapPanel = ({ ctx }) => {
  const [sessions, setSessions] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/sessions')
        .then(payload => {
          if (active) {
            setSessions(payload);
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

  const byCountry = useMemo(() => {
    const m = new Map();
    for (const c of sessions?.topClients ?? []) {
      const code = c.geo?.country?.toLowerCase();
      if (code) {
        m.set(code, (m.get(code) ?? 0) + (c.count ?? 0));
      }
    }
    return m;
  }, [sessions]);

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-globe me-2" />
          Origin map
        </Card.Title>
        {byCountry.size === 0 ? (
          <p className="text-muted small mb-0">
            No country-resolved sessions yet. Map populates as GeoIP resolves public-IP clients.
          </p>
        ) : (
          <HighchartsReact
            highcharts={Highcharts}
            constructorType="mapChart"
            options={buildOriginMapOptions(byCountry, ctx?.theme ?? 'light')}
          />
        )}
      </Card.Body>
    </Card>
  );
};

WorldOriginMapPanel.propTypes = {
  ctx: PropTypes.object,
};

// ---------------- Top clients (per-IP breakdown) ----------------
// Companion to Top countries: a flat per-IP table so you can see who is
// actually connecting, not just which country aggregate they belong to.
// Useful for tracking down a noisy client, debugging a misbehaving probe,
// or just satisfying curiosity about who's hitting the homelab.

const TOP_CLIENTS_LIMIT = 15;

const formatClientLocation = geo => {
  if (!geo) {
    return '—';
  }
  const parts = [];
  if (geo.city) {
    parts.push(geo.city);
  }
  if (geo.region && geo.region !== geo.city) {
    parts.push(geo.region);
  }
  if (geo.countryName ?? geo.country) {
    parts.push(geo.countryName ?? geo.country);
  }
  return parts.length > 0 ? parts.join(', ') : '—';
};

const clientSourceBadge = geo => {
  if (!geo) {
    return null;
  }
  if (geo.source === 'home') {
    return <Badge bg="info">home</Badge>;
  }
  if (geo.source === 'private') {
    return <Badge bg="secondary">LAN</Badge>;
  }
  return null;
};

export const TopClientsPanel = () => {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/sessions')
        .then(payload => {
          if (active) {
            setSessions(payload);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
          }
        });
    fetchOnce();
    const interval = setInterval(fetchOnce, 30_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const rows = useMemo(() => {
    const all = sessions?.topClients ?? [];
    return all.slice(0, TOP_CLIENTS_LIMIT);
  }, [sessions]);

  return (
    <Card className="patchpanel-panel-metric h-100">
      <Card.Body>
        <Card.Title className="mb-2">
          <i className="bi bi-people me-2" />
          Top clients
        </Card.Title>
        {error ? (
          <p className="text-muted small mb-0">Live sessions unavailable: {error.message}</p>
        ) : null}
        {!error && rows.length === 0 ? (
          <p className="text-muted small mb-0">
            No active sessions yet. Clients aggregate here once traffic comes in.
          </p>
        ) : null}
        {rows.length > 0 ? (
          <Table size="sm" responsive className="mb-0">
            <thead>
              <tr>
                <th>IP</th>
                <th>Country</th>
                <th>Location</th>
                <th className="text-end">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const cc = c.geo?.country ?? null;
                const sourceBadge = clientSourceBadge(c.geo);
                return (
                  <tr key={c.key}>
                    <td>
                      <code className="small">{c.key}</code> {sourceBadge}
                    </td>
                    <td>
                      {cc ? (
                        <Badge bg="info">{cc}</Badge>
                      ) : (
                        <span className="text-muted small">—</span>
                      )}
                    </td>
                    <td className="small text-muted">{formatClientLocation(c.geo)}</td>
                    <td className="text-end small">{c.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : null}
      </Card.Body>
    </Card>
  );
};
