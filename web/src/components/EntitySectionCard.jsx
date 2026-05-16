import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Card } from 'react-bootstrap';

import { ConfirmDialog } from './ConfirmDialog.jsx';
import { EntityFormBuilder } from './EntityFormBuilder.jsx';
import { JsonEntityEditModal } from './JsonEntityEditModal.jsx';
import { ReorderableTable } from './ReorderableTable.jsx';

// Reusable CRUD card for the Phase 1 entity arrays. One per state-list (e.g.
// resolvers, peers, mailers, rings, crtStores, securityProfiles, additional
// frontends, http-errors sections). Each consumer passes a `section`
// descriptor that owns:
//   - `docPath` — array of keys identifying the array inside the state doc
//   - `emptyTemplate` — seed for a new entry
//   - `fields` (optional) — declarative field config; when present, edits
//     route through `EntityFormBuilder`. When absent, falls back to the
//     `JsonEntityEditModal`.
//   - `columns` / `searchFields` — passed through to `ReorderableTable`.
//
// Extracted from AdvancedPage.jsx in v0.2.35 so the same infrastructure can
// be reused on the Certificates / Error pages / Frontends tabs — entities
// now live next to the surface they modify, not stacked under "Advanced".

const EntityRowActions = ({ row, ctx }) => (
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
      variant="outline-danger"
      size="sm"
      onClick={() => ctx.setDeleting(row)}
      disabled={ctx.saving || !ctx.onSave}
    >
      Delete
    </Button>
  </>
);

EntityRowActions.propTypes = {
  row: PropTypes.object.isRequired,
  ctx: PropTypes.shape({
    saving: PropTypes.bool.isRequired,
    onSave: PropTypes.func,
    setEditing: PropTypes.func.isRequired,
    setDeleting: PropTypes.func.isRequired,
  }).isRequired,
};

const SectionEditor = ({ section, entity, onSave, onCancel }) => {
  if (section.fields) {
    return (
      <EntityFormBuilder
        show
        entity={entity}
        label={section.label}
        emptyTemplate={section.emptyTemplate}
        fields={section.fields}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }
  return (
    <JsonEntityEditModal
      show
      entity={entity}
      label={section.label}
      emptyTemplate={section.emptyTemplate}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
};

SectionEditor.propTypes = {
  section: PropTypes.object.isRequired,
  entity: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

const getEntities = (doc, path) => path.reduce((acc, key) => acc?.[key], doc) ?? [];

const setEntities = (doc, path, entities) => {
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return { ...doc, [head]: entities };
  }
  return { ...doc, [head]: setEntities(doc[head] ?? {}, rest, entities) };
};

export const EntitySectionCard = ({ doc, onSave, section }) => {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const entities = getEntities(doc, section.docPath);

  const persist = async nextEntities => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(setEntities(doc, section.docPath, nextEntities));
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = entity => {
    setShowNew(false);
    persist([...entities, entity]);
  };

  const handleUpdate = entity => {
    setEditing(null);
    persist(entities.map(e => (e.id === entity.id ? entity : e)));
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(entities.filter(e => e.id !== id));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">{section.title}</Card.Title>
            <Card.Text className="text-muted small mb-0">{section.description}</Card.Text>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNew(true)}
            disabled={saving || !onSave}
          >
            Add {section.label}
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            Save failed: {saveError.message}
          </Alert>
        ) : null}
        {entities.length === 0 ? (
          <p className="text-muted small mb-0">No {section.title.toLowerCase()} configured.</p>
        ) : (
          <ReorderableTable
            rows={entities}
            rowKey={row => row.id}
            columns={section.columns}
            searchFields={section.searchFields}
            filterPlaceholder={`Filter ${section.title.toLowerCase()}…`}
            RowActions={EntityRowActions}
            rowActionsContext={{ saving, onSave, setEditing, setDeleting }}
            emptyFilteredState={`No ${section.title.toLowerCase()} match the current filter.`}
          />
        )}
      </Card.Body>
      {showNew ? (
        <SectionEditor section={section} onSave={handleAdd} onCancel={() => setShowNew(false)} />
      ) : null}
      {editing ? (
        <SectionEditor
          section={section}
          entity={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title={`Delete ${section.label.toLowerCase()}?`}
          body={
            <>
              Delete <code>{deleting.id}</code>? This change applies immediately on save.
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

EntitySectionCard.propTypes = {
  doc: PropTypes.object.isRequired,
  onSave: PropTypes.func,
  section: PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    docPath: PropTypes.arrayOf(PropTypes.string).isRequired,
    description: PropTypes.string.isRequired,
    emptyTemplate: PropTypes.object.isRequired,
    fields: PropTypes.array,
    columns: PropTypes.array.isRequired,
    searchFields: PropTypes.array.isRequired,
  }).isRequired,
};
