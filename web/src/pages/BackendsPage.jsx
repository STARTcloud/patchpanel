import { useEffect, useRef, useState } from 'react';
import { Button, Card, Form, InputGroup, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { BackendEditModal } from '../components/BackendEditModal.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { SortableHeader } from '../components/SortableHeader.jsx';
import { useTableControls } from '../hooks/useTableControls.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const BackendsPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusedRowRef = useRef(null);

  useEffect(() => {
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId]);

  const controls = useTableControls(doc?.backends ?? [], {
    searchFields: [
      'name',
      'id',
      'mode',
      'balance',
      row => row.servers?.map(s => `${s.name} ${s.address}`).join(' ') ?? '',
    ],
    initialSort: { field: 'name', direction: 'asc' },
  });

  if (!doc) {
    return null;
  }

  const persist = async nextBackends => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...doc, backends: nextBackends });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = backend => {
    setShowNew(false);
    persist([...doc.backends, backend]);
  };

  const handleUpdate = backend => {
    setEditing(null);
    persist(doc.backends.map(b => (b.id === backend.id ? backend : b)));
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(doc.backends.filter(b => b.id !== id));
  };

  const handleClone = backend => {
    const existingIds = new Set(doc.backends.map(b => b.id));
    let candidate = `${backend.id}-copy`;
    let suffix = 1;
    while (existingIds.has(candidate)) {
      suffix += 1;
      candidate = `${backend.id}-copy-${suffix}`;
    }
    const cloned = { ...backend, id: candidate, name: candidate };
    persist([...doc.backends, cloned]);
  };

  const isInUse = backendId => {
    for (const fe of doc.frontends ?? []) {
      for (const rule of fe.rulePhases?.httpRequest ?? []) {
        if (rule.action?.type === 'use-backend' && rule.action.backendId === backendId) {
          return true;
        }
      }
      if (fe.httpOpts?.defaultBackendId === backendId) {
        return true;
      }
      if (fe.tcpOpts?.defaultBackendId === backendId) {
        return true;
      }
      for (const m of fe.tcpOpts?.sniRouter?.sniMap ?? []) {
        if (m.backendId === backendId) {
          return true;
        }
      }
    }
    return false;
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <Card.Title className="mb-0">{t('haproxy:backend.page.title', 'Backends')}</Card.Title>
          <div className="d-flex gap-2 align-items-center">
            <InputGroup size="sm" style={{ width: '20rem' }}>
              <InputGroup.Text>
                <i className="bi bi-search" />
              </InputGroup.Text>
              <Form.Control
                placeholder={t(
                  'haproxy:backend.filterPlaceholder',
                  'Filter by name, id, mode, server…'
                )}
                value={controls.search}
                onChange={e => controls.setSearch(e.target.value)}
              />
              {controls.search ? (
                <Button variant="outline-secondary" onClick={() => controls.setSearch('')}>
                  ×
                </Button>
              ) : null}
            </InputGroup>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNew(true)}
              disabled={saving || !onSave}
            >
              {t('haproxy:backend.add', 'Add backend')}
            </Button>
          </div>
        </div>
        <Card.Text className="text-muted">
          {t('haproxy:backend.summary', '{{shown}} of {{total}} backends shown.', {
            shown: controls.view.length,
            total: doc.backends.length,
          })}{' '}
          {saving ? t('common:status.saving', 'Saving…') : null}
          {saveError ? (
            <span className="text-danger">
              {t('haproxy:common.saveFailed', 'Save failed')}: {saveError.message}
            </span>
          ) : null}
        </Card.Text>
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <SortableHeader
                label={t('haproxy:backend.columns.name', 'Name')}
                field="name"
                sort={controls.sort}
                onToggle={controls.toggleSort}
              />
              <SortableHeader
                label={t('haproxy:backend.columns.mode', 'Mode')}
                field="mode"
                sort={controls.sort}
                onToggle={controls.toggleSort}
              />
              <SortableHeader
                label={t('haproxy:backend.columns.balance', 'Balance')}
                field="balance"
                sort={controls.sort}
                onToggle={controls.toggleSort}
              />
              <th>{t('haproxy:backend.columns.servers', 'Servers')}</th>
              <th className="text-end">{t('haproxy:common.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {controls.view.map(backend => {
              const isFocused = focusId === backend.id;
              return (
                <tr
                  key={backend.id}
                  ref={isFocused ? focusedRowRef : null}
                  className={isFocused ? 'table-warning' : undefined}
                >
                  <td>
                    <code>{backend.name}</code>
                  </td>
                  <td>{backend.mode}</td>
                  <td>{backend.balance}</td>
                  <td>
                    <ul className="list-unstyled mb-0">
                      {backend.servers.map(server => (
                        <li key={server.name}>
                          <code>
                            {server.name} {server.address}
                            {server.ssl ? ' (ssl)' : ''}
                            {server.backup ? ' (backup)' : ''}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="text-end text-nowrap">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="me-1"
                      onClick={() => setEditing(backend)}
                      disabled={saving || !onSave}
                    >
                      {t('common:buttons.edit', 'Edit')}
                    </Button>
                    <Button
                      variant="outline-info"
                      size="sm"
                      className="me-1"
                      onClick={() => handleClone(backend)}
                      disabled={saving || !onSave}
                      title={t(
                        'haproxy:backend.actions.cloneTitle',
                        'Duplicate this backend with a fresh id/name. Useful when several vhosts share the same upstream pool but you want per-vhost stats rows.'
                      )}
                    >
                      {t('haproxy:backend.actions.clone', 'Clone')}
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setDeleting(backend)}
                      disabled={saving || !onSave || isInUse(backend.id)}
                      title={
                        isInUse(backend.id)
                          ? t(
                              'haproxy:backend.actions.inUseTitle',
                              'In use by at least one rule, default_backend, or SNI mapping; remove the reference first.'
                            )
                          : ''
                      }
                    >
                      {t('common:buttons.delete', 'Delete')}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {controls.view.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-muted small py-3">
                  {t('haproxy:backend.emptyFiltered', 'No backends match the current filter.')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card.Body>
      {showNew ? (
        <BackendEditModal
          show
          trustedCas={doc.trustedCas ?? []}
          onSave={handleAdd}
          onCancel={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <BackendEditModal
          show
          backend={editing}
          trustedCas={doc.trustedCas ?? []}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title={t('haproxy:backend.deleteConfirm.title', 'Delete backend?')}
          body={
            <>
              {t('haproxy:backend.deleteConfirm.body', 'Delete backend')}{' '}
              <strong>{deleting.name}</strong> ({deleting.id})?{' '}
              {t('haproxy:backend.deleteConfirm.note', 'This change applies immediately on save.')}
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

BackendsPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
