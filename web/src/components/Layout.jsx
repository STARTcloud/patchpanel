import PropTypes from 'prop-types';
import { Badge, Button, Container, Nav, Navbar, NavDropdown, Spinner } from 'react-bootstrap';
import { NavLink, Outlet } from 'react-router';

import { useActions } from '../hooks/useActions.jsx';
import { useConfirmation } from '../hooks/useConfirmation.jsx';
import { useHaproxyLive } from '../hooks/useHaproxyLive.jsx';

import { ErrorBoundary } from './ErrorBoundary.jsx';
import { HaproxyStatusBadge } from './HaproxyStatusBadge.jsx';

// HAProxy-flow ordered primary tabs. Dashboard is reachable via the brand
// link on the far left (the patchpanel logo + wordmark). General is a
// dropdown with sub-pages for the singleton `global` block and the named
// `defaults` blocks.
const GENERAL_SUBTABS = Object.freeze([
  { path: '/global', label: 'Global', icon: 'cpu' },
  { path: '/defaults', label: 'Defaults', icon: 'gear-wide-connected' },
]);

const PRIMARY_TABS = Object.freeze([
  { path: '/certificates', label: 'Certs', icon: 'shield-lock' },
  { path: '/frontends', label: 'Frontends', icon: 'box-arrow-in-down' },
  { path: '/acls', label: 'ACLs', icon: 'funnel' },
  { path: '/rules', label: 'Rules', icon: 'list-check' },
  { path: '/routes', label: 'Routes', icon: 'signpost-2' },
  { path: '/backends', label: 'Backends', icon: 'hdd-network' },
]);

// Read-only / observability surfaces — grouped behind a dropdown so the navbar
// doesn't grow eighteen entries wide.
const MONITOR_TABS = Object.freeze([
  { path: '/stats', label: 'Stats', icon: 'graph-up' },
  { path: '/topology', label: 'Topology', icon: 'bezier2' },
  { path: '/logs', label: 'Logs', icon: 'terminal' },
  { path: '/runtime', label: 'Runtime', icon: 'lightning-charge' },
  { path: '/audit', label: 'Audit', icon: 'journal-text' },
  { path: '/snapshots', label: 'Snapshots', icon: 'clock-history' },
  { path: '/notifications', label: 'Notifications', icon: 'bell' },
  { path: '/rendered-cfg', label: 'Rendered cfg', icon: 'file-code' },
]);

// Settings surfaces — same dropdown treatment.
// `freshOnly` entries are filtered out once the install is no longer fresh
// (Setup wizard isn't meant to be a re-accessible menu post-onboarding).
const SETTINGS_TABS = Object.freeze([
  { path: '/setup', label: 'Setup wizard', icon: 'stars', freshOnly: true },
  { path: '/providers', label: 'Providers', icon: 'diagram-3' },
  { path: '/error-pages', label: 'Error pages', icon: 'exclamation-octagon' },
  { path: '/geoip', label: 'GeoIP', icon: 'globe-americas' },
  { path: '/advanced', label: 'Advanced', icon: 'sliders' },
  { path: '/raw-state', label: 'Raw State', icon: 'code' },
]);

const THEME_ICONS = Object.freeze({
  auto: 'circle-half',
  light: 'sun',
  dark: 'moon-stars',
});

const themeLabel = (preference, effective) =>
  preference === 'auto' ? `Theme: Auto (${effective})` : `Theme: ${preference}`;

const PrimaryNavLink = ({ tab }) => (
  <Nav.Link as={NavLink} to={tab.path} end={tab.end} className="d-flex align-items-center gap-1">
    <i className={`bi bi-${tab.icon}`} />
    <span>{tab.label}</span>
  </Nav.Link>
);

PrimaryNavLink.propTypes = {
  tab: PropTypes.shape({
    path: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.string.isRequired,
    end: PropTypes.bool,
  }).isRequired,
};

const DropdownNavItem = ({ tab }) => (
  <NavDropdown.Item as={NavLink} to={tab.path} className="d-flex align-items-center gap-2">
    <i className={`bi bi-${tab.icon}`} />
    <span>{tab.label}</span>
  </NavDropdown.Item>
);

