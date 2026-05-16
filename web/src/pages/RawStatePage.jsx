import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner } from 'react-bootstrap';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const indent = doc => JSON.stringify(doc, null, 2);

const HINT_VARIANTS = Object.freeze({
  ALERT: { bg: 'danger', text: undefined },
  WARNING: { bg: 'warning', text: 'dark' },
  NOTICE: { bg: 'info', text: undefined },
});

const SECTION_LIST_DEFS = Object.freeze([
  { path: ['backends'], label: 'Backends' },
  { path: ['frontends'], label: 'Frontends' },
  { path: ['defaultsBlocks'], label: 'Defaults blocks' },
  { path: ['acls'], label: 'ACLs' },
  { path: ['authProviders'], label: 'Auth providers' },
  { path: ['acmeAccounts'], label: 'ACME accounts' },
  { path: ['tls', 'providers'], label: 'TLS providers' },
  { path: ['tls', 'certs'], label: 'Certificates' },
  { path: ['notifications', 'channels'], label: 'Notification channels' },
  { path: ['resolvers'], label: 'Resolvers' },
  { path: ['peers'], label: 'Peers' },
  { path: ['mailers'], label: 'Mailers' },
  { path: ['rings'], label: 'Rings' },
  { path: ['crtStores'], label: 'Cert stores' },
  { path: ['maps'], label: 'Maps' },
  { path: ['securityProfiles'], label: 'Security profiles' },
  { path: ['httpErrorsSections'], label: 'Error pages sections' },
]);

const SECTION_OBJECT_DEFS = Object.freeze([
  { path: ['globalSettings'], label: 'Global settings' },
  { path: ['letsencrypt'], label: "Let's Encrypt" },
  { path: ['geoip'], label: 'GeoIP' },
]);

const getByPath = (obj, path) => path.reduce((acc, key) => acc?.[key], obj);

const diffListById = (prev, next) => {
  const prevList = Array.isArray(prev) ? prev : [];
  const nextList = Array.isArray(next) ? next : [];
  const prevById = new Map(prevList.filter(x => x?.id).map(x => [x.id, x]));
  const nextById = new Map(nextList.filter(x => x?.id).map(x => [x.id, x]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, item] of nextById) {
    if (!prevById.has(id)) {
      added.push(id);
    } else if (JSON.stringify(prevById.get(id)) !== JSON.stringify(item)) {
      modified.push(id);
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      removed.push(id);
    }
  }
  return { added, removed, modified };
};

const diffObjectKeys = (prev, next) => {
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})]);
  const modified = [];
  for (const key of keys) {
    if (JSON.stringify(prev?.[key]) !== JSON.stringify(next?.[key])) {
      modified.push(key);
    }
  }
  return { modified };
};

const summarizeStateDiff = (prev, next) => {
  const sections = [];
  for (const def of SECTION_LIST_DEFS) {
    const diff = diffListById(getByPath(prev, def.path), getByPath(next, def.path));
    const total = diff.added.length + diff.removed.length + diff.modified.length;
    if (total > 0) {
      sections.push({ label: def.label, kind: 'list', ...diff, total });
    }
  }
  for (const def of SECTION_OBJECT_DEFS) {
    const diff = diffObjectKeys(getByPath(prev, def.path), getByPath(next, def.path));
    if (diff.modified.length > 0) {
      sections.push({ label: def.label, kind: 'object', ...diff, total: diff.modified.length });
    }
  }
  return sections;
};

