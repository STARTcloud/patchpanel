import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  InputGroup,
  Row,
  Spinner,
  Tab,
  Table,
  Tabs,
} from 'react-bootstrap';

import { apiGet } from '../api/client.js';
import {
  ComprehensiveStatsTable,
  NumericPromptModal,
} from '../components/ComprehensiveStatsTable.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { ExpandedChartModal } from '../components/ExpandedChartModal.jsx';
import { SessionsChart } from '../components/SessionsChart.jsx';
import { TrafficChart } from '../components/TrafficChart.jsx';
import { useActions } from '../hooks/useActions.jsx';
import { useStatsHistory } from '../hooks/useStatsHistory.jsx';
import { downloadStatsCsv, downloadStatsJson } from '../utils/statsExport.js';

const TopSourcesCard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats/sessions')
        .then(payload => {
          if (active) {
            setData(payload);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
          }
        });
    fetchOnce();
    const interval = setInterval(fetchOnce, 10_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <Alert variant="warning" className="mb-0">
        Active sessions unavailable: {error.message}
      </Alert>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Row className="g-3">
      <Col md={4}>
        <Card>
          <Card.Body>
            <Card.Title>
              Top client IPs{' '}
              <Badge bg="secondary" className="ms-1">
                {data.totalSessions} active
              </Badge>
            </Card.Title>
            {data.topClients.length === 0 ? (
              <p className="text-muted small mb-0">No active sessions.</p>
            ) : (
              <Table size="sm" responsive>
                <tbody>
                  {data.topClients.slice(0, 10).map(entry => (
                    <tr key={entry.key}>
                      <td>
                        <div>
                          <code>{entry.key}</code>
                        </div>
                        {entry.geo ? (
                          <div className="small text-muted">
                            {entry.geo.country ? (
                              <span className="me-1">
                                {entry.geo.country}
                                {entry.geo.city ? ` · ${entry.geo.city}` : ''}
                              </span>
                            ) : null}
                            {entry.geo.asnOrganization ? (
                              <span
                                className="text-truncate d-inline-block"
                                style={{ maxWidth: '12rem' }}
                                title={entry.geo.asnOrganization}
                              >
                                {entry.geo.asnOrganization}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-end align-middle">
                        <Badge bg="info">{entry.count}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      </Col>
      <Col md={4}>
        <Card>
          <Card.Body>
            <Card.Title>Sessions by frontend</Card.Title>
            {data.topFrontends.length === 0 ? (
              <p className="text-muted small mb-0">No active sessions.</p>
            ) : (
              <Table size="sm" responsive>
                <tbody>
                  {data.topFrontends.map(entry => (
                    <tr key={entry.key}>
                      <td>
                        <code>{entry.key}</code>
                      </td>
                      <td className="text-end">
                        <Badge bg="primary">{entry.count}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      </Col>
      <Col md={4}>
        <Card>
          <Card.Body>
            <Card.Title>Sessions by backend</Card.Title>
            {data.topBackends.length === 0 ? (
              <p className="text-muted small mb-0">No active sessions.</p>
            ) : (
              <Table size="sm" responsive>
                <tbody>
                  {data.topBackends.map(entry => (
                    <tr key={entry.key}>
                      <td>
                        <code>{entry.key}</code>
                      </td>
                      <td className="text-end">
                        <Badge bg="success">{entry.count}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

const InfoCard = ({ info = null }) => (
  <Card>
    <Card.Body>
      <Card.Title>HAProxy runtime</Card.Title>
      {info && Object.keys(info).length > 0 ? (
        <Row className="g-2 small">
          {Object.entries(info).map(([k, v]) => (
            <Col key={k} md={4}>
              <strong>{k}:</strong> <code>{v}</code>
            </Col>
          ))}
        </Row>
      ) : (
        <p className="text-muted small mb-0">No info yet.</p>
      )}
    </Card.Body>
  </Card>
);

InfoCard.propTypes = {
  info: PropTypes.objectOf(PropTypes.string),
};

const StatsTableControls = ({
  scope,
  setScope,
  hideDown,
  setHideDown,
  onExportCsv,
  onExportJson,
  onClearCounters,
  clearCountersBusy,
}) => (
  <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
    <div className="d-flex gap-3 align-items-center flex-wrap">
      <InputGroup size="sm" style={{ width: '22rem' }}>
        <InputGroup.Text>
          <i className="bi bi-search" />
        </InputGroup.Text>
        <Form.Control
          placeholder="Filter by proxy / server / status…"
          value={scope}
          onChange={e => setScope(e.target.value)}
        />
        {scope ? (
          <Button variant="outline-secondary" onClick={() => setScope('')}>
            ×
          </Button>
        ) : null}
      </InputGroup>
      <Form.Check
        type="switch"
        id="stats-hide-down-toggle"
        label="Hide DOWN servers"
        checked={hideDown}
        onChange={e => setHideDown(e.target.checked)}
      />
    </div>
    <div className="d-flex gap-2">
      <Button
        variant="outline-warning"
        size="sm"
        onClick={onClearCounters}
        disabled={clearCountersBusy}
        title="Reset all max/total counters via `clear counters all` on the runtime socket. Current sessions and rates are not affected; max/total/error counts reset to zero."
      >
        {clearCountersBusy ? (
          <Spinner as="span" animation="border" size="sm" />
        ) : (
          <>
            <i className="bi bi-eraser me-1" />
            Clear counters
          </>
        )}
      </Button>
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={onExportCsv}
        title="Download stats as CSV"
      >
        <i className="bi bi-filetype-csv me-1" />
        CSV
      </Button>
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={onExportJson}
        title="Download stats as JSON"
      >
        <i className="bi bi-filetype-json me-1" />
        JSON
      </Button>
    </div>
  </div>
);

StatsTableControls.propTypes = {
  scope: PropTypes.string.isRequired,
  setScope: PropTypes.func.isRequired,
  hideDown: PropTypes.bool.isRequired,
  setHideDown: PropTypes.func.isRequired,
  onExportCsv: PropTypes.func.isRequired,
  onExportJson: PropTypes.func.isRequired,
  onClearCounters: PropTypes.func.isRequired,
  clearCountersBusy: PropTypes.bool.isRequired,
};

const ChartTile = ({ title, history, theme, onExpand }) => (
  <div className="position-relative">
    <Button
      variant="link"
      size="sm"
      className="position-absolute top-0 end-0 p-1"
      style={{ zIndex: 2 }}
      onClick={onExpand}
      title="Expand chart"
      aria-label="Expand chart"
    >
      <i className="bi bi-arrows-fullscreen" />
    </Button>
    <TrafficChart title={title} history={history} theme={theme} />
  </div>
);

ChartTile.propTypes = {
  title: PropTypes.string.isRequired,
  history: PropTypes.array.isRequired,
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
  onExpand: PropTypes.func.isRequired,
};

const TablesTab = ({
  data,
  actions,
  scope,
  setScope,
  hideDown,
  setHideDown,
  onSetServerState,
  onSetServerWeight,
  onEnableFrontend,
  onDisableFrontend,
  onSetMaxconn,
  onClearCounters,
}) => (
  <div className="d-flex flex-column gap-3">
    <TopSourcesCard />
    <Card>
      <Card.Body>
        <Card.Title>Frontends / Backends / Servers</Card.Title>
        <Card.Text className="text-muted small">
          Refreshes every 5 seconds. Rows are grouped by proxy (FRONTEND on top, BACKEND row at the
          bottom of each group). Per-server actions (Set ready / Drain / Maintenance / Set weight)
          and per-frontend actions (Enable / Disable / Set maxconn) apply via the HAProxy runtime
          stats socket — no reload needed. Hover any row&apos;s name for the per-row HTTP-code +
          queue/connect/response/total time breakdown.
        </Card.Text>
        <StatsTableControls
          scope={scope}
          setScope={setScope}
          hideDown={hideDown}
          setHideDown={setHideDown}
          onExportCsv={() => downloadStatsCsv(data?.stat ?? [])}
          onExportJson={() => downloadStatsJson(data ?? {})}
          onClearCounters={onClearCounters}
          clearCountersBusy={actions.busy === 'clear-counters'}
        />
        <ComprehensiveStatsTable
          rows={data?.stat}
          busyKey={actions.busy}
          onSetState={onSetServerState}
          onSetWeight={onSetServerWeight}
          onEnableFrontend={onEnableFrontend}
          onDisableFrontend={onDisableFrontend}
          onSetMaxconn={onSetMaxconn}
          scope={scope}
          hideDown={hideDown}
        />
      </Card.Body>
    </Card>
  </div>
);

TablesTab.propTypes = {
  data: PropTypes.object,
  actions: PropTypes.object.isRequired,
  scope: PropTypes.string.isRequired,
  setScope: PropTypes.func.isRequired,
  hideDown: PropTypes.bool.isRequired,
  setHideDown: PropTypes.func.isRequired,
  onSetServerState: PropTypes.func.isRequired,
  onSetServerWeight: PropTypes.func.isRequired,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
  onClearCounters: PropTypes.func.isRequired,
};

const TrendsTab = ({ data, theme, frontendHistories, backendHistories, onExpand }) => (
  <div className="d-flex flex-column gap-3">
    <InfoCard info={data?.info} />
    {frontendHistories.length > 0 ? (
      <Card>
        <Card.Body>
          <Card.Title>Frontend traffic</Card.Title>
          <Card.Text className="text-muted small">
            Bytes-per-second sampled every 5 seconds. Click the expand icon on any chart for a
            fullscreen view.
          </Card.Text>
          <Row className="g-3">
            {frontendHistories.map(entry => (
              <Col key={entry.key} md={6}>
                <ChartTile
                  title={entry.label}
                  history={entry.history}
                  theme={theme}
                  onExpand={() => onExpand({ title: entry.label, history: entry.history })}
                />
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>
    ) : null}
    {backendHistories.length > 0 ? (
      <Card>
        <Card.Body>
          <Card.Title>Backend traffic</Card.Title>
          <Row className="g-3">
            {backendHistories.map(entry => (
              <Col key={entry.key} md={6} lg={4}>
                <ChartTile
                  title={entry.label}
                  history={entry.history}
                  theme={theme}
                  onExpand={() => onExpand({ title: entry.label, history: entry.history })}
                />
              </Col>
            ))}
          </Row>
        </Card.Body>
      </Card>
    ) : null}
    {frontendHistories.length > 0 || backendHistories.length > 0 ? (
      <Card>
        <Card.Body>
          <SessionsChart
            histories={[...frontendHistories, ...backendHistories].slice(0, 12)}
            theme={theme}
          />
        </Card.Body>
      </Card>
    ) : null}
  </div>
);

TrendsTab.propTypes = {
  data: PropTypes.object,
  theme: PropTypes.oneOf(['light', 'dark']).isRequired,
  frontendHistories: PropTypes.array.isRequired,
  backendHistories: PropTypes.array.isRequired,
  onExpand: PropTypes.func.isRequired,
};

export const StatsPage = ({ theme = 'light' }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [scope, setScope] = useState('');
  const [hideDown, setHideDown] = useState(false);
  const [activeTab, setActiveTab] = useState('tables');
  const [prompt, setPrompt] = useState(null);
  const [confirmClearCounters, setConfirmClearCounters] = useState(false);
  const stats = useStatsHistory();
  const actions = useActions();

  useEffect(() => {
    let active = true;
    const fetchOnce = () =>
      apiGet('api/stats')
        .then(payload => {
          if (active) {
            setData(payload);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            setError(err);
          }
        });
    fetchOnce();
    const interval = setInterval(fetchOnce, 5_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [actions.lastResult]);

  const handleSetServerState = (row, state) => {
    actions
      .setServerState({ backend: row.pxname, server: row.svname, state })
      .catch(() => undefined);
  };

  const handleSetServerWeight = row => {
    setPrompt({
      kind: 'weight',
      row,
      title: `Set weight for ${row.pxname}/${row.svname}`,
      label: 'Weight (0-256)',
      min: 0,
      max: 256,
      initialValue: Number.parseInt(row.weight, 10) || 100,
      helpText: '0 = drain new connections. Higher weight = more share of the load.',
    });
  };

  const handleSetMaxconn = row => {
    setPrompt({
      kind: 'maxconn',
      row,
      title: `Set maxconn for frontend ${row.pxname}`,
      label: 'Max concurrent connections',
      min: 0,
      initialValue: Number.parseInt(row.smax, 10) || 1000,
      helpText: 'Hard cap on simultaneous connections this frontend will accept. 0 unlimited.',
    });
  };

  const handlePromptSubmit = value => {
    if (!prompt) {
      return;
    }
    const { kind, row } = prompt;
    setPrompt(null);
    if (kind === 'weight') {
      actions
        .setServerWeight({ backend: row.pxname, server: row.svname, weight: value })
        .catch(() => undefined);
    } else if (kind === 'maxconn') {
      actions.setMaxconnFrontend({ name: row.pxname, max: value }).catch(() => undefined);
    }
  };

  const handleEnableFrontend = row => {
    actions.enableFrontend({ name: row.pxname }).catch(() => undefined);
  };

  const handleDisableFrontend = row => {
    actions.disableFrontend({ name: row.pxname }).catch(() => undefined);
  };

  const handleClearCounters = () => {
    setConfirmClearCounters(true);
  };

  const handleConfirmClearCounters = () => {
    setConfirmClearCounters(false);
    actions.clearCounters().catch(() => undefined);
  };

  const frontendHistories = Object.entries(stats.history)
    .filter(([key, history]) => key.endsWith('/FRONTEND') && history.length >= 2)
    .map(([key, history]) => ({ key, label: key.replace('/FRONTEND', ''), history }));
  const backendHistories = Object.entries(stats.history)
    .filter(([key, history]) => key.endsWith('/BACKEND') && history.length >= 2)
    .map(([key, history]) => ({ key, label: key.replace('/BACKEND', ''), history }));

  const sectionsReady =
    data !== null || frontendHistories.length > 0 || backendHistories.length > 0;

  return (
    <div className="d-flex flex-column gap-3 patchpanel-stats-fade">
      {!sectionsReady ? (
        <Card>
          <Card.Body className="d-flex align-items-center gap-3">
            <Spinner animation="border" size="sm" />
            <span className="text-muted">Fetching the recent hour from HAProxy stats sampler…</span>
          </Card.Body>
        </Card>
      ) : null}
      {error ? <Alert variant="danger">Stats unavailable: {error.message}</Alert> : null}
      {actions.error ? (
        <Alert variant="danger" dismissible onClose={() => actions.clear()}>
          Server action failed: {actions.error.message}
        </Alert>
      ) : null}
      {actions.lastResult?.kind &&
      /^(?:server-|weight-|fe-|clear-counters)/u.test(actions.lastResult.kind) ? (
        <Alert variant="success" dismissible onClose={() => actions.clear()}>
          Runtime action applied.
        </Alert>
      ) : null}

      <Tabs
        id="stats-tabs"
        activeKey={activeTab}
        onSelect={k => setActiveTab(k ?? 'tables')}
        className="mb-1"
      >
        <Tab
          eventKey="tables"
          title={
            <span>
              <i className="bi bi-table me-1" />
              Live tables
            </span>
          }
        >
          <div className="pt-3">
            <TablesTab
              data={data}
              actions={actions}
              scope={scope}
              setScope={setScope}
              hideDown={hideDown}
              setHideDown={setHideDown}
              onSetServerState={handleSetServerState}
              onSetServerWeight={handleSetServerWeight}
              onEnableFrontend={handleEnableFrontend}
              onDisableFrontend={handleDisableFrontend}
              onSetMaxconn={handleSetMaxconn}
              onClearCounters={handleClearCounters}
            />
          </div>
        </Tab>
        <Tab
          eventKey="trends"
          title={
            <span>
              <i className="bi bi-graph-up me-1" />
              Trends
            </span>
          }
        >
          <div className="pt-3">
            <TrendsTab
              data={data}
              theme={theme}
              frontendHistories={frontendHistories}
              backendHistories={backendHistories}
              onExpand={setExpanded}
            />
          </div>
        </Tab>
      </Tabs>

      {expanded ? (
        <ExpandedChartModal show title={expanded.title} onClose={() => setExpanded(null)}>
          <TrafficChart
            title={expanded.title}
            history={expanded.history}
            theme={theme}
            height={Math.max(420, Math.round(window.innerHeight * 0.65))}
          />
        </ExpandedChartModal>
      ) : null}
      {prompt ? (
        <NumericPromptModal
          show
          title={prompt.title}
          label={prompt.label}
          min={prompt.min}
          max={prompt.max}
          initialValue={prompt.initialValue}
          helpText={prompt.helpText}
          onSubmit={handlePromptSubmit}
          onCancel={() => setPrompt(null)}
        />
      ) : null}
      {confirmClearCounters ? (
        <ConfirmDialog
          show
          title="Clear all HAProxy counters?"
          body={
            <>
              This runs <code>clear counters all</code> on the runtime socket. Max / total / error
              counters reset to zero across every frontend, backend, and server. Active sessions and
              rates are <strong>not</strong> affected, so traffic keeps flowing.
              <br />
              <br />
              Useful for getting clean numbers after a deploy / load test. The action is logged to
              the audit trail.
            </>
          }
          confirmLabel="Clear counters"
          confirmVariant="warning"
          onConfirm={handleConfirmClearCounters}
          onCancel={() => setConfirmClearCounters(false)}
        />
      ) : null}
    </div>
  );
};

StatsPage.propTypes = {
  theme: PropTypes.oneOf(['light', 'dark']),
};