DropdownNavItem.propTypes = {
  tab: PropTypes.shape({
    path: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.string.isRequired,
  }).isRequired,
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
        : 'Restart available via the Start menu item.'}
    </p>
  </>
);

const PowerMenuItem = ({ icon, label, busyLabel, busy, disabled, danger, onSelect, title }) => (
  <NavDropdown.Item
    onClick={onSelect}
    disabled={disabled || busy}
    title={title}
    className={`d-flex align-items-center gap-2 ${danger ? 'text-danger' : ''}`}
  >
    {busy ? (
      <>
        <Spinner as="span" animation="border" size="sm" /> <span>{busyLabel}</span>
      </>
    ) : (
      <>
        <i className={`bi bi-${icon}`} />
        <span>{label}</span>
      </>
    )}
  </NavDropdown.Item>
);

PowerMenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  busyLabel: PropTypes.string.isRequired,
  busy: PropTypes.bool.isRequired,
  disabled: PropTypes.bool,
  danger: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  title: PropTypes.string,
};

const HaproxyPowerControl = () => {
  const actions = useActions();
  const { alive, strategy, refresh } = useHaproxyLive();
  const { confirm, ConfirmationDialog } = useConfirmation();

  const isRunning = alive === true;
  const isStopped = alive === false;
  const directStart = strategy === 'direct';
  const wrap = promise => promise.catch(() => undefined).finally(refresh);

  const handleReload = () => wrap(actions.reloadHaproxy());
  const handleStart = () => wrap(actions.startHaproxy());
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

  const toggle = (
    <span className="d-inline-flex align-items-center gap-2">
      <i className="bi bi-power" />
      <span className="d-none d-md-inline">HAProxy</span>
      <HaproxyStatusBadge alive={alive} />
    </span>
  );

  return (
    <>
      <NavDropdown
        id="haproxy-power-dropdown"
        title={toggle}
        align="end"
        menuVariant="dark"
        aria-label="HAProxy power control"
      >
        <PowerMenuItem
          icon="arrow-clockwise"
          label="Reload"
          busyLabel="Reloading…"
          busy={actions.busy === 'reload'}
          disabled={!isRunning}
          onSelect={handleReload}
          title="Zero-downtime reload via the master socket. Does NOT re-render the cfg from state."
        />
        <PowerMenuItem
          icon="stop-circle"
          label="Stop"
          busyLabel="Stopping…"
          busy={actions.busy === 'stop'}
          disabled={!isRunning}
          danger
          onSelect={handleStop}
          title="Stop the HAProxy process. All connections dropped. Requires confirmation."
        />
        <PowerMenuItem
          icon="play-circle"
          label="Start"
          busyLabel="Starting…"
          busy={actions.busy === 'start'}
          disabled={!isStopped || directStart}
          onSelect={handleStart}
          title={
            directStart
              ? 'Direct strategy cannot start HAProxy — no supervisor configured.'
              : 'Start the HAProxy process via the configured supervisor.'
          }
        />
        <NavDropdown.Divider />
        <NavDropdown.ItemText className="small text-muted">
          Strategy: <code>{strategy ?? 'detecting…'}</code>
        </NavDropdown.ItemText>
      </NavDropdown>
      <ConfirmationDialog />
    </>
  );
};

const PendingChangesIndicator = ({ pending, onApply, onDiscard, applying, error }) => {
  if (!pending) {
    return null;
  }
  const title = error
    ? `Apply failed: ${error.message}`
    : `${pending.label} — click Apply to validate + reload HAProxy, or Discard to revert.`;
  return (
    <div className="d-flex align-items-center gap-2">
      <Badge bg={error ? 'danger' : 'warning'} text="dark" title={title}>
        <i className="bi bi-exclamation-circle me-1" />
        Unsaved: {pending.label}
      </Badge>
      <Button
        variant={error ? 'outline-danger' : 'warning'}
        size="sm"
        onClick={onApply}
        disabled={applying}
        title={title}
      >
        {applying ? (
          <Spinner as="span" animation="border" size="sm" />
        ) : (
          <>
            <i className="bi bi-check-lg me-1" />
            Apply
          </>
        )}
      </Button>
      <Button variant="outline-secondary" size="sm" onClick={onDiscard} disabled={applying}>
        Discard
      </Button>
    </div>
  );
};