const ValidationHints = ({ hints }) => {
  if (!hints || hints.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 small">
      <strong>Validation hints (from haproxy -c):</strong>
      <ul className="mb-0 ps-3">
        {hints.map(hint => {
          const variant = HINT_VARIANTS[hint.severity] ?? HINT_VARIANTS.NOTICE;
          return (
            <li key={hint.raw}>
              <Badge bg={variant.bg} text={variant.text} className="me-2">
                line {hint.line}
              </Badge>
              {hint.entity ? (
                <code className="me-2">
                  {hint.entity.kind} <strong>{hint.entity.name}</strong>
                </code>
              ) : null}
              <span>{hint.message}</span>
              {hint.ref?.kind === 'backend' ? (
                <span className="ms-2 text-muted">
                  → edit on the <strong>Backends</strong> tab
                </span>
              ) : null}
              {hint.ref?.kind === 'server' ? (
                <span className="ms-2 text-muted">
                  → server <code>{hint.ref.serverName}</code> in backend{' '}
                  <code>{hint.ref.backendId}</code>
                </span>
              ) : null}
              {hint.ref?.kind === 'route' ? (
                <span className="ms-2 text-muted">
                  → edit route <code>{hint.ref.id}</code> on the <strong>Routes</strong> tab
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

ValidationHints.propTypes = {
  hints: PropTypes.arrayOf(
    PropTypes.shape({
      severity: PropTypes.string,
      line: PropTypes.number,
      message: PropTypes.string,
      raw: PropTypes.string.isRequired,
      entity: PropTypes.shape({ kind: PropTypes.string, name: PropTypes.string }),
      ref: PropTypes.object,
    })
  ),
};

const DiffSummary = ({ summary }) => {
  if (summary.length === 0) {
    return (
      <Alert variant="info" className="mb-0">
        No structural changes — saving will only refresh the meta.lastEditedAt timestamp.
      </Alert>
    );
  }
  return (
    <div className="d-flex flex-column gap-2">
      {summary.map(s => (
        <div key={s.label} className="border rounded p-2">
          <strong>{s.label}</strong>{' '}
          <Badge bg="secondary" className="ms-1">
            {s.total} change{s.total === 1 ? '' : 's'}
          </Badge>
          {s.added?.length > 0 ? (
            <div className="small mt-1">
              <Badge bg="success" className="me-2">
                +{s.added.length}
              </Badge>
              added: <code>{s.added.join(', ')}</code>
            </div>
          ) : null}
          {s.removed?.length > 0 ? (
            <div className="small mt-1">
              <Badge bg="danger" className="me-2">
                −{s.removed.length}
              </Badge>
              removed: <code>{s.removed.join(', ')}</code>
            </div>
          ) : null}
          {s.modified?.length > 0 ? (
            <div className="small mt-1">
              <Badge bg="warning" text="dark" className="me-2">
                ~{s.modified.length}
              </Badge>
              modified: <code>{s.modified.join(', ')}</code>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};

DiffSummary.propTypes = {
  summary: PropTypes.array.isRequired,
};

export const RawStatePage = ({ doc = null, onSave = null }) => {
  const [text, setText] = useState(null);
  const [status, setStatus] = useState(null);
  const [pendingApply, setPendingApply] = useState(null);
  const [applying, setApplying] = useState(false);

  if (!doc) {
    return null;
  }

  const current = text ?? indent(doc);

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    let parsed;
    try {
      parsed = JSON.parse(current);
    } catch (err) {
      setStatus({ kind: 'danger', message: `invalid JSON: ${err.message}` });
      return;
    }
    const summary = summarizeStateDiff(doc, parsed);
    setPendingApply({ parsed, summary });
  };

  const apply = () => {
    if (!pendingApply) {
      return;
    }
    setApplying(true);
    onSave(pendingApply.parsed)
      .then(() => {
        setStatus({ kind: 'success', message: 'saved' });
        setText(null);
        setPendingApply(null);
      })
      .catch(err => {
        setStatus({
          kind: 'danger',
          message: err.message,
          issues: err.payload?.issues ?? null,
          output: err.payload?.output ?? null,
          hints: err.payload?.hints ?? null,
        });
        setPendingApply(null);
      })
      .finally(() => setApplying(false));
  };

  const cancelApply = () => {
    if (!applying) {
      setPendingApply(null);
    }
  };

  return (
    <Card className="patchpanel-fullheight-page">
      <Card.Body>
        <Card.Title>Raw State</Card.Title>
        <Card.Text className="text-muted">
          Edit the canonical state.json directly. Saving runs schema validation, renders the new
          haproxy.cfg, validates it with <code>haproxy -c</code>, and reloads HAProxy via the master
          socket on success.
        </Card.Text>
        {status ? (
          <Alert variant={status.kind}>
            <div>{status.message}</div>
            <ValidationHints hints={status.hints} />
            {status.issues ? (
              <pre className="mt-2 mb-0" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                {JSON.stringify(status.issues, null, 2)}
              </pre>
            ) : null}
            {status.output ? (
              <pre className="mt-2 mb-0" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                {status.output}
              </pre>
            ) : null}
          </Alert>
        ) : null}
        <Form
          onSubmit={submit}
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
        >
          <Form.Control
            as="textarea"
            value={current}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
            style={{
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              flex: '1 1 auto',
              minHeight: 0,
              resize: 'none',
            }}
          />
          <div className="mt-3 d-flex gap-2">
            <Button type="submit" variant="primary">
              Review &amp; apply
            </Button>
            <Button type="button" variant="secondary" onClick={() => setText(null)}>
              Discard changes
            </Button>
          </div>
        </Form>
      </Card.Body>
      {pendingApply ? (
        <Modal show onHide={cancelApply} size="lg">
          <Modal.Header closeButton>
            <Modal.Title>Confirm apply</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p className="small text-muted">
              Applying will re-render <code>haproxy.cfg</code>, validate it with{' '}
              <code>haproxy -c</code>, atomically swap, and reload HAProxy via the master socket. On
              reload failure the previous cfg is restored and a snapshot is written either way.
            </p>
            <DiffSummary summary={pendingApply.summary} />
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={cancelApply} disabled={applying}>
              Cancel
            </Button>
            <Button variant="primary" onClick={apply} disabled={applying}>
              {applying ? (
                <>
                  <Spinner as="span" animation="border" size="sm" /> Applying…
                </>
              ) : (
                'Apply'
              )}
            </Button>
          </Modal.Footer>
        </Modal>
      ) : null}
    </Card>
  );
};

RawStatePage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
