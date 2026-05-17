import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Modal, Spinner, Table } from 'react-bootstrap';

import { apiGet } from '../api/client.js';
import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { HTTP_ERRORS_SECTIONS_SECTION } from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const EditOverrideModal = ({ editing, saving, onChange, onSave, onCancel }) => (
  <Modal show onHide={onCancel} size="xl" backdrop="static">
    <Modal.Header closeButton>
      <Modal.Title className="d-flex align-items-center gap-2">
        <Badge bg="secondary">{editing.code}</Badge>
        <span>override in defaults block</span>
        <code>{editing.blockId}</code>
      </Modal.Title>
    </Modal.Header>
    <Modal.Body>
      <details className="mb-3">
        <summary className="small text-muted">Bundled template (read-only reference)</summary>
        <pre
          className="small mt-2 p-2 bg-body-tertiary border"
          style={{ whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto' }}
        >
          {editing.template || '(no bundled template on disk for this code)'}
        </pre>
      </details>
      <Form.Group>
        <Form.Label>Override body</Form.Label>
        <Form.Control
          as="textarea"
          rows={14}
          value={editing.content}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
          placeholder="Leave empty to fall back to the bundled template."
        />
        <Form.Text className="text-muted">
          On save, the server writes this body to{' '}
          <code>{`{haproxyErrorPagesDir}/{blockId}/{code}.http`}</code> and points the defaults
          block&apos;s <code>errorFiles[{editing.code}]</code> at the new file. Clearing the
          textarea removes the override.
        </Form.Text>
      </Form.Group>
    </Modal.Body>
    <Modal.Footer>
      <Button variant="outline-secondary" onClick={() => onChange('')} disabled={saving}>
        Clear (use bundled)
      </Button>
      <Button variant="secondary" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => onSave(editing)} disabled={saving}>
        {saving ? (
          <>
            <Spinner as="span" size="sm" animation="border" /> Saving…
          </>
        ) : (
          'Save'
        )}
      </Button>
    </Modal.Footer>
  </Modal>
);

EditOverrideModal.propTypes = {
  editing: PropTypes.shape({
    blockId: PropTypes.string.isRequired,
    code: PropTypes.string.isRequired,
    content: PropTypes.string.isRequired,
    template: PropTypes.string,
  }).isRequired,
  saving: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

const PerStatusOverridesCard = ({ doc, onSave }) => {
  const [pages, setPages] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let active = true;
    apiGet('api/error-pages')
      .then(payload => {
        if (active) {
          setPages(payload?.pages ?? []);
        }
      })
      .catch(err => {
        if (active) {
          setFetchError(err);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const blocks = doc.defaultsBlocks ?? [];

  const persistEdit = async ({ blockId, code, content }) => {
    setSaving(true);
    setSaveError(null);
    try {
      const nextBlocks = blocks.map(b => {
        if (b.id !== blockId) {
          return b;
        }
        const nextContents = { ...(b.errorPageContents ?? {}) };
        if (content && content.trim().length > 0) {
          nextContents[code] = content;
        } else {
          delete nextContents[code];
        }
        return { ...b, errorPageContents: nextContents };
      });
      await onSave({ ...doc, defaultsBlocks: nextBlocks });
      setEditing(null);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>Per-status template overrides</Card.Title>
        <Card.Text className="text-muted small">
          The 19 canonical HTTP status codes. Each row shows the current path emitted into{' '}
          <code>haproxy.cfg</code> for this defaults block, whether a custom body override is set,
          and an Edit button that opens the bundled template plus an editor for the override body.
        </Card.Text>
        {fetchError ? (
          <Alert variant="warning" className="small">
            Bundled templates unavailable: {fetchError.message}
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="danger" dismissible onClose={() => setSaveError(null)}>
            Save failed: {saveError.message}
          </Alert>
        ) : null}
        {!pages && !fetchError ? (
          <div className="d-flex align-items-center gap-2 small text-muted py-2">
            <Spinner as="span" animation="border" size="sm" /> Loading bundled templates…
          </div>
        ) : null}
        {pages && blocks.length === 0 ? (
          <Alert variant="info" className="small mb-0">
            No defaults blocks yet. Add one on the Defaults page first.
          </Alert>
        ) : null}
        {pages
          ? blocks.map(block => (
              <div key={block.id} className="mb-3">
                <h6 className="mt-3 mb-2">
                  Defaults block <code>{block.name}</code>
                </h6>
                <Table size="sm" responsive striped className="mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: '4rem' }}>Code</th>
                      <th>Path</th>
                      <th style={{ width: '7rem' }}>Override</th>
                      <th className="text-end" style={{ width: '6rem' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(page => {
                      const path = block.errorFiles?.[page.code];
                      const hasOverride = Boolean(block.errorPageContents?.[page.code]);
                      return (
                        <tr key={page.code}>
                          <td>
                            <Badge bg="secondary">{page.code}</Badge>
                          </td>
                          <td className="small font-monospace text-muted">
                            {path ?? <em>not set</em>}
                          </td>
                          <td>
                            {hasOverride ? (
                              <Badge bg="success">custom</Badge>
                            ) : (
                              <Badge
                                bg="secondary"
                                className="bg-opacity-25 text-body-secondary border"
                              >
                                bundled
                              </Badge>
                            )}
                          </td>
                          <td className="text-end">
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() =>
                                setEditing({
                                  blockId: block.id,
                                  code: page.code,
                                  content: block.errorPageContents?.[page.code] ?? '',
                                  template: page.template,
                                })
                              }
                            >
                              Edit
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ))
          : null}
      </Card.Body>
      {editing ? (
        <EditOverrideModal
          editing={editing}
          saving={saving}
          onChange={next => setEditing({ ...editing, content: next })}
          onSave={persistEdit}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </Card>
  );
};

PerStatusOverridesCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};

export const ErrorPagesPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>Error pages</Card.Title>
          <Card.Text className="text-muted small mb-0">
            Two HAProxy mechanisms in one place: the <strong>per-status overrides</strong> below
            edit each defaults block&apos;s <code>errorPageContents</code> map (the actual response
            bodies served on 4xx/5xx); the <strong>Error pages sections</strong> at the bottom
            define named <code>http-errors NAME</code> bundles that frontends and defaults blocks
            can reference via <code>useErrorFilesId</code>.
          </Card.Text>
        </Card.Body>
      </Card>
      {onSave ? <PerStatusOverridesCard doc={doc} onSave={onSave} /> : null}
      {onSave ? (
        <EntitySectionCard doc={doc} onSave={onSave} section={HTTP_ERRORS_SECTIONS_SECTION} />
      ) : (
        <Alert variant="warning">State save unavailable.</Alert>
      )}
    </>
  );
};

ErrorPagesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
