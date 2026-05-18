import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { DefaultsBlockEditModal } from '../components/DefaultsBlockEditModal.jsx';
import { ReorderableTable } from '../components/ReorderableTable.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const RowActions = ({ row, ctx }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const refs = ctx.refsByBlock.get(row.id) ?? [];
  return (
    <>
      <Button
        variant="outline-secondary"
        size="sm"
        className="me-1"
        onClick={() => ctx.setEditing(row)}
        disabled={ctx.saving || !ctx.onSave}
      >
        {t('common:buttons.edit', 'Edit')}
      </Button>
      <Button
        variant="outline-danger"
        size="sm"
        onClick={() => ctx.setDeleting(row)}
        disabled={ctx.saving || !ctx.onSave || refs.length > 0}
        title={
          refs.length > 0
            ? t(
                'haproxy:defaults.actions.deleteBlocked',
                'Referenced by {{count}} frontend(s); change them first.',
                { count: refs.length }
              )
            : ''
        }
      >
        {t('common:buttons.delete', 'Delete')}
      </Button>
    </>
  );
};

RowActions.propTypes = {
  row: PropTypes.object.isRequired,
  ctx: PropTypes.object.isRequired,
};

export const DefaultsPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  if (!doc) {
    return null;
  }
  const blocks = doc.defaultsBlocks ?? [];

  const refsByBlock = new Map();
  for (const block of blocks) {
    refsByBlock.set(
      block.id,
      (doc.frontends ?? []).filter(f => f.fromDefaults === block.id).map(f => f.name)
    );
  }

  const persist = async nextBlocks => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...doc, defaultsBlocks: nextBlocks });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = block => {
    setShowNew(false);
    persist([...blocks, block]);
  };

  const handleUpdate = block => {
    setEditing(null);
    persist(blocks.map(b => (b.id === block.id ? block : b)));
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(blocks.filter(b => b.id !== id));
  };

  const columns = [
    {
      key: 'name',
      label: t('haproxy:defaults.columns.name', 'Name'),
      sortable: true,
      accessor: r => r.name,
      render: r => <code>{r.name}</code>,
    },
    {
      key: 'mode',
      label: t('haproxy:defaults.columns.mode', 'Mode'),
      sortable: true,
      accessor: r => r.mode,
      render: r => <Badge bg={r.mode === 'tcp' ? 'secondary' : 'primary'}>{r.mode}</Badge>,
    },
    {
      key: 'retries',
      label: t('haproxy:defaults.columns.retries', 'Retries'),
      accessor: r => r.retries,
      className: 'text-end',
    },
    {
      key: 'usedBy',
      label: t('haproxy:defaults.columns.usedBy', 'Used by'),
      render: r => {
        const refs = refsByBlock.get(r.id) ?? [];
        if (refs.length === 0) {
          return (
            <Badge bg="secondary" className="bg-opacity-25 text-body-secondary border">
              {t('haproxy:defaults.unused', 'unused')}
            </Badge>
          );
        }
        return (
          <Badge bg="info" title={refs.join(', ')}>
            {t('haproxy:defaults.frontendCount', '{{count}} frontend', { count: refs.length })}
          </Badge>
        );
      },
    },
  ];

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">
              {t('haproxy:defaults.page.title', 'Defaults blocks')}
            </Card.Title>
            <Card.Text className="text-muted small mb-0">
              {t(
                'haproxy:defaults.page.description',
                'Named defaults NAME { … } sections. Each frontend picks one via from. HAProxy 2.4+.'
              )}
            </Card.Text>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNew(true)}
            disabled={saving || !onSave}
          >
            {t('haproxy:defaults.add', 'Add defaults block')}
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            {t('haproxy:common.saveFailed', 'Save failed')}: {saveError.message}
          </Alert>
        ) : null}
        {blocks.length === 0 ? (
          <Alert variant="info" className="small mb-0">
            {t(
              'haproxy:defaults.empty',
              'No defaults blocks yet. You need at least one before adding any frontend.'
            )}
          </Alert>
        ) : (
          <ReorderableTable
            rows={blocks}
            rowKey={r => r.id}
            columns={columns}
            searchFields={['name', 'id', 'mode']}
            filterPlaceholder={t('haproxy:defaults.filterPlaceholder', 'Filter by name, id, mode…')}
            RowActions={RowActions}
            rowActionsContext={{ saving, onSave, setEditing, setDeleting, refsByBlock }}
            emptyFilteredState={t(
              'haproxy:defaults.emptyFiltered',
              'No defaults blocks match the current filter.'
            )}
          />
        )}
      </Card.Body>
      {showNew ? (
        <DefaultsBlockEditModal
          show
          doc={doc}
          onSave={handleAdd}
          onCancel={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <DefaultsBlockEditModal
          show
          block={editing}
          doc={doc}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title={t('haproxy:defaults.deleteConfirm.title', 'Delete defaults block?')}
          body={
            <>
              {t('haproxy:defaults.deleteConfirm.body', 'Delete')} <code>{deleting.name}</code> (
              {deleting.id})?
            </>
          }
          confirmLabel={t('common:buttons.delete', 'Delete')}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

DefaultsPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
