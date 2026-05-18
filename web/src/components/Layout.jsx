import PropTypes from 'prop-types';
import { Badge, Button, Container, Nav, Navbar, NavDropdown, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { useActions } from '../hooks/useActions.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirmation } from '../hooks/useConfirmation.jsx';
import { useHaproxyLive } from '../hooks/useHaproxyLive.jsx';

import { ErrorBoundary } from './ErrorBoundary.jsx';
import { HaproxyStatusBadge } from './HaproxyStatusBadge.jsx';
import { KeepalivedPowerControl } from './KeepalivedPowerControl.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';
import { LogoMark } from './LogoMark.jsx';

// HAProxy-flow ordered primary tabs. Dashboard is reachable via the brand
// link on the far left (the patchpanel logo + wordmark). General is a
// dropdown with sub-pages for the singleton `global` block and the named
// `defaults` blocks.
const GENERAL_SUBTABS = Object.freeze([
  { key: 'global', path: '/global', label: 'Global', icon: 'cpu' },
  { key: 'defaults', path: '/defaults', label: 'Defaults', icon: 'gear-wide-connected' },
]);

const PRIMARY_TABS = Object.freeze([
  { key: 'certificates', path: '/certificates', label: 'Certs', icon: 'shield-lock' },
  { key: 'frontends', path: '/frontends', label: 'Frontends', icon: 'box-arrow-in-down' },
  { key: 'acls', path: '/acls', label: 'ACLs', icon: 'funnel' },
  { key: 'rules', path: '/rules', label: 'Rules', icon: 'list-check' },
  { key: 'routes', path: '/routes', label: 'Routes', icon: 'signpost-2' },
  { key: 'backends', path: '/backends', label: 'Backends', icon: 'hdd-network' },
]);

// Read-only / observability surfaces — grouped behind a dropdown so the navbar
// doesn't grow eighteen entries wide.
const MONITOR_TABS = Object.freeze([
  { key: 'stats', path: '/stats', label: 'Stats', icon: 'graph-up' },
  { key: 'topology', path: '/topology', label: 'Topology', icon: 'bezier2' },
  { key: 'logs', path: '/logs', label: 'Logs', icon: 'terminal' },
  { key: 'runtime', path: '/runtime', label: 'Runtime', icon: 'lightning-charge' },
  { key: 'audit', path: '/audit', label: 'Audit', icon: 'journal-text' },
  { key: 'snapshots', path: '/snapshots', label: 'Snapshots', icon: 'clock-history' },
  { key: 'notifications', path: '/notifications', label: 'Notifications', icon: 'bell' },
  { key: 'apiDocs', path: '/api-docs', label: 'API docs', icon: 'braces' },
]);

// Settings surfaces — same dropdown treatment.
// `freshOnly` entries are filtered out once the install is no longer fresh
// (Setup wizard isn't meant to be a re-accessible menu post-onboarding).
const SETTINGS_TABS = Object.freeze([
  { key: 'settings', path: '/config', label: 'Settings', icon: 'gear-fill' },
  { key: 'providers', path: '/providers', label: 'Providers', icon: 'diagram-3' },
  { key: 'errorPages', path: '/error-pages', label: 'Error pages', icon: 'exclamation-octagon' },
  { key: 'geoip', path: '/geoip', label: 'GeoIP', icon: 'globe-americas' },
  { key: 'ha', path: '/ha', label: 'HA / Failover', icon: 'broadcast-pin' },
  {
    key: 'renderedCfg',
    path: '/rendered-cfg',
    label: 'Rendered haproxy.cfg',
    icon: 'file-code',
  },
  {
    key: 'renderedKeepalived',
    path: '/rendered-keepalived-cfg',
    label: 'Rendered keepalived.conf',
    icon: 'file-code',
  },
  { key: 'advanced', path: '/advanced', label: 'Advanced', icon: 'sliders' },
  { key: 'rawState', path: '/raw-state', label: 'Raw State', icon: 'code' },
]);

const THEME_ICONS = Object.freeze({
  auto: 'circle-half',
  light: 'sun',
  dark: 'moon-stars',
});

const themeLabel = (preference, effective, t) =>
  preference === 'auto'
    ? t('common:theme.auto', 'Theme: Auto ({{effective}})', { effective })
    : t('common:theme.fixed', 'Theme: {{preference}}', { preference });

const PrimaryNavLink = ({ tab }) => {
  const { t } = useTranslation(['common']);
  return (
    <Nav.Link as={NavLink} to={tab.path} end={tab.end} className="d-flex align-items-center gap-1">
      <i className={`bi bi-${tab.icon}`} />
      <span>{t(`common:nav.${tab.key}`, tab.label)}</span>
    </Nav.Link>
  );
};

PrimaryNavLink.propTypes = {
  tab: PropTypes.shape({
    key: PropTypes.string.isRequired,
    path: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.string.isRequired,
    end: PropTypes.bool,
  }).isRequired,
};

const DropdownNavItem = ({ tab }) => {
  const { t } = useTranslation(['common']);
  return (
    <NavDropdown.Item as={NavLink} to={tab.path} className="d-flex align-items-center gap-2">
      <i className={`bi bi-${tab.icon}`} />
      <span>{t(`common:nav.${tab.key}`, tab.label)}</span>
    </NavDropdown.Item>
  );
};

DropdownNavItem.propTypes = {
  tab: PropTypes.shape({
    key: PropTypes.string.isRequired,
    path: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    icon: PropTypes.string.isRequired,
  }).isRequired,
};

const StopConfirmBody = ({ strategy }) => {
  const { t } = useTranslation(['common']);
  return (
    <>
      <p className="mb-2">
        {t(
          'common:haproxyPower.stopBody',
          'This will stop the HAProxy process. All proxied connections will be dropped immediately and the proxy will be unreachable until you start it again.'
        )}
      </p>
      <p className="mb-0 small text-muted">
        {t('common:haproxyPower.strategy', 'Strategy:')}{' '}
        <code>{strategy ?? t('common:status.unknown', 'unknown')}</code>.{' '}
        {strategy === 'direct'
          ? t(
              'common:haproxyPower.directNote',
              'Direct mode has no supervisor — patchpanel cannot restart HAProxy from the UI.'
            )
          : t('common:haproxyPower.restartNote', 'Restart available via the Start menu item.')}
      </p>
    </>
  );
};

StopConfirmBody.propTypes = {
  strategy: PropTypes.string,
};

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

// Tooltip on the toggle shows the resolved strategy so it's still discoverable
// without taking nav space. Dropdown only shows the actions that make sense
// for the current state — Reload + Stop when running, Start when stopped,
// nothing actionable when checking. Avoids the prior "all three buttons,
// most disabled" look.
const aliveLabel = (alive, t) => {
  if (alive === null) {
    return t('common:haproxyPower.checking', 'checking…');
  }
  return alive
    ? t('common:haproxyPower.running', 'running')
    : t('common:haproxyPower.stopped', 'stopped');
};

const toggleTitle = (alive, strategy, t) => {
  const stratLabel = strategy
    ? t('common:haproxyPower.strategySuffix', ' · strategy: {{strategy}}', { strategy })
    : '';
  return t('common:haproxyPower.toggleTitle', 'HAProxy {{state}}{{strategyPart}}', {
    state: aliveLabel(alive, t),
    strategyPart: stratLabel,
  });
};

const HaproxyPowerControl = () => {
  const { t } = useTranslation(['common']);
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
      title: t('common:haproxyPower.stopTitle', 'Stop HAProxy?'),
      body: <StopConfirmBody strategy={strategy} />,
      confirmLabel: t('common:haproxyPower.stopHaproxy', 'Stop HAProxy'),
      confirmVariant: 'danger',
    });
    if (ok) {
      wrap(actions.stopHaproxy());
    }
  };

  const toggle = <HaproxyStatusBadge alive={alive} title={toggleTitle(alive, strategy, t)} />;

  return (
    <>
      <NavDropdown
        id="haproxy-power-dropdown"
        title={toggle}
        align="end"
        menuVariant="dark"
        aria-label={toggleTitle(alive, strategy, t)}
      >
        {isRunning ? (
          <>
            <PowerMenuItem
              icon="arrow-clockwise"
              label={t('common:buttons.reload', 'Reload')}
              busyLabel={t('common:haproxyPower.reloading', 'Reloading…')}
              busy={actions.busy === 'reload'}
              onSelect={handleReload}
              title={t(
                'common:haproxyPower.reloadTitle',
                'Zero-downtime reload via the master socket. Does NOT re-render the cfg from state.'
              )}
            />
            <PowerMenuItem
              icon="stop-circle"
              label={t('common:buttons.stop', 'Stop')}
              busyLabel={t('common:haproxyPower.stopping', 'Stopping…')}
              busy={actions.busy === 'stop'}
              danger
              onSelect={handleStop}
              title={t(
                'common:haproxyPower.stopTooltip',
                'Stop the HAProxy process. All connections dropped. Requires confirmation.'
              )}
            />
          </>
        ) : null}
        {isStopped ? (
          <PowerMenuItem
            icon="play-circle"
            label={t('common:buttons.start', 'Start')}
            busyLabel={t('common:haproxyPower.starting', 'Starting…')}
            busy={actions.busy === 'start'}
            disabled={directStart}
            onSelect={handleStart}
            title={
              directStart
                ? t(
                    'common:haproxyPower.directStartTitle',
                    'Direct strategy cannot start HAProxy — no supervisor configured.'
                  )
                : t(
                    'common:haproxyPower.startTitle',
                    'Start the HAProxy process via the configured supervisor.'
                  )
            }
          />
        ) : null}
        {alive === null ? (
          <NavDropdown.ItemText className="small text-muted">
            <Spinner as="span" animation="border" size="sm" className="me-2" />{' '}
            {t('common:haproxyPower.checking', 'checking…')}
          </NavDropdown.ItemText>
        ) : null}
        <NavDropdown.Divider />
        <NavDropdown.ItemText className="small text-muted">
          {t('common:haproxyPower.version', 'patchpanel v{{version}}', {
            version: __APP_VERSION__,
          })}
        </NavDropdown.ItemText>
      </NavDropdown>
      <ConfirmationDialog />
    </>
  );
};

