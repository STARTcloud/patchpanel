import PropTypes from 'prop-types';
import { useState } from 'react';
import { NavDropdown, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';
import { useConfirmation } from '../hooks/useConfirmation.jsx';
import { useKeepalivedLive } from '../hooks/useKeepalivedLive.jsx';

// Keepalived power control — direct mirror of HaproxyPowerControl in
// Layout.jsx (same NavDropdown shape, same context-aware menu, same
// confirm-dialog flow for the destructive Stop action). Reads liveness +
// strategy from useKeepalivedLive; runs reload/stop/start via
// /api/keepalived/{reload,stop,start}.
//
// Behavior parallels HaproxyPowerControl:
//   - alive === true   → Reload + Stop menu items
//   - alive === false  → Start menu item (disabled if strategy=direct
//                        AND no managed supervisor — keepalived has no
//                        master socket; direct stop = orphaned process,
//                        direct start needs a supervisor of some kind)
//   - alive === null   → "Checking…" pseudo-item, no actions
//
// Strategy="none" hides all action items; the badge becomes a read-only
// status indicator (operator manages keepalived externally).

const StatusIcon = ({ alive, title }) => {
  const { t } = useTranslation(['cluster']);
  if (alive === null) {
    return (
      <i
        className="bi bi-broadcast-pin text-muted"
        title={title ?? t('cluster:keepalived.power.statusChecking', 'Checking keepalived status…')}
        aria-label={t('cluster:keepalived.power.ariaChecking', 'keepalived status checking')}
      />
    );
  }
  if (alive) {
    return (
      <i
        className="bi bi-broadcast-pin text-success"
        title={title ?? t('cluster:keepalived.power.statusRunning', 'keepalived is running')}
        aria-label={t('cluster:keepalived.power.ariaRunning', 'keepalived running')}
      />
    );
  }
  return (
    <i
      className="bi bi-broadcast-pin text-danger"
      title={title ?? t('cluster:keepalived.power.statusStopped', 'keepalived is stopped')}
      aria-label={t('cluster:keepalived.power.ariaStopped', 'keepalived stopped')}
    />
  );
};

StatusIcon.propTypes = {
  alive: PropTypes.bool,
  title: PropTypes.string,
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

export const KeepalivedPowerControl = () => {
  const { t } = useTranslation(['cluster', 'common']);
  const { alive, strategy, installed, refresh } = useKeepalivedLive();
  const { confirm, ConfirmationDialog } = useConfirmation();
  const [busy, setBusy] = useState(null);

  // Hide the badge entirely when the keepalived binary isn't present at
  // paths.keepalivedBin. The server reports `installed: false` for those
  // deployments (typical for HA addons that don't ship keepalived).
  // Returning null here keeps the navbar clean instead of showing a
  // permanent "checking…" spinner the operator can't act on.
  if (installed === false) {
    return null;
  }

  const isRunning = alive === true;
  const isStopped = alive === false;
  const directStart = strategy === 'direct';
  const managedExternally = strategy === 'none';

  const aliveLabel = a => {
    if (a === null) {
      return t('cluster:keepalived.power.aliveChecking', 'checking…');
    }
    return a
      ? t('cluster:keepalived.power.aliveRunning', 'running')
      : t('cluster:keepalived.power.aliveStopped', 'stopped');
  };

  const toggleTitle = (a, s) => {
    const stratLabel = s
      ? t('cluster:keepalived.power.strategyLabel', ' · strategy: {{strategy}}', { strategy: s })
      : '';
    return t('cluster:keepalived.power.toggleTitle', 'keepalived {{state}}{{strategy}}', {
      state: aliveLabel(a),
      strategy: stratLabel,
    });
  };

  const stopConfirmBody = (
    <>
      <p className="mb-2">
        {t(
          'cluster:keepalived.power.stopConfirm.body1',
          'This will stop keepalived. Any VIPs currently held by this node will fail over to a peer (if one exists with a higher priority). If this is the only node, the VIPs will become unreachable.'
        )}
      </p>
      <p className="mb-0 small text-muted">
        {t(
          'cluster:keepalived.power.stopConfirm.body2',
          "Bring keepalived back up via Start (or your supervisor) once you're ready."
        )}
      </p>
    </>
  );

  const run = async (kind, path) => {
    setBusy(kind);
    try {
      await apiPost(path, kind === 'stop' ? { confirm: true } : undefined);
    } catch {
      // swallow — the polling refresh below will surface the resulting state
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const handleReload = () => run('reload', 'api/keepalived/reload');
  const handleStart = () => run('start', 'api/keepalived/start');
  const handleStop = async () => {
    const ok = await confirm({
      title: t('cluster:keepalived.power.stopConfirm.title', 'Stop keepalived?'),
      body: stopConfirmBody,
      confirmLabel: t('cluster:keepalived.power.stopConfirm.confirmLabel', 'Stop keepalived'),
      confirmVariant: 'danger',
    });
    if (ok) {
      run('stop', 'api/keepalived/stop');
    }
  };

  const toggle = <StatusIcon alive={alive} title={toggleTitle(alive, strategy)} />;

  return (
    <>
      <NavDropdown
        id="keepalived-power-dropdown"
        title={toggle}
        align="end"
        menuVariant="dark"
        aria-label={toggleTitle(alive, strategy)}
      >
        {managedExternally ? (
          <NavDropdown.ItemText className="small text-muted">
            {t(
              'cluster:keepalived.power.managedExternally',
              'Strategy `none` — keepalived is managed outside patchpanel.'
            )}
          </NavDropdown.ItemText>
        ) : null}
        {!managedExternally && isRunning ? (
          <>
            <PowerMenuItem
              icon="arrow-clockwise"
              label={t('common:buttons.reload', 'Reload')}
              busyLabel={t('cluster:keepalived.power.reloading', 'Reloading…')}
              busy={busy === 'reload'}
              onSelect={handleReload}
              title={t(
                'cluster:keepalived.power.reloadTitle',
                'Re-read keepalived.conf via SIGHUP. Existing VRRP state is preserved.'
              )}
            />
            <PowerMenuItem
              icon="stop-circle"
              label={t('common:buttons.stop', 'Stop')}
              busyLabel={t('cluster:keepalived.power.stopping', 'Stopping…')}
              busy={busy === 'stop'}
              danger
              onSelect={handleStop}
              title={t(
                'cluster:keepalived.power.stopTitle',
                'Stop keepalived. VIPs held by this node will fail over (or vanish). Requires confirmation.'
              )}
            />
          </>
        ) : null}
        {!managedExternally && isStopped ? (
          <PowerMenuItem
            icon="play-circle"
            label={t('common:buttons.start', 'Start')}
            busyLabel={t('cluster:keepalived.power.starting', 'Starting…')}
            busy={busy === 'start'}
            disabled={directStart}
            onSelect={handleStart}
            title={
              directStart
                ? t(
                    'cluster:keepalived.power.startDirectTitle',
                    'Direct strategy cannot start keepalived — no supervisor configured.'
                  )
                : t(
                    'cluster:keepalived.power.startTitle',
                    'Start keepalived via the configured supervisor.'
                  )
            }
          />
        ) : null}
        {alive === null ? (
          <NavDropdown.ItemText className="small text-muted">
            <Spinner as="span" animation="border" size="sm" className="me-2" />{' '}
            {t('cluster:keepalived.power.checking', 'Checking…')}
          </NavDropdown.ItemText>
        ) : null}
      </NavDropdown>
      <ConfirmationDialog />
    </>
  );
};
