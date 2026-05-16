import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Tab, Tabs } from 'react-bootstrap';

import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { ReorderableTable } from '../components/ReorderableTable.jsx';
import { RuleEditModal } from '../components/RuleEditModal.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const PHASES = Object.freeze([
  { key: 'tcpRequestConnection', label: 'tcp-request connection' },
  { key: 'tcpRequestSession', label: 'tcp-request session' },
  { key: 'tcpRequestContent', label: 'tcp-request content' },
  { key: 'httpRequest', label: 'http-request' },
  { key: 'httpResponse', label: 'http-response' },
  { key: 'httpAfterResponse', label: 'http-after-response' },
  { key: 'tcpResponseContent', label: 'tcp-response content' },
]);

const renderTermPreview = term => {
  if (term.kind === 'aclRef') {
    return term.negate ? `!${term.aclName}` : term.aclName;
  }
  const parts = [];
  let f = term.field;
  if (term.fieldArg) {
    f += `(${term.fieldArg})`;
  }
  parts.push(f);
  if (term.operator && term.operator !== 'bool') {
    parts.push(`-m ${term.operator}`);
  }
  if (term.caseInsensitive) {
    parts.push('-i');
  }
  if (term.noDnsLookup) {
    parts.push('-n');
  }
  if (term.values && term.values.length > 0) {
    parts.push(...term.values);
  }
  const body = `{ ${parts.join(' ')} }`;
  return term.negate ? `!${body}` : body;
};

const renderConditionPreview = condition => {
  if (!condition || condition.length === 0) {
    return '';
  }
  let out = renderTermPreview(condition[0]);
  for (let i = 1; i < condition.length; i += 1) {
    const join = condition[i - 1].combineWithNext === 'or' ? ' || ' : ' ';
    out += join + renderTermPreview(condition[i]);
  }
  return out;
};

const summarizeAction = action => {
  switch (action.type) {
    case 'use-backend':
      return `use_backend ${action.backendId}`;
    case 'use-service':
      return `use-service ${action.serviceName}`;
    case 'redirect':
      return `redirect ${action.redirectType} ${action.target}`;
    case 'set-header':
    case 'add-header':
      return `${action.type} ${action.name} = ${action.value}`;
    case 'del-header':
      return `del-header ${action.name}`;
    case 'set-var':
      return `set-var(${action.scope}.${action.name}) ${action.expression}`;
    case 'lua':
      return `lua.${action.function}(${(action.args ?? []).join(', ')})`;
    case 'deny':
      return action.statusCode ? `deny ${action.statusCode}` : 'deny';
    case 'apply-security-profile':
      return `apply security-profile ${action.profileId}`;
    case 'apply-auth-provider':
      return `apply auth-provider ${action.providerId}`;
    default:
      return action.type;
  }
};

