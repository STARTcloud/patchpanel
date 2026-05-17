import PropTypes from 'prop-types';
import { Button, Form, Modal } from 'react-bootstrap';

import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from '../hooks/useDashboardLayout.jsx';

const MAX_PANEL_ROWS = 4;

const cellOpacity = (disallowed, occupied, hovered) => {
  if (occupied) {
    return hovered && !disallowed ? 1 : 0.85;
  }
  if (disallowed) {
    return 0.12;
  }
  return hovered ? 0.7 : 0.45;
};

const GridCell = ({ row, col, occupied, disallowed, onPick }) => {
  const baseOpacity = cellOpacity(disallowed, occupied, false);
  const hoverOpacity = cellOpacity(disallowed, occupied, true);
  return (
    <button
      type="button"
      onClick={() => (disallowed ? null : onPick({ col, row }))}
      disabled={disallowed}
      aria-label={`Set width ${col + 1} rows ${row + 1}`}
      title={disallowed ? 'Too small for this panel' : undefined}
      style={{
        background: occupied ? 'var(--bs-primary)' : 'var(--bs-tertiary-bg)',
        border: 'none',
        borderRadius: '3px',
        opacity: baseOpacity,
        cursor: disallowed ? 'not-allowed' : 'pointer',
        padding: 0,
        transition:
          'background-color 0.1s ease-out, opacity 0.1s ease-out, transform 0.05s ease-out',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.opacity = String(hoverOpacity);
      }}
      onMouseLeave={e => {
        e.currentTarget.style.opacity = String(baseOpacity);
      }}
    />
  );
};

GridCell.propTypes = {
  row: PropTypes.number.isRequired,
  col: PropTypes.number.isRequired,
  occupied: PropTypes.bool.isRequired,
  disallowed: PropTypes.bool.isRequired,
  onPick: PropTypes.func.isRequired,
};

const GridPicker = ({ width, heightRows, onPick, minWidth, minHeight }) => {
  // Highlight the actual rendered size. Earlier this collapsed to 1 row
  // when autoHeight was on, which made users think their panel was 1-tall
  // when it was actually 2+ rows.
  const occupiedRows = heightRows;
  const cells = [];
  for (let row = 0; row < MAX_PANEL_ROWS; row += 1) {
    for (let col = 0; col < MAX_PANEL_WIDTH; col += 1) {
      const targetWidth = col + 1;
      const targetHeight = row + 1;
      const disallowed = targetWidth < minWidth || targetHeight < minHeight;
      const occupied = row < occupiedRows && col < width;
      cells.push(
        <GridCell
          key={`${row}-${col}`}
          row={row}
          col={col}
          occupied={occupied}
          disallowed={disallowed}
          onPick={onPick}
        />
      );
    }
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${MAX_PANEL_WIDTH}, 1fr)`,
        gridTemplateRows: `repeat(${MAX_PANEL_ROWS}, 1.6rem)`,
        gap: '3px',
        marginBottom: '0.75rem',
      }}
    >
      {cells}
    </div>
  );
};

GridPicker.propTypes = {
  width: PropTypes.number.isRequired,
  heightRows: PropTypes.number.isRequired,
  onPick: PropTypes.func.isRequired,
  minWidth: PropTypes.number.isRequired,
  minHeight: PropTypes.number.isRequired,
};

export const PanelLayoutModal = ({
  show,
  panelTitle,
  width,
  heightRows,
  autoHeight,
  minWidth = 1,
  minHeight = 1,
  onWidth,
  onHeightRows,
  onAutoHeight,
  onHide,
  onClose,
}) => {
  const effectiveMinWidth = Math.max(MIN_PANEL_WIDTH, minWidth);
  const effectiveMinHeight = Math.max(1, minHeight);

  const handleGridPick = ({ col, row }) => {
    const nextWidth = Math.max(effectiveMinWidth, col + 1);
    const nextHeight = Math.max(effectiveMinHeight, row + 1);
    onWidth(nextWidth);
    onHeightRows(nextHeight);
    if (autoHeight) {
      onAutoHeight(false);
    }
  };

  const handleAutoHeightToggle = checked => {
    onAutoHeight(checked);
    if (!checked) {
      // Force an explicit height write so the parent's "is auto?" tristate
      // calc flips to false instead of falling back to the panel's
      // defaultAutoHeight. Re-asserting the current heightRows is enough.
      onHeightRows(heightRows);
    }
  };

  const sizeLabel = autoHeight ? `${width} × auto` : `${width} × ${heightRows}`;
  const fullWidthFallback = Math.max(effectiveMinWidth, 6);

  return (
    <Modal show={show} onHide={onClose} centered size="sm">
      <Modal.Header closeButton>
        <Modal.Title className="h6">
          Panel layout {panelTitle ? <span className="text-muted">· {panelTitle}</span> : null}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex justify-content-between align-items-center mb-2 small">
          <span className="text-muted">Click a cell to size the panel</span>
          <span className="font-monospace">{sizeLabel}</span>
        </div>
        <GridPicker
          width={width}
          heightRows={heightRows}
          onPick={handleGridPick}
          minWidth={effectiveMinWidth}
          minHeight={effectiveMinHeight}
        />

        <Form.Group className="mb-2">
          <div className="d-flex justify-content-between align-items-center">
            <Form.Label className="mb-0 small">Width</Form.Label>
            <span className="text-muted small font-monospace">
              {width} / {MAX_PANEL_WIDTH}
            </span>
          </div>
          <Form.Range
            min={effectiveMinWidth}
            max={MAX_PANEL_WIDTH}
            value={width}
            onChange={e => onWidth(Math.max(effectiveMinWidth, Number(e.target.value)))}
          />
        </Form.Group>

        <Form.Group className="mb-2">
          <div className="d-flex justify-content-between align-items-center">
            <Form.Label className="mb-0 small">Height (rows)</Form.Label>
            <span className="text-muted small font-monospace">
              {autoHeight ? 'auto' : `${heightRows} / ${MAX_PANEL_ROWS}`}
            </span>
          </div>
          <Form.Range
            min={effectiveMinHeight}
            max={MAX_PANEL_ROWS}
            value={heightRows}
            disabled={autoHeight}
            onChange={e => {
              if (autoHeight) {
                onAutoHeight(false);
              }
              onHeightRows(Math.max(effectiveMinHeight, Number(e.target.value)));
            }}
          />
        </Form.Group>

        <Form.Check
          type="switch"
          id="panel-layout-full-width"
          label="Full width"
          checked={width === MAX_PANEL_WIDTH}
          onChange={e => onWidth(e.target.checked ? MAX_PANEL_WIDTH : fullWidthFallback)}
          className="mb-2"
        />

        <Form.Check
          type="switch"
          id="panel-layout-auto-height"
          label="Auto height (size to content)"
          checked={autoHeight}
          onChange={e => handleAutoHeightToggle(e.target.checked)}
          className="mb-3"
        />

        <hr className="my-2" />

        <Button variant="outline-danger" size="sm" onClick={onHide} className="w-100">
          <i className="bi bi-eye-slash me-1" />
          Hide this panel
        </Button>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

PanelLayoutModal.propTypes = {
  show: PropTypes.bool.isRequired,
  panelTitle: PropTypes.string,
  width: PropTypes.number.isRequired,
  heightRows: PropTypes.number.isRequired,
  autoHeight: PropTypes.bool.isRequired,
  minWidth: PropTypes.number,
  minHeight: PropTypes.number,
  onWidth: PropTypes.func.isRequired,
  onHeightRows: PropTypes.func.isRequired,
  onAutoHeight: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export { PanelLayoutModal as PanelLayoutPopover };