PendingChangesIndicator.propTypes = {
  pending: PropTypes.shape({
    label: PropTypes.string.isRequired,
    doc: PropTypes.object.isRequired,
  }),
  onApply: PropTypes.func.isRequired,
  onDiscard: PropTypes.func.isRequired,
  applying: PropTypes.bool.isRequired,
  error: PropTypes.object,
};

const filterSettingsTabs = (tabs, showSetupTab) => tabs.filter(t => !t.freshOnly || showSetupTab);

export const Layout = ({
  status = null,
  themePreference = 'auto',
  themeEffective = 'light',
  onCycleTheme = null,
  pending = null,
  applyingPending = false,
  applyError = null,
  onApplyPending = null,
  onDiscardPending = null,
  showSetupTab = false,
}) => (
  <div className="haproxy-ui">
    <Navbar bg="dark" variant="dark" expand="lg" className="px-3">
      <Navbar.Brand
        as={NavLink}
        to="/"
        end
        className="d-flex align-items-center gap-2 text-decoration-none"
        title="Dashboard"
      >
        <i className="bi bi-shield-lock" aria-hidden="true" />
        <span>patchpanel</span>
      </Navbar.Brand>
      <Navbar.Toggle aria-controls="primary-nav" />
      <Navbar.Collapse id="primary-nav">
        <Nav className="me-auto">
          <NavDropdown
            id="general-dropdown"
            title={
              <span className="d-inline-flex align-items-center gap-1">
                <i className="bi bi-sliders2" />
                <span>General</span>
              </span>
            }
          >
            {GENERAL_SUBTABS.map(tab => (
              <DropdownNavItem key={tab.path} tab={tab} />
            ))}
          </NavDropdown>
          {PRIMARY_TABS.map(tab => (
            <PrimaryNavLink key={tab.path} tab={tab} />
          ))}
          <NavDropdown
            id="monitor-dropdown"
            title={
              <span className="d-inline-flex align-items-center gap-1">
                <i className="bi bi-eye" />
                <span>Monitor</span>
              </span>
            }
          >
            {MONITOR_TABS.map(tab => (
              <DropdownNavItem key={tab.path} tab={tab} />
            ))}
          </NavDropdown>
          <NavDropdown
            id="settings-dropdown"
            title={
              <span className="d-inline-flex align-items-center gap-1">
                <i className="bi bi-gear" />
                <span>Settings</span>
              </span>
            }
          >
            {filterSettingsTabs(SETTINGS_TABS, showSetupTab).map(tab => (
              <DropdownNavItem key={tab.path} tab={tab} />
            ))}
          </NavDropdown>
        </Nav>
        <div className="d-flex align-items-center gap-3">
          {status ? <span className="navbar-text text-light">{status}</span> : null}
          {pending && onApplyPending && onDiscardPending ? (
            <PendingChangesIndicator
              pending={pending}
              onApply={onApplyPending}
              onDiscard={onDiscardPending}
              applying={applyingPending}
              error={applyError}
            />
          ) : null}
          <ErrorBoundary>
            <HaproxyPowerControl />
          </ErrorBoundary>
          {onCycleTheme ? (
            <Button
              variant="outline-light"
              size="sm"
              onClick={onCycleTheme}
              title={themeLabel(themePreference, themeEffective)}
              aria-label={themeLabel(themePreference, themeEffective)}
            >
              <i className={`bi bi-${THEME_ICONS[themePreference] ?? 'circle-half'}`} />
            </Button>
          ) : null}
        </div>
      </Navbar.Collapse>
    </Navbar>
    <Container fluid className="py-3">
      <Outlet />
    </Container>
  </div>
);

Layout.propTypes = {
  status: PropTypes.string,
  themePreference: PropTypes.oneOf(['auto', 'light', 'dark']),
  themeEffective: PropTypes.oneOf(['light', 'dark']),
  onCycleTheme: PropTypes.func,
  pending: PropTypes.shape({
    label: PropTypes.string.isRequired,
    doc: PropTypes.object.isRequired,
  }),
  applyingPending: PropTypes.bool,
  applyError: PropTypes.object,
  onApplyPending: PropTypes.func,
  onDiscardPending: PropTypes.func,
  showSetupTab: PropTypes.bool,
};
