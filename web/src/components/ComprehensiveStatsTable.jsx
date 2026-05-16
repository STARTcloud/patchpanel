import PropTypes from 'prop-types';
import { useState } from 'react';
import {
  Badge,
  Button,
  Dropdown,
  Form,
  Modal,
  OverlayTrigger,
  Spinner,
  Table,
  Tooltip,
} from 'react-bootstrap';
import { Link } from 'react-router';

// HAProxy-native-style comprehensive stats table. Groups rows by proxy name
// (pxname), emits the FRONTEND row first, then each individual server, then
// the BACKEND row last — matching the section ordering you'd see at the
// native `:444/` HAProxy stats page. Per-row OverlayTrigger tooltips surface
// the deep numerical breakdowns (HTTP 1xx-5xx, queue/connect/response/total
// time, compression, cache hits, header rewrites, internal errors).

const formatNum = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return value ?? '';
  }
  if (n === 0) {
    return '0';
  }
  return n.toLocaleString();
};

const formatBytes = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) {
    return '0';
  }
  if (n < 1024) {
    return `${n}`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  if (n < 1024 * 1024 * 1024) {
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const STATUS_VARIANTS = Object.freeze({
  UP: 'success',
  DOWN: 'danger',
  OPEN: 'success',
  MAINT: 'warning',
  DRAIN: 'warning',
  NOLB: 'info',
  'no check': 'secondary',
});

const statusVariant = status => {
  if (!status) {
    return 'secondary';
  }
  const [base] = status.split(' ');
  return STATUS_VARIANTS[base] ?? STATUS_VARIANTS[status] ?? 'secondary';
};

const checkBadge = row => {
  if (!row.check_status || row.check_status === 'no check') {
    return null;
  }
  const isOk = row.check_status.startsWith('L');
  const variant = isOk ? 'outline-success' : 'outline-danger';
  const detail = row.check_duration
    ? `${row.check_status} in ${row.check_duration}ms`
    : row.check_status;
  return (
    <Badge
      bg=""
      className={`small text-${variant.replace('outline-', '')} border border-${variant.replace('outline-', '')}`}
    >
      {detail}
    </Badge>
  );
};

const DetailTooltip = ({ row }) => (
  <Tooltip>
    <table className="text-start small">
      <tbody>
        {row.hrsp_1xx !== undefined ? (
          <tr>
            <td className="pe-2">HTTP 1xx:</td>
            <td>{formatNum(row.hrsp_1xx)}</td>
          </tr>
        ) : null}
        {row.hrsp_2xx !== undefined ? (
          <tr>
            <td className="pe-2">HTTP 2xx:</td>
            <td>{formatNum(row.hrsp_2xx)}</td>
          </tr>
        ) : null}
        {row.hrsp_3xx !== undefined ? (
          <tr>
            <td className="pe-2">HTTP 3xx:</td>
            <td>{formatNum(row.hrsp_3xx)}</td>
          </tr>
        ) : null}
        {row.hrsp_4xx !== undefined ? (
          <tr>
            <td className="pe-2">HTTP 4xx:</td>
            <td>{formatNum(row.hrsp_4xx)}</td>
          </tr>
        ) : null}
        {row.hrsp_5xx !== undefined ? (
          <tr>
            <td className="pe-2">HTTP 5xx:</td>
            <td>{formatNum(row.hrsp_5xx)}</td>
          </tr>
        ) : null}
        {row.rtime !== undefined ? (
          <tr>
            <td className="pe-2">rtime (avg):</td>
            <td>{row.rtime} ms</td>
          </tr>
        ) : null}
        {row.rtime_max !== undefined ? (
          <tr>
            <td className="pe-2">rtime (max):</td>
            <td>{row.rtime_max} ms</td>
          </tr>
        ) : null}
        {row.qtime !== undefined ? (
          <tr>
            <td className="pe-2">qtime:</td>
            <td>{row.qtime} ms</td>
          </tr>
        ) : null}
        {row.ctime !== undefined ? (
          <tr>
            <td className="pe-2">ctime:</td>
            <td>{row.ctime} ms</td>
          </tr>
        ) : null}
        {row.ttime !== undefined ? (
          <tr>
            <td className="pe-2">ttime:</td>
            <td>{row.ttime} ms</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  </Tooltip>
);

DetailTooltip.propTypes = {
  row: PropTypes.object.isRequired,
};

// v0.2.39 — FRONTEND/BACKEND rows + the proxy-group separator now use custom
// theme-aware classes defined in styles/app.css. Bootstrap's `table-active`
// and `table-secondary` don't pop enough in either theme; the custom classes
// add accent-colored left borders + tinted backgrounds so the row hierarchy
// (group separator → frontend → servers → backend) is legible at a glance.
const ROW_VARIANTS = Object.freeze({
  FRONTEND: 'patchpanel-stats-frontend-row',
  BACKEND: 'patchpanel-stats-backend-row',
});

const statusRowClass = status => {
  if (!status) {
    return null;
  }
  if (status.startsWith('DOWN')) {
    return 'patchpanel-stats-row-down';
  }
  if (status.startsWith('MAINT')) {
    return 'patchpanel-stats-row-maint';
  }
  if (status.startsWith('DRAIN')) {
    return 'patchpanel-stats-row-drain';
  }
  return null;
};

const FrontendActions = ({ row, busyKey, onEnableFrontend, onDisableFrontend, onSetMaxconn }) => {
  const busy =
    busyKey === `fe-enable-${row.pxname}` ||
    busyKey === `fe-disable-${row.pxname}` ||
    busyKey === `fe-maxconn-${row.pxname}`;
  if (busy) {
    return <Spinner as="span" animation="border" size="sm" />;
  }
  return (
    <Dropdown>
      <Dropdown.Toggle variant="outline-secondary" size="sm" id={`fe-${row.pxname}-actions`}>
        Action
      </Dropdown.Toggle>
      <Dropdown.Menu align="end">
        <Dropdown.Header>Frontend state</Dropdown.Header>
        <Dropdown.Item onClick={() => onEnableFrontend(row)}>
          <i className="bi bi-play-circle text-success me-2" />
          Enable
        </Dropdown.Item>
        <Dropdown.Item onClick={() => onDisableFrontend(row)}>
          <i className="bi bi-pause-circle text-warning me-2" />
          Disable
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => onSetMaxconn(row)}>
          <i className="bi bi-arrows-collapse text-primary me-2" />
          Set maxconn…
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

FrontendActions.propTypes = {
  row: PropTypes.object.isRequired,
  busyKey: PropTypes.string,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
};

const ServerActions = ({ row, busyKey, onSetState, onSetWeight }) => {
  const busy =
    busyKey === `server-${row.pxname}-${row.svname}` ||
    busyKey === `weight-${row.pxname}-${row.svname}`;
  if (busy) {
    return <Spinner as="span" animation="border" size="sm" />;
  }
  return (
    <Dropdown>
      <Dropdown.Toggle
        variant="outline-secondary"
        size="sm"
        id={`stats-${row.pxname}-${row.svname}-actions`}
      >
        Action
      </Dropdown.Toggle>
      <Dropdown.Menu align="end">
        <Dropdown.Header>Runtime state</Dropdown.Header>
        <Dropdown.Item onClick={() => onSetState(row, 'ready')}>
          <i className="bi bi-play-circle text-success me-2" />
          Set ready
        </Dropdown.Item>
        <Dropdown.Item onClick={() => onSetState(row, 'drain')}>
          <i className="bi bi-droplet-half text-warning me-2" />
          Drain
        </Dropdown.Item>
        <Dropdown.Item onClick={() => onSetState(row, 'maint')}>
          <i className="bi bi-tools text-danger me-2" />
          Maintenance
        </Dropdown.Item>
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => onSetWeight(row)}>
          <i className="bi bi-sliders text-primary me-2" />
          Set weight…
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

ServerActions.propTypes = {
  row: PropTypes.object.isRequired,
  busyKey: PropTypes.string,
  onSetState: PropTypes.func.isRequired,
  onSetWeight: PropTypes.func.isRequired,
};

const RowActions = ({
  row,
  busyKey,
  onSetState,
  onSetWeight,
  onEnableFrontend,
  onDisableFrontend,
  onSetMaxconn,
}) => {
  if (row.svname === 'BACKEND') {
    return <span className="text-muted small">—</span>;
  }
  if (row.svname === 'FRONTEND') {
    return (
      <FrontendActions
        row={row}
        busyKey={busyKey}
        onEnableFrontend={onEnableFrontend}
        onDisableFrontend={onDisableFrontend}
        onSetMaxconn={onSetMaxconn}
      />
    );
  }
  return (
    <ServerActions row={row} busyKey={busyKey} onSetState={onSetState} onSetWeight={onSetWeight} />
  );
};

RowActions.propTypes = {
  row: PropTypes.object.isRequired,
  busyKey: PropTypes.string,
  onSetState: PropTypes.func.isRequired,
  onSetWeight: PropTypes.func.isRequired,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
};

export const NumericPromptModal = ({
  show,
  title,
  label,
  min,
  max,
  initialValue,
  helpText,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(String(initialValue ?? ''));
  const numeric = Number.parseInt(value, 10);
  const valid =
    Number.isInteger(numeric) && numeric >= min && (typeof max !== 'number' || numeric <= max);
  return (
    <Modal show={show} onHide={onCancel} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group>
          <Form.Label>{label}</Form.Label>
          <Form.Control
            type="number"
            value={value}
            min={min}
            max={max}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && valid) {
                onSubmit(numeric);
              }
            }}
            isInvalid={value !== '' ? !valid : null}
          />
          {helpText ? <Form.Text className="text-muted">{helpText}</Form.Text> : null}
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSubmit(numeric)} disabled={!valid}>
          Apply
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

NumericPromptModal.propTypes = {
  show: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number,
  initialValue: PropTypes.number,
  helpText: PropTypes.node,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

const StatRow = ({
  row,
  busyKey,
  onSetState,
  onSetWeight,
  onEnableFrontend,
  onDisableFrontend,
  onSetMaxconn,
}) => {
  const cls = [ROW_VARIANTS[row.svname], statusRowClass(row.status)].filter(Boolean).join(' ');
  return (
    <tr className={cls || undefined}>
      <td className="text-nowrap">
        <OverlayTrigger placement="right" overlay={<DetailTooltip row={row} />}>
          <code className="small">{row.svname}</code>
        </OverlayTrigger>
      </td>
      <td>
        <Badge bg={statusVariant(row.status)}>{row.status ?? '?'}</Badge>
        {row.check_status ? <div className="mt-1">{checkBadge(row)}</div> : null}
      </td>
      <td className="text-end">{formatNum(row.scur)}</td>
      <td className="text-end text-muted">{formatNum(row.smax)}</td>
      <td className="text-end text-muted">{formatNum(row.stot)}</td>
      <td className="text-end">{formatNum(row.rate)}</td>
      <td className="text-end text-muted">{formatNum(row.rate_max)}</td>
      <td className="text-end">{formatBytes(row.bin)}</td>
      <td className="text-end">{formatBytes(row.bout)}</td>
      <td className="text-end">{formatNum(row.ereq)}</td>
      <td className="text-end">{formatNum(row.econ)}</td>
      <td className="text-end">{formatNum(row.eresp)}</td>
      <td className="text-end">{formatNum(row.wretr)}</td>
      <td className="text-end">{formatNum(row.wredis)}</td>
      <td className="text-end">{formatNum(row.chkfail)}</td>
      <td className="text-end text-nowrap">
        {row.weight !== undefined ? `${row.weight}` : '—'}
        {row.bck === '1' ? (
          <Badge bg="secondary" className="ms-1">
            B
          </Badge>
        ) : null}
      </td>
      <td className="text-end">
        <RowActions
          row={row}
          busyKey={busyKey}
          onSetState={onSetState}
          onSetWeight={onSetWeight}
          onEnableFrontend={onEnableFrontend}
          onDisableFrontend={onDisableFrontend}
          onSetMaxconn={onSetMaxconn}
        />
      </td>
    </tr>
  );
};

StatRow.propTypes = {
  row: PropTypes.object.isRequired,
  busyKey: PropTypes.string,
  onSetState: PropTypes.func.isRequired,
  onSetWeight: PropTypes.func.isRequired,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
};

const groupByProxy = rows => {
  const byProxy = new Map();
  for (const row of rows) {
    if (!row.pxname) {
      continue;
    }
    if (!byProxy.has(row.pxname)) {
      byProxy.set(row.pxname, { pxname: row.pxname, frontend: null, servers: [], backend: null });
    }
    const group = byProxy.get(row.pxname);
    if (row.svname === 'FRONTEND') {
      group.frontend = row;
    } else if (row.svname === 'BACKEND') {
      group.backend = row;
    } else {
      group.servers.push(row);
    }
  }
  return [...byProxy.values()];
};

const filterRow = (row, scope, hideDown) => {
  if (hideDown && row.status && row.status.startsWith('DOWN')) {
    return false;
  }
  if (!scope) {
    return true;
  }
  const needle = scope.toLowerCase();
  return (
    (row.pxname ?? '').toLowerCase().includes(needle) ||
    (row.svname ?? '').toLowerCase().includes(needle) ||
    (row.status ?? '').toLowerCase().includes(needle)
  );
};

const ProxyGroup = ({
  group,
  busyKey,
  onSetState,
  onSetWeight,
  onEnableFrontend,
  onDisableFrontend,
  onSetMaxconn,
}) => {
  const allRows = [
    ...(group.frontend ? [group.frontend] : []),
    ...group.servers,
    ...(group.backend ? [group.backend] : []),
  ];
  if (allRows.length === 0) {
    return null;
  }
  return (
    <>
      <tr className="patchpanel-stats-group-row">
        <td colSpan={17} className="fw-bold">
          <Link
            to={`/backends?focus=${encodeURIComponent(group.pxname)}`}
            title="Jump to the Backends tab focused on this proxy"
            className="text-decoration-none"
          >
            <i className="bi bi-hdd-network me-2" />
            <code>{group.pxname}</code>
            <i className="bi bi-arrow-up-right-square ms-2 small text-muted" />
          </Link>
        </td>
      </tr>
      {allRows.map(row => (
        <StatRow
          key={`${row.pxname}-${row.svname}`}
          row={row}
          busyKey={busyKey}
          onSetState={onSetState}
          onSetWeight={onSetWeight}
          onEnableFrontend={onEnableFrontend}
          onDisableFrontend={onDisableFrontend}
          onSetMaxconn={onSetMaxconn}
        />
      ))}
    </>
  );
};

ProxyGroup.propTypes = {
  group: PropTypes.shape({
    pxname: PropTypes.string.isRequired,
    frontend: PropTypes.object,
    servers: PropTypes.array.isRequired,
    backend: PropTypes.object,
  }).isRequired,
  busyKey: PropTypes.string,
  onSetState: PropTypes.func.isRequired,
  onSetWeight: PropTypes.func.isRequired,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
};

export const ComprehensiveStatsTable = ({
  rows,
  busyKey,
  onSetState,
  onSetWeight,
  onEnableFrontend,
  onDisableFrontend,
  onSetMaxconn,
  scope,
  hideDown,
}) => {
  if (!rows || rows.length === 0) {
    return <p className="text-muted small mb-0">No stats rows yet.</p>;
  }
  const filtered = rows.filter(r => filterRow(r, scope, hideDown));
  const groups = groupByProxy(filtered);
  if (groups.length === 0) {
    return <p className="text-muted small mb-0">No rows match the current filter.</p>;
  }
  return (
    <Table striped bordered hover responsive size="sm" className="small">
      <thead>
        <tr>
          <th rowSpan={2}>Name</th>
          <th rowSpan={2}>Status</th>
          <th colSpan={3} className="text-center">
            Sessions
          </th>
          <th colSpan={2} className="text-center">
            Session rate
          </th>
          <th colSpan={2} className="text-center">
            Bytes
          </th>
          <th colSpan={3} className="text-center">
            Errors
          </th>
          <th colSpan={2} className="text-center">
            Warnings
          </th>
          <th rowSpan={2}>Chk fail</th>
          <th rowSpan={2}>Wght</th>
          <th rowSpan={2} className="text-end">
            Actions
          </th>
        </tr>
        <tr>
          <th className="text-end">Cur</th>
          <th className="text-end">Max</th>
          <th className="text-end">Total</th>
          <th className="text-end">Cur</th>
          <th className="text-end">Max</th>
          <th className="text-end">In</th>
          <th className="text-end">Out</th>
          <th className="text-end">Req</th>
          <th className="text-end">Conn</th>
          <th className="text-end">Resp</th>
          <th className="text-end">Retr</th>
          <th className="text-end">Redis</th>
        </tr>
      </thead>
      <tbody>
        {groups.map(group => (
          <ProxyGroup
            key={group.pxname}
            group={group}
            busyKey={busyKey}
            onSetState={onSetState}
            onSetWeight={onSetWeight}
            onEnableFrontend={onEnableFrontend}
            onDisableFrontend={onDisableFrontend}
            onSetMaxconn={onSetMaxconn}
          />
        ))}
      </tbody>
    </Table>
  );
};

ComprehensiveStatsTable.propTypes = {
  rows: PropTypes.array,
  busyKey: PropTypes.string,
  onSetState: PropTypes.func.isRequired,
  onSetWeight: PropTypes.func.isRequired,
  onEnableFrontend: PropTypes.func.isRequired,
  onDisableFrontend: PropTypes.func.isRequired,
  onSetMaxconn: PropTypes.func.isRequired,
  scope: PropTypes.string,
  hideDown: PropTypes.bool,
};
