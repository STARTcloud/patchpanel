import PropTypes from 'prop-types';
import { Badge, Button, Form, OverlayTrigger, Popover } from 'react-bootstrap';

// v0.2.39 — Dashboard layout is reordered inline via drag-and-drop now (see
// DashboardPage). This module retained for show/hide toggles + reset; the
// modal-with-arrows is replaced by this overlay-trigger popover wired into
// the Dashboard's top-right Customize button.

const PanelToggleRow = ({ panel, isHidden, statsAvailable, onToggle }) => (
  <div className="d-flex align-items-center gap-2 py-1">
    <Form.Check
      type="switch"
      id={`dashboard-toggle-${panel.id}`}
      checked={!isHidden}
      onChange={() => onToggle(panel.id)}
      aria-label={`Show ${panel.title}`}
    />
    <div className="flex-grow-1 small">
      <div className="d-flex align-items-center gap-2">
        <span>{panel.title}</span>
        {panel.requiresStats ? (
          <Badge
            bg={statsAvailable ? 'success' : 'warning'}
            text="dark"
            className="small"
            style={{ fontSize: '0.65rem' }}
          >
            stats
          </Badge>
        ) : null}
      </div>
    </div>
  </div>
);

PanelToggleRow.propTypes = {
  panel: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    requiresStats: PropTypes.bool,
  }).isRequired,
  isHidden: PropTypes.bool.isRequired,
  statsAvailable: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

export const DashboardCustomizePopover = ({ layout, panelDefs, statsAvailable }) => {
  const orderedPanels = layout.order.map(id => panelDefs.find(p => p.id === id)).filter(Boolean);
  return (
    <Popover id="dashboard-customize-popover" style={{ minWidth: '20rem', maxWidth: '24rem' }}>
      <Popover.Header as="h6">Show / hide panels</Popover.Header>
      <Popover.Body>
        <p className="text-muted small mb-2">
          Drag panels on the dashboard itself to reorder. Use the switches below to toggle
          visibility. The KPI tiles at the top stay always-visible.
        </p>
        <hr className="my-2" />
        {orderedPanels.length === 0 ? (
          <p className="text-muted small mb-0">No customizable panels.</p>
        ) : (
          orderedPanels.map(panel => (
            <PanelToggleRow
              key={panel.id}
              panel={panel}
              isHidden={layout.hidden.has(panel.id)}
              statsAvailable={!panel.requiresStats || statsAvailable}
              onToggle={layout.toggleHidden}
            />
          ))
        )}
        <hr className="my-2" />
        <Button variant="outline-secondary" size="sm" onClick={() => layout.reset()}>
          <i className="bi bi-arrow-counterclockwise me-1" />
          Reset to defaults
        </Button>
      </Popover.Body>
    </Popover>
  );
};

DashboardCustomizePopover.propTypes = {
  layout: PropTypes.shape({
    order: PropTypes.arrayOf(PropTypes.string).isRequired,
    hidden: PropTypes.instanceOf(Set).isRequired,
    toggleHidden: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
  }).isRequired,
  panelDefs: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      requiresStats: PropTypes.bool,
    })
  ).isRequired,
  statsAvailable: PropTypes.bool.isRequired,
};

// Convenience wrapper for the Customize button: renders the popover via an
// OverlayTrigger so the dashboard page only has to drop in this component.
export const DashboardCustomizeControl = ({ layout, panelDefs, statsAvailable }) => (
  <OverlayTrigger
    trigger="click"
    placement="bottom-end"
    rootClose
    overlay={
      <DashboardCustomizePopover
        layout={layout}
        panelDefs={panelDefs}
        statsAvailable={statsAvailable}
      />
    }
  >
    <Button variant="outline-secondary" size="sm" title="Show/hide dashboard panels + reset layout">
      <i className="bi bi-sliders me-1" />
      Customize
    </Button>
  </OverlayTrigger>
);

DashboardCustomizeControl.propTypes = {
  layout: PropTypes.shape({
    order: PropTypes.arrayOf(PropTypes.string).isRequired,
    hidden: PropTypes.instanceOf(Set).isRequired,
    toggleHidden: PropTypes.func.isRequired,
    reset: PropTypes.func.isRequired,
  }).isRequired,
  panelDefs: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      requiresStats: PropTypes.bool,
    })
  ).isRequired,
  statsAvailable: PropTypes.bool.isRequired,
};