const RowActions = ({ row, ctx }) => (
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

RowActions.propTypes = {
  row: PropTypes.object.isRequired,
  ctx: PropTypes.object.isRequired,
};

const PhaseTabPanel = ({ phase, doc, frontend, onSaveFrontend, saving }) => {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const rules = frontend.rulePhases?.[phase] ?? [];

  const persistRules = nextRules => {
    const nextFrontend = {
      ...frontend,
      rulePhases: { ...(frontend.rulePhases ?? {}), [phase]: nextRules },
    };
    onSaveFrontend(nextFrontend);
  };

  const handleAdd = rule => {
    setShowNew(false);
    persistRules([...rules, rule]);
  };

  const handleUpdate = rule => {
    setEditing(null);
    persistRules(rules.map(r => (r.id === rule.id ? rule : r)));
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persistRules(rules.filter(r => r.id !== id));
  };

  const handleReorder = nextRows => persistRules(nextRows);

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: r => (
        <div>
          <code className="small">{r.name ?? r.id}</code>
          {r.enabled === false ? (
            <Badge bg="secondary" className="ms-1">
              disabled
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      render: r => <code className="small">{summarizeAction(r.action)}</code>,
    },
    {
      key: 'condition',
      label: 'Condition',
      render: r => {
        const preview = renderConditionPreview(r.condition);
        return preview ? (
          <code className="small">if {preview}</code>
        ) : (
          <span className="text-muted small">(always)</span>
        );
      },
    },
  ];

  return (
    <div className="pt-3">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div className="text-muted small">
          Rules evaluate top-to-bottom. First terminating match wins for actions like{' '}
          <code>deny</code>, <code>redirect</code>, <code>use-backend</code>. Non-terminating
          actions (<code>set-header</code>, <code>set-var</code>) all run in order.
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowNew(true)} disabled={saving}>
          <i className="bi bi-plus-lg me-1" />
          Add rule
        </Button>
      </div>
      <ReorderableTable
        rows={rules}
        rowKey={r => r.id}
        columns={columns}
        searchFields={['id', 'name', row => row.action?.type, row => summarizeAction(row.action)]}
        filterPlaceholder="Filter rules…"
        positionLabel="Order"
        reorderable
        onReorder={handleReorder}
        RowActions={RowActions}
        rowActionsContext={{ saving, onSave: onSaveFrontend, setEditing, setDeleting }}
        emptyState={
          <>
            No rules in this phase. Click <strong>Add rule</strong> to create one.
          </>
        }
        emptyFilteredState="No rules match the current filter."
      />
      {showNew ? (
        <RuleEditModal
          show
          phase={phase}
          doc={doc}
          onSave={handleAdd}
          onCancel={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <RuleEditModal
          show
          phase={phase}
          rule={editing}
          doc={doc}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title="Delete rule?"
          body={
            <>
              Delete rule <code>{deleting.name ?? deleting.id}</code>?
            </>
          }
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
};

PhaseTabPanel.propTypes = {
  phase: PropTypes.string.isRequired,
  doc: PropTypes.object.isRequired,
  frontend: PropTypes.object.isRequired,
  onSaveFrontend: PropTypes.func.isRequired,
  saving: PropTypes.bool.isRequired,
};

const phaseRuleCount = (frontend, phase) => (frontend.rulePhases?.[phase] ?? []).length;

export const RulesPage = ({ doc = null, onSave = null }) => {
  const [selectedFrontendId, setSelectedFrontendId] = useState(null);
  const [activePhase, setActivePhase] = useState('httpRequest');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const frontends = useMemo(() => doc?.frontends ?? [], [doc]);
  const frontend = useMemo(
    () => frontends.find(f => f.id === selectedFrontendId) ?? frontends[0] ?? null,
    [frontends, selectedFrontendId]
  );

  if (!doc) {
    return null;
  }

  const onSaveFrontend = async nextFrontend => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        ...doc,
        frontends: frontends.map(f => (f.id === nextFrontend.id ? nextFrontend : f)),
      });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">Rules</Card.Title>
            <Card.Text className="text-muted small mb-0">
              Per-frontend rule chains, one tab per HAProxy phase. Drag rows to reorder. Phase order
              left-to-right matches HAProxy&apos;s evaluation order.
            </Card.Text>
          </div>
          <div style={{ minWidth: '20rem' }}>
            <Form.Label className="small text-muted mb-1">Frontend</Form.Label>
            <Form.Select
              value={frontend?.id ?? ''}
              onChange={e => setSelectedFrontendId(e.target.value)}
              disabled={frontends.length === 0}
            >
              {frontends.length === 0 ? <option value="">— no frontends —</option> : null}
              {frontends.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.mode})
                </option>
              ))}
            </Form.Select>
          </div>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            Save failed: {saveError.message}
          </Alert>
        ) : null}
        {!frontend ? (
          <Alert variant="info">
            No frontends defined yet. Create a frontend before adding rules.
          </Alert>
        ) : (
          <Tabs
            id="rules-phase-tabs"
            activeKey={activePhase}
            onSelect={k => setActivePhase(k ?? 'httpRequest')}
            className="mb-1"
          >
            {PHASES.map(p => {
              const count = phaseRuleCount(frontend, p.key);
              return (
                <Tab
                  key={p.key}
                  eventKey={p.key}
                  title={
                    <span>
                      {p.label}
                      {count > 0 ? (
                        <Badge bg="info" className="ms-2">
                          {count}
                        </Badge>
                      ) : null}
                    </span>
                  }
                >
                  <PhaseTabPanel
                    phase={p.key}
                    doc={doc}
                    frontend={frontend}
                    onSaveFrontend={onSaveFrontend}
                    saving={saving}
                  />
                </Tab>
              );
            })}
          </Tabs>
        )}
      </Card.Body>
    </Card>
  );
};

RulesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
