import PropTypes from 'prop-types';
import { useState } from 'react';
import { NavDropdown, Spinner } from 'react-bootstrap';

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
  if (alive === null) {
    return (
      <i
        className="bi bi-broadcast-pin text-muted"
        title={title ?? 'Checking keepalived status…'}
        aria-label="keepalived status checking"
      />
    );
  }
  if (alive) {
    return (
      <i
        className="bi bi-broadcast-pin text-success"
        title={title ?? 'keepalived is running'}
        aria-label="keepalived running"
      />
    );
  }
  return (
    <i
      className="bi bi-broadcast-pin text-danger"
      title={title ?? 'keepalived is stopped'}
      aria-label="keepalived stopped"
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

const STOP_CONFIRM_BODY = (
  <>
    <p className="mb-2">
      This will <strong>stop keepalived</strong>. Any VIPs currently held by this node will fail
      over to a peer (if one exists with a higher priority). If this is the only node, the VIPs will
      become unreachable.
    </p>
    <p className="mb-0 small text-muted">
      Bring keepalived back up via Start (or your supervisor) once you&apos;re ready.
    </p>
  </>
);

const aliveLabel = alive => {
  if (alive === null) {
    return 'checking…';
  }
  return alive ? 'running' : 'stopped';
};

const toggleTitle = (alive, strategy) => {
  const stratLabel = strategy ? ` · strategy: ${strategy}` : '';
  return `keepalived ${aliveLabel(alive)}${stratLabel}`;
};

export const KeepalivedPowerControl = () => {
  const { alive, strategy, refresh } = useKeepalivedLive();
  const { confirm, ConfirmationDialog } = useConfirmation();
  const [busy, setBusy] = useState(null);

  const isRunning = alive === true;
  const isStopped = alive === false;
  const directStart = strategy === 'direct';
  const managedExternally = strategy === 'none';

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
      title: 'Stop keepalived?',
      body: STOP_CONFIRM_BODY,
      confirmLabel: 'Stop keepalived',
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
            Strategy <code>none</code> — keepalived is managed outside patchpanel.
          </NavDropdown.ItemText>
        ) : null}
        {!managedExternally && isRunning ? (
          <>
            <PowerMenuItem
              icon="arrow-clockwise"
              label="Reload"
              busyLabel="Reloading…"
              busy={busy === 'reload'}
              onSelect={handleReload}
              title="Re-read keepalived.conf via SIGHUP. Existing VRRP state is preserved."
            />
            <PowerMenuItem
              icon="stop-circle"
              label="Stop"
              busyLabel="Stopping…"
              busy={busy === 'stop'}
              danger
              onSelect={handleStop}
              title="Stop keepalived. VIPs held by this node will fail over (or vanish). Requires confirmation."
            />
          </>
        ) : null}
        {!managedExternally && isStopped ? (
          <PowerMenuItem
            icon="play-circle"
            label="Start"
            busyLabel="Starting…"
            busy={busy === 'start'}
            disabled={directStart}
            onSelect={handleStart}
            title={
              directStart
                ? 'Direct strategy cannot start keepalived — no supervisor configured.'
                : 'Start keepalived via the configured supervisor.'
            }
          />
        ) : null}
        {alive === null ? (
          <NavDropdown.ItemText className="small text-muted">
            <Spinner as="span" animation="border" size="sm" className="me-2" /> Checking…
          </NavDropdown.ItemText>
        ) : null}
      </NavDropdown>
      <ConfirmationDialog />
    </>
  );
};