const PendingChangesIndicator = ({ pending, onApply, onDiscard, applying, error }) => {
  const { t } = useTranslation(['common']);
  if (!pending) {
    return null;
  }
  const title = error
    ? t('common:pending.applyFailed', 'Apply failed: {{message}}', { message: error.message })
    : t(
        'common:pending.title',
        '{{label}} — click Apply to validate + reload HAProxy, or Discard to revert.',
        { label: pending.label }
      );
  return (
    <div className="d-flex align-items-center gap-2">
      <Badge bg={error ? 'danger' : 'warning'} text="dark" title={title}>
        <i className="bi bi-exclamation-circle me-1" />
        {t('common:pending.badge', 'Unsaved: {{label}}', { label: pending.label })}
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
            {t('common:buttons.apply', 'Apply')}
          </>
        )}
      </Button>
      <Button variant="outline-secondary" size="sm" onClick={onDiscard} disabled={applying}>
        {t('common:pending.discard', 'Discard')}
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

// Profile/logout menu in the top-right. Hidden entirely when running under
// HA ingress — the user is authenticated upstream by Home Assistant and
// has no local session to manage from this UI.
const UserMenu = () => {
  const { t } = useTranslation(['common']);
  const auth = useAuth();
  const navigate = useNavigate();

  if (!auth.user || auth.source === 'ingress') {
    return null;
  }

  const handleLogout = async () => {
    await auth.logout();
    navigate('/login', { replace: true });
  };

  return (
    <NavDropdown
      id="user-menu-dropdown"
      align="end"
      menuVariant="dark"
      title={
        <span className="d-inline-flex align-items-center gap-1 text-light">
          <i className="bi bi-person-circle" />
          <span>{auth.user.username}</span>
        </span>
      }
    >
      <NavDropdown.Item
        onClick={() => navigate('/profile')}
        className="d-flex align-items-center gap-2"
      >
        <i className="bi bi-person-gear" />
        <span>{t('common:userMenu.profile', 'Profile & API tokens')}</span>
      </NavDropdown.Item>
      <NavDropdown.Divider />
      <NavDropdown.Item
        onClick={handleLogout}
        className="d-flex align-items-center gap-2 text-danger"
      >
        <i className="bi bi-box-arrow-right" />
        <span>{t('common:userMenu.signOut', 'Sign out')}</span>
      </NavDropdown.Item>
    </NavDropdown>
  );
};

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
}) => {
  const { t } = useTranslation(['common']);
  return (
    <div className="haproxy-ui">
      <Navbar bg="dark" variant="dark" expand="lg" className="px-3">
        <Navbar.Brand
          as={NavLink}
          to="/"
          end
          className="d-flex align-items-center gap-2 text-decoration-none"
          title={t('common:nav.dashboard', 'Dashboard')}
        >
          <LogoMark size={28} title={t('common:app.name', 'patchpanel')} />
          <span>{t('common:app.name', 'patchpanel')}</span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="primary-nav" />
        <Navbar.Collapse id="primary-nav">
          <Nav className="me-auto">
            <NavDropdown
              id="general-dropdown"
              title={
                <span className="d-inline-flex align-items-center gap-1">
                  <i className="bi bi-sliders2" />
                  <span>{t('common:nav.general', 'General')}</span>
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
                  <span>{t('common:nav.monitor', 'Monitor')}</span>
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
                  <span>{t('common:nav.settings', 'Settings')}</span>
                </span>
              }
            >
              {SETTINGS_TABS.map(tab => (
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
            <ErrorBoundary>
              <KeepalivedPowerControl />
            </ErrorBoundary>
            <ErrorBoundary>
              <UserMenu />
            </ErrorBoundary>
            <ErrorBoundary>
              <LanguageSwitcher />
            </ErrorBoundary>
            {onCycleTheme ? (
              <Button
                variant="outline-light"
                size="sm"
                onClick={onCycleTheme}
                title={themeLabel(themePreference, themeEffective, t)}
                aria-label={themeLabel(themePreference, themeEffective, t)}
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
};

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
};
