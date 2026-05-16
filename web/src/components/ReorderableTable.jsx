import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Form, InputGroup, OverlayTrigger, Table, Tooltip } from 'react-bootstrap';

import { useTableControls } from '../hooks/useTableControls.jsx';

import { SortableHeader } from './SortableHeader.jsx';

// Reusable table component that combines:
//   - sortable column headers (any column with `sortable: true`)
//   - substring filter across configured search fields
//   - optional drag-reorder + up/down + jump-to-position controls when
//     `reorderable` + `onReorder` are provided (the order-matters case for
//     things like HAProxy routes and balance-roundrobin server lists)
//
// Drag-reorder is disabled while a sort is active (the displayed order is
// computed; mutating the underlying array based on a drop position would lie
// about what the user dragged). A small tooltip explains. Click the position
// column header to clear the sort and re-enable drag.

const moveItem = (array, fromIndex, toIndex) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
    return array;
  }
  if (fromIndex >= array.length || toIndex >= array.length) {
    return array;
  }
  const out = array.slice();
  const [item] = out.splice(fromIndex, 1);
  out.splice(toIndex, 0, item);
  return out;
};

const renderCellValue = (col, row, savedIndex) => {
  if (col.render) {
    return col.render(row, savedIndex);
  }
  if (col.accessor) {
    return col.accessor(row);
  }
  return row[col.key];
};

const useDragReorder = ({ rows, canReorder, onReorder }) => {
  const dragSourceIndex = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const onDragStart = (e, index) => {
    if (!canReorder) {
      return;
    }
    dragSourceIndex.current = index;
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(index));
    } catch {
      // Older browsers; non-fatal.
    }
  };

  const onDragOver = (e, index) => {
    if (!canReorder) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const onDrop = (e, index) => {
    if (!canReorder) {
      return;
    }
    e.preventDefault();
    const from = dragSourceIndex.current;
    dragSourceIndex.current = null;
    setDragOverIndex(null);
    if (from === null || from === index) {
      return;
    }
    onReorder(moveItem(rows, from, index));
  };

  const onDragEnd = () => {
    dragSourceIndex.current = null;
    setDragOverIndex(null);
  };

  return { dragOverIndex, onDragStart, onDragOver, onDrop, onDragEnd };
};

const PositionCell = ({ index, total, canReorder, onMove, onJump, positionLabel }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(index + 1));
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const commit = () => {
    const target = Number.parseInt(value, 10);
    if (Number.isInteger(target) && target >= 1 && target <= total) {
      onJump(target - 1);
    }
    setValue(String(index + 1));
    setEditing(false);
  };

  return (
    <div className="d-flex align-items-center gap-1">
      {canReorder ? (
        <div className="d-flex flex-column">
          <Button
            variant="link"
            size="sm"
            className="p-0 lh-1"
            disabled={index === 0}
            onClick={() => onMove(index, index - 1)}
            aria-label={`Move up to ${positionLabel} ${index}`}
            title="Move up"
          >
            <i className="bi bi-caret-up-fill small" />
          </Button>
          <Button
            variant="link"
            size="sm"
            className="p-0 lh-1"
            disabled={index === total - 1}
            onClick={() => onMove(index, index + 1)}
            aria-label={`Move down to ${positionLabel} ${index + 2}`}
            title="Move down"
          >
            <i className="bi bi-caret-down-fill small" />
          </Button>
        </div>
      ) : null}
      {editing && canReorder ? (
        <InputGroup size="sm" style={{ width: '5rem' }}>
          <Form.Control
            ref={inputRef}
            type="number"
            min={1}
            max={total}
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setValue(String(index + 1));
                setEditing(false);
              }
            }}
          />
        </InputGroup>
      ) : (
        <Badge
          bg="secondary"
          className={canReorder ? 'cursor-pointer' : ''}
          style={canReorder ? { cursor: 'pointer' } : {}}
          title={canReorder ? `Click to jump to a different ${positionLabel}` : ''}
          onClick={() => {
            if (canReorder) {
              setEditing(true);
            }
          }}
        >
          #{index + 1}
        </Badge>
      )}
    </div>
  );
};

PositionCell.propTypes = {
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  canReorder: PropTypes.bool.isRequired,
  onMove: PropTypes.func.isRequired,
  onJump: PropTypes.func.isRequired,
  positionLabel: PropTypes.string.isRequired,
};

