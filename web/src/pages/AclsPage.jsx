import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, OverlayTrigger, Popover } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { AclEditModal } from '../components/AclEditModal.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { ReorderableTable } from '../components/ReorderableTable.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const RULE_PHASE_KEYS = Object.freeze([
  'tcpRequestConnection',
  'tcpRequestSession',
  'tcpRequestContent',
  'httpRequest',
  'httpResponse',
  'httpAfterResponse',
  'tcpResponseContent',
]);

const tallyRuleAclRefs = (rule, ruleLocation, counts, refs) => {
  for (const term of rule.condition ?? []) {
    if (term.kind === 'aclRef' && counts.has(term.aclName)) {
      counts.set(term.aclName, counts.get(term.aclName) + 1);
      refs.get(term.aclName).push(ruleLocation);
    }
  }
};

const collectAclRefcounts = doc => {
  const counts = new Map();
  const refs = new Map();
  for (const acl of doc.acls ?? []) {
    counts.set(acl.name, 0);
    refs.set(acl.name, []);
  }
  for (const fe of doc.frontends ?? []) {
    for (const phase of RULE_PHASE_KEYS) {
      for (const rule of fe.rulePhases?.[phase] ?? []) {
        const where = `${fe.name} · ${phase} · ${rule.name ?? rule.id}`;
        tallyRuleAclRefs(rule, where, counts, refs);
      }
    }
  }
  return { counts, refs };
};

const RefcountBadge = ({ count, references }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  if (count === 0) {
    return (
      <Badge bg="secondary" className="bg-opacity-25 text-body-secondary border">
        {t('haproxy:acl.refs.unused', 'unused')}
      </Badge>
    );
  }
  const popover = (
    <Popover>
      <Popover.Header as="h6">
        {t('haproxy:acl.refs.referencedBy', 'Referenced by {{count}} rule', { count })}
      </Popover.Header>
      <Popover.Body className="small">
        <ul className="mb-0 ps-3">
          {references.map(r => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Popover.Body>
    </Popover>
  );
  return (
    <OverlayTrigger placement="left" overlay={popover} trigger={['hover', 'focus']}>
      <Badge bg="info" style={{ cursor: 'help' }}>
        {t('haproxy:acl.refs.ruleCount', '{{count}} rule', { count })}
      </Badge>
    </OverlayTrigger>
  );
};

RefcountBadge.propTypes = {
  count: PropTypes.number.isRequired,
  references: PropTypes.arrayOf(PropTypes.string).isRequired,
};

const renderExprSummary = acl => {
  const parts = [acl.fieldArg ? `${acl.field}(${acl.fieldArg})` : acl.field];
  if (acl.operator && acl.operator !== 'bool') {
    parts.push(`-m ${acl.operator}`);
  }
  if (acl.caseInsensitive) {
    parts.push('-i');
  }
  if (acl.noDnsLookup) {
    parts.push('-n');
  }
  if (acl.values && acl.values.length > 0) {
    parts.push(...acl.values.slice(0, 3));
    if (acl.values.length > 3) {
      parts.push(`(+${acl.values.length - 3})`);
    }
  }
  return parts.join(' ');
};

const RowActions = ({ row, ctx }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const refCount = ctx.refcounts.counts.get(row.name) ?? 0;
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
        disabled={ctx.saving || !ctx.onSave || refCount > 0}
        title={
          refCount > 0
            ? t(
                'haproxy:acl.actions.deleteBlocked',
                'Referenced by {{count}} rule(s); detach them first.',
                {
                  count: refCount,
                }
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

export const AclsPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const refcounts = useMemo(() => collectAclRefcounts(doc ?? { acls: [], frontends: [] }), [doc]);

  if (!doc) {
    return null;
  }
  const acls = doc.acls ?? [];

  const persist = async nextAcls => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...doc, acls: nextAcls });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = acl => {
    setShowNew(false);
    persist([...acls, acl]);
  };

  const handleUpdate = acl => {
    setEditing(null);
    persist(acls.map(a => (a.id === acl.id ? acl : a)));
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(acls.filter(a => a.id !== id));
  };

  const columns = [
    {
      key: 'name',
      label: t('haproxy:acl.columns.name', 'Name'),
      sortable: true,
      accessor: r => r.name,
      render: r => (
        <div>
          <code>{r.name}</code>
          {r.description ? <div className="text-muted small">{r.description}</div> : null}
        </div>
      ),
    },
    {
      key: 'expression',
      label: t('haproxy:acl.columns.expression', 'Expression'),
      render: r => <code className="small">{renderExprSummary(r)}</code>,
    },
    {
      key: 'refs',
      label: t('haproxy:acl.columns.usedBy', 'Used by'),
      sortable: true,
      accessor: r => refcounts.counts.get(r.name) ?? 0,
      render: r => (
        <RefcountBadge
          count={refcounts.counts.get(r.name) ?? 0}
          references={refcounts.refs.get(r.name) ?? []}
        />
      ),
      className: 'text-center',
    },
  ];

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">{t('haproxy:acl.page.title', 'ACLs')}</Card.Title>
            <Card.Text className="text-muted small mb-0">
              {t(
                'haproxy:acl.page.description',
                'Reusable named matchers. Reference them by name from any rule condition; the renderer emits an acl NAME … line at the top of every frontend body that uses it.'
              )}
            </Card.Text>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowNew(true)}
            disabled={saving || !onSave}
          >
            {t('haproxy:acl.add', 'Add ACL')}
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            {t('haproxy:common.saveFailed', 'Save failed')}: {saveError.message}
          </Alert>
        ) : null}
        <ReorderableTable
          rows={acls}
          rowKey={r => r.id}
          columns={columns}
          searchFields={['name', 'id', 'field', 'fieldArg', 'description']}
          filterPlaceholder={t(
            'haproxy:acl.filterPlaceholder',
            'Filter by name, field, description…'
          )}
          RowActions={RowActions}
          rowActionsContext={{ saving, onSave, setEditing, setDeleting, refcounts }}
          emptyState={t(
            'haproxy:acl.empty',
            'No ACLs yet. Add one before referencing it from a rule.'
          )}
          emptyFilteredState={t('haproxy:acl.emptyFiltered', 'No ACLs match the current filter.')}
        />
      </Card.Body>
      {showNew ? <AclEditModal show onSave={handleAdd} onCancel={() => setShowNew(false)} /> : null}
      {editing ? (
        <AclEditModal show acl={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title={t('haproxy:acl.deleteConfirm.title', 'Delete ACL?')}
          body={
            <>
              {t('haproxy:acl.deleteConfirm.body', 'Delete ACL')} <code>{deleting.name}</code>?
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

AclsPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
