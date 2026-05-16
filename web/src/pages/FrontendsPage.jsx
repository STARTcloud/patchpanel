import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card } from 'react-bootstrap';

import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { FrontendEditModal } from '../components/FrontendEditModal.jsx';
import { ReorderableTable } from '../components/ReorderableTable.jsx';
import { usePendingChanges } from '../hooks/usePendingChanges.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';
import { genKey } from '../utils/keys.js';

const BindSummary = ({ binds }) => {
  if (!binds || binds.length === 0) {
    return <span className="text-muted">—</span>;
  }
  const [first] = binds;
  const extra = binds.length > 1 ? ` +${binds.length - 1}` : '';
  return (
    <span>
      <code>{first.address}</code>
      <span className="text-muted small">{extra}</span>
    </span>
  );
};

BindSummary.propTypes = {
  binds: PropTypes.array,
};

const NameCell = ({ row }) => (
  <div>
    <code>{row.name}</code>
    {row.description ? <div className="text-muted small">{row.description}</div> : null}
  </div>
);

NameCell.propTypes = {
  row: PropTypes.object.isRequired,
};

const ModeBadge = ({ row }) => (
  <Badge bg={row.mode === 'tcp' ? 'secondary' : 'primary'}>{row.mode}</Badge>
);

ModeBadge.propTypes = {
  row: PropTypes.object.isRequired,
};

const FrontendRowActions = ({ row, ctx }) => (
  <>
    <Button
      variant="outline-secondary"
      size="sm"
      className="me-1"
      onClick={() => ctx.setEditing(row)}
      disabled={ctx.saving || !ctx.onSave}
    >
      Edit
    </Button>
    <Button
      variant="outline-info"
      size="sm"
      className="me-1"
      onClick={() => ctx.handleClone(row)}
      disabled={ctx.saving || !ctx.onSave}
      title="Duplicate this frontend with a fresh id + section name"
    >
      Clone
    </Button>
    <Button
      variant="outline-danger"
      size="sm"
      onClick={() => ctx.setDeleting(row)}
      disabled={ctx.saving || !ctx.onSave}
    >
      Delete
    </Button>
  </>
);

FrontendRowActions.propTypes = {
  row: PropTypes.object.isRequired,
  ctx: PropTypes.shape({
    saving: PropTypes.bool.isRequired,
    onSave: PropTypes.func,
    setEditing: PropTypes.func.isRequired,
    setDeleting: PropTypes.func.isRequired,
    handleClone: PropTypes.func.isRequired,
  }).isRequired,
};

const buildColumns = () => [
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    accessor: row => row.name,
    render: row => <NameCell row={row} />,
  },
  {
    key: 'mode',
    label: 'Mode',
    sortable: true,
    accessor: row => row.mode,
    render: row => <ModeBadge row={row} />,
  },
  {
    key: 'bind',
    label: 'Bind',
    render: row => <BindSummary binds={row.binds} />,
  },
  {
    key: 'enabled',
    label: 'Enabled',
    sortable: true,
    accessor: row => row.enabled,
    render: row => (row.enabled ? '✓' : '✗'),
    className: 'text-center',
  },
];

const uniqueIdFrom = (proposed, takenIds) => {
  if (!takenIds.has(proposed)) {
    return proposed;
  }
  let suffix = 2;
  let candidate = `${proposed}-${suffix}`;
  while (takenIds.has(candidate)) {
    suffix += 1;
    candidate = `${proposed}-${suffix}`;
  }
  return candidate;
};

export const FrontendsPage = ({ doc = null, onSave = null }) => {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const { pending, setPending, clearPending } = usePendingChanges();

  // The page-visible frontends come from pending if there's an unapplied
  // change, otherwise from the live doc. CRUD operations build on top of
  // pending too so a reorder isn't lost if the user edits a row after
  // dragging it.
  const effectiveDoc = pending?.doc ?? doc;
  const frontends = useMemo(() => effectiveDoc?.frontends ?? [], [effectiveDoc]);

  if (!doc) {
    return null;
  }

  const persistDoc = async nextDoc => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nextDoc);
      clearPending();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = next => {
    setShowNew(false);
    persistDoc({ ...effectiveDoc, frontends: [...frontends, next] });
  };

  const handleUpdate = next => {
    setEditing(null);
    persistDoc({
      ...effectiveDoc,
      frontends: frontends.map(f => (f.id === next.id ? next : f)),
    });
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persistDoc({ ...effectiveDoc, frontends: frontends.filter(f => f.id !== id) });
  };

  const handleClone = fe => {
    const takenIds = new Set(frontends.map(f => f.id));
    const takenNames = new Set(frontends.map(f => f.name));
    const baseId = `${fe.id}-copy`;
    const baseName = `${fe.name}_copy`;
    const cloned = {
      ...fe,
      id: uniqueIdFrom(baseId, takenIds),
      name: uniqueIdFrom(baseName, takenNames),
      binds: (fe.binds ?? []).map(b => ({ ...b, id: `b${genKey()}` })),
    };
    persistDoc({ ...effectiveDoc, frontends: [...frontends, cloned] });
  };

  // Reorder is the deferred operation — it stashes the next order into the
  // pending-changes context instead of firing the apply pipeline. The navbar
  // shows Apply / Discard buttons until the user commits.
  const handleReorder = nextRows => {
    setPending({
      label: 'Frontends reorder',
      doc: { ...effectiveDoc, frontends: nextRows },
    });
  };

  const columns = buildColumns();

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">Frontends</Card.Title>
            <Card.Text className="text-muted small mb-0">
              One row per HAProxy <code>frontend</code> section. Drag rows to reorder; HAProxy
              parses sections top-to-bottom.
            </Card.Text>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNew(true)}
            disabled={saving || !onSave}
          >
            Add frontend
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            Save failed: {saveError.message}
          </Alert>
        ) : null}
        <ReorderableTable
          rows={frontends}
          rowKey={row => row.id}
          columns={columns}
          searchFields={[
            'name',
            'id',
            'mode',
            row => (row.binds ?? []).map(b => b.address).join(' '),
          ]}
          filterPlaceholder="Filter by name, id, mode, bind address…"
          positionLabel="Order"
          reorderable
          onReorder={onSave ? handleReorder : null}
          RowActions={FrontendRowActions}
          rowActionsContext={{ saving, onSave, setEditing, setDeleting, handleClone }}
          emptyState={
            <>
              No frontends. Click <strong>Add frontend</strong> to create one.
            </>
          }
          emptyFilteredState="No frontends match the current filter."
        />
      </Card.Body>
      {showNew ? (
        <FrontendEditModal show doc={doc} onSave={handleAdd} onCancel={() => setShowNew(false)} />
      ) : null}
      {editing ? (
        <FrontendEditModal
          show
          frontend={editing}
          doc={doc}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title="Delete frontend?"
          body={
            <>
              Delete <code>{deleting.name}</code> (id <code>{deleting.id}</code>)? This change
              applies immediately on save.
            </>
          }
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

FrontendsPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