const PositionHeader = ({ positionLabel, canReorder, onClearSort, sortActive }) => (
  <OverlayTrigger
    placement="top"
    overlay={
      <Tooltip>
        {canReorder
          ? `Saved order — drag rows or use arrows to reorder. ${positionLabel} #1 is evaluated first.`
          : `Sort is active — saved-order controls disabled. Click here to clear the sort and re-enable drag.`}
      </Tooltip>
    }
  >
    <th
      style={{ cursor: sortActive ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
      onClick={() => {
        if (sortActive) {
          onClearSort();
        }
      }}
    >
      <i className="bi bi-list-ol me-1" />
      {positionLabel}
    </th>
  </OverlayTrigger>
);

PositionHeader.propTypes = {
  positionLabel: PropTypes.string.isRequired,
  canReorder: PropTypes.bool.isRequired,
  onClearSort: PropTypes.func.isRequired,
  sortActive: PropTypes.bool.isRequired,
};

const FilterInput = ({ search, setSearch, placeholder }) => (
  <InputGroup size="sm" className="mb-2" style={{ maxWidth: '24rem' }}>
    <InputGroup.Text>
      <i className="bi bi-search" />
    </InputGroup.Text>
    <Form.Control
      placeholder={placeholder}
      value={search}
      onChange={e => setSearch(e.target.value)}
    />
    {search ? (
      <Button variant="outline-secondary" onClick={() => setSearch('')}>
        ×
      </Button>
    ) : null}
  </InputGroup>
);

FilterInput.propTypes = {
  search: PropTypes.string.isRequired,
  setSearch: PropTypes.func.isRequired,
  placeholder: PropTypes.string.isRequired,
};

const TableHeadRow = ({
  showPosition,
  positionLabel,
  canReorder,
  controls,
  columns,
  hasActions,
}) => (
  <tr>
    {showPosition ? (
      <PositionHeader
        positionLabel={positionLabel}
        canReorder={canReorder}
        sortActive={controls.sort !== null}
        onClearSort={() => controls.toggleSort(controls.sort?.field)}
      />
    ) : null}
    {columns.map(col =>
      col.sortable ? (
        <SortableHeader
          key={col.key}
          label={col.label}
          field={col.accessor ?? col.key}
          sort={controls.sort}
          onToggle={controls.toggleSort}
          className={col.className}
        />
      ) : (
        <th key={col.key} className={col.className}>
          {col.label}
        </th>
      )
    )}
    {hasActions ? <th className="text-end">Actions</th> : null}
  </tr>
);

TableHeadRow.propTypes = {
  showPosition: PropTypes.bool.isRequired,
  positionLabel: PropTypes.string.isRequired,
  canReorder: PropTypes.bool.isRequired,
  controls: PropTypes.object.isRequired,
  columns: PropTypes.array.isRequired,
  hasActions: PropTypes.bool.isRequired,
};

const emptyMessage = (search, emptyState, emptyFilteredState) => {
  if (search) {
    return emptyFilteredState ?? 'No rows match the current filter.';
  }
  return emptyState ?? 'No rows.';
};

const focusedRowStyle = isDragOver => {
  if (isDragOver) {
    return { outline: '2px solid var(--bs-primary)', outlineOffset: '-2px' };
  }
  return undefined;
};

const DataRow = ({
  row,
  savedIndex,
  rowsLength,
  canReorder,
  drag,
  showPosition,
  positionLabel,
  handleMove,
  handleJump,
  columns,
  RowActions,
  rowActionsContext,
  isFocused,
  rowRef,
}) => {
  const isDragOver = canReorder && drag.dragOverIndex === savedIndex;
  const className = isFocused ? 'patchpanel-row-focused table-warning' : undefined;
  return (
    <tr
      ref={rowRef}
      className={className}
      draggable={canReorder}
      onDragStart={e => drag.onDragStart(e, savedIndex)}
      onDragOver={e => drag.onDragOver(e, savedIndex)}
      onDrop={e => drag.onDrop(e, savedIndex)}
      onDragEnd={drag.onDragEnd}
      style={focusedRowStyle(isDragOver)}
    >
      {showPosition ? (
        <td>
          <PositionCell
            index={savedIndex}
            total={rowsLength}
            canReorder={canReorder}
            onMove={handleMove}
            onJump={to => handleJump(savedIndex, to)}
            positionLabel={positionLabel}
          />
        </td>
      ) : null}
      {columns.map(col => (
        <td key={col.key} className={col.className}>
          {renderCellValue(col, row, savedIndex)}
        </td>
      ))}
      {RowActions ? (
        <td className="text-end text-nowrap">
          <RowActions row={row} savedIndex={savedIndex} ctx={rowActionsContext} />
        </td>
      ) : null}
    </tr>
  );
};

DataRow.propTypes = {
  row: PropTypes.object.isRequired,
  savedIndex: PropTypes.number.isRequired,
  rowsLength: PropTypes.number.isRequired,
  canReorder: PropTypes.bool.isRequired,
  drag: PropTypes.object.isRequired,
  showPosition: PropTypes.bool.isRequired,
  positionLabel: PropTypes.string.isRequired,
  handleMove: PropTypes.func.isRequired,
  handleJump: PropTypes.func.isRequired,
  columns: PropTypes.array.isRequired,
  RowActions: PropTypes.elementType,
  rowActionsContext: PropTypes.object,
  isFocused: PropTypes.bool,
  rowRef: PropTypes.object,
};

export const ReorderableTable = ({
  rows,
  columns,
  rowKey,
  searchFields = [],
  filterPlaceholder = 'Filter…',
  positionLabel = 'Position',
  reorderable = false,
  onReorder = null,
  RowActions = null,
  rowActionsContext = null,
  renderRowExtra = null,
  initialSort = null,
  emptyState = null,
  emptyFilteredState = null,
  focusRowKey = null,
}) => {
  const controls = useTableControls(rows, { searchFields, initialSort });
  const canReorder = reorderable && Boolean(onReorder) && controls.sort === null;
  const focusedRowRef = useRef(null);

  useEffect(() => {
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusRowKey]);

  const handleMove = useCallback(
    (from, to) => {
      if (!onReorder) {
        return;
      }
      onReorder(moveItem(rows, from, to));
    },
    [rows, onReorder]
  );

  const handleJump = useCallback(
    (from, to) => {
      if (!onReorder) {
        return;
      }
      onReorder(moveItem(rows, from, to));
    },
    [rows, onReorder]
  );

  const drag = useDragReorder({ rows, canReorder, onReorder });

  // Build an "underlying index" lookup keyed by the row's identity so we can
  // show the saved position even when the displayed view is sorted/filtered.
  const indexByKey = useMemo(() => {
    const map = new Map();
    rows.forEach((row, idx) => {
      map.set(rowKey(row), idx);
    });
    return map;
  }, [rows, rowKey]);

  const showPosition = reorderable && Boolean(onReorder);
  const hasActions = Boolean(RowActions);
  const totalCols = (showPosition ? 1 : 0) + columns.length + (hasActions ? 1 : 0);

  return (
    <div>
      <FilterInput
        search={controls.search}
        setSearch={controls.setSearch}
        placeholder={filterPlaceholder}
      />
      <Table striped bordered hover responsive size="sm">
        <thead>
          <TableHeadRow
            showPosition={showPosition}
            positionLabel={positionLabel}
            canReorder={canReorder}
            controls={controls}
            columns={columns}
            hasActions={hasActions}
          />
        </thead>
        <tbody>
          {controls.view.length === 0 ? (
            <tr>
              <td colSpan={totalCols} className="text-center text-muted small py-3">
                {emptyMessage(controls.search, emptyState, emptyFilteredState)}
              </td>
            </tr>
          ) : null}
          {controls.view.map(row => {
            const key = rowKey(row);
            const savedIndex = indexByKey.get(key);
            const isFocused = focusRowKey !== null && key === focusRowKey;
            return (
              <DataRow
                key={key}
                row={row}
                savedIndex={savedIndex}
                rowsLength={rows.length}
                canReorder={canReorder}
                drag={drag}
                showPosition={showPosition}
                positionLabel={positionLabel}
                handleMove={handleMove}
                handleJump={handleJump}
                columns={columns}
                RowActions={RowActions}
                rowActionsContext={rowActionsContext}
                isFocused={isFocused}
                rowRef={isFocused ? focusedRowRef : null}
              />
            );
          })}
          {renderRowExtra ? renderRowExtra(controls.view) : null}
        </tbody>
      </Table>
    </div>
  );
};

ReorderableTable.propTypes = {
  rows: PropTypes.array.isRequired,
  columns: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      sortable: PropTypes.bool,
      accessor: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
      render: PropTypes.func,
      className: PropTypes.string,
    })
  ).isRequired,
  rowKey: PropTypes.func.isRequired,
  searchFields: PropTypes.array,
  filterPlaceholder: PropTypes.string,
  positionLabel: PropTypes.string,
  reorderable: PropTypes.bool,
  onReorder: PropTypes.func,
  RowActions: PropTypes.elementType,
  rowActionsContext: PropTypes.object,
  renderRowExtra: PropTypes.func,
  initialSort: PropTypes.shape({
    field: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
    direction: PropTypes.oneOf(['asc', 'desc']),
  }),
  emptyState: PropTypes.node,
  emptyFilteredState: PropTypes.node,
  focusRowKey: PropTypes.string,
};
