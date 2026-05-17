import PropTypes from 'prop-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Spinner,
  Table,
  ToggleButton,
} from 'react-bootstrap';

import { apiGet } from '../api/client.js';
import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { ErrorPagePreview } from '../components/ErrorPagePreview.jsx';
import { TokenReferencePanel } from '../components/TokenReferencePanel.jsx';
import { HTTP_ERRORS_SECTIONS_SECTION } from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const EDIT_MODES = Object.freeze([
  { value: 'raw', label: 'Raw .http (errorfile)' },
  { value: 'lf', label: 'Log-format (lf-file)' },
]);

const PREVIEW_MODES = Object.freeze([
  { value: 'override', label: 'Override' },
  { value: 'bundled', label: 'Bundled' },
  { value: 'both', label: 'Side-by-side' },
]);

const VIEWPORT_OPTIONS = Object.freeze([
  { value: 'desktop', label: 'Desktop', icon: 'display' },
  { value: 'tablet', label: 'Tablet', icon: 'tablet' },
  { value: 'mobile', label: 'Mobile', icon: 'phone' },
]);

const THEME_OPTIONS = Object.freeze([
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon-stars' },
]);

// Mock values for HAProxy log-format tokens. The preview engine replaces
// `%[token]` occurrences inline so users can see how `%[unique-id]`,
// `%[hdr(host)]`, etc. will render once HAProxy populates them. Note that
// HAProxy itself does NOT expand log-format tokens in static errorfile
// bodies — for real expansion you need `http-response set-header` /
// `http-after-response` directives or Lua. This panel mocks them so users
// can iterate on the look of their template.
const buildDefaultPreviewVars = code => ({
  status: code,
  'unique-id': '7f3a1d5e:b04c:00000000:0000:00000000',
  'req.id': 'req-9e9c0ad1-4f6e-4b6e-a4f8-2c8d11f3c0f1',
  'txn.request_id': 'req-9e9c0ad1-4f6e-4b6e-a4f8-2c8d11f3c0f1',
  'var(txn.request_id)': 'req-9e9c0ad1-4f6e-4b6e-a4f8-2c8d11f3c0f1',
  request_id: 'req-9e9c0ad1-4f6e-4b6e-a4f8-2c8d11f3c0f1',
  src: '192.0.2.42',
  'hdr(host)': 'example.com',
  host: 'example.com',
  'hdr(user-agent)': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  path: '/some/path',
  url: '/some/path',
  method: 'GET',
  date: new Date().toISOString(),
  ssl_fc_protocol: 'TLSv1.3',
  ssl_fc_cipher: 'TLS_AES_128_GCM_SHA256',
  ssl_fc_sni: 'example.com',
  fe_name: 'fe_main',
  be_name: 'be_app',
  srv_name: 'app-01',
});

const SegmentedToggle = ({ name, options, value, onChange, size = 'sm' }) => (
  <ButtonGroup size={size}>
    {options.map(opt => (
      <ToggleButton
        key={opt.value}
        id={`${name}-${opt.value}`}
        type="radio"
        variant={value === opt.value ? 'primary' : 'outline-secondary'}
        name={name}
        value={opt.value}
        checked={value === opt.value}
        onChange={e => onChange(e.currentTarget.value)}
      >
        {opt.icon ? <i className={`bi bi-${opt.icon} me-1`} /> : null}
        {opt.label}
      </ToggleButton>
    ))}
  </ButtonGroup>
);

SegmentedToggle.propTypes = {
  name: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.string,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  size: PropTypes.string,
};

const PreviewVariablesEditor = ({ variables, onChange }) => {
  const entries = Object.entries(variables);
  const setToken = (oldKey, newKey, value) => {
    const next = { ...variables };
    delete next[oldKey];
    if (newKey.length > 0) {
      next[newKey] = value;
    }
    onChange(next);
  };
  const removeToken = key => {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  };
  const addToken = () => {
    let candidate = 'newvar';
    let n = 1;
    while (Object.hasOwn(variables, candidate)) {
      n += 1;
      candidate = `newvar${n}`;
    }
    onChange({ ...variables, [candidate]: '' });
  };
  return (
    <details className="mt-3">
      <summary className="small text-muted">
        Preview variables ({entries.length}) — replaces <code>%[token]</code> in the preview only
      </summary>
      <Table size="sm" className="mt-2 mb-2 small">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>Token</th>
            <th>Mock value</th>
            <th style={{ width: '2.5rem' }} />
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td>
                <Form.Control
                  size="sm"
                  type="text"
                  value={key}
                  onChange={e => setToken(key, e.target.value, value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
                />
              </td>
              <td>
                <Form.Control
                  size="sm"
                  type="text"
                  value={value}
                  onChange={e => setToken(key, key, e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
                />
              </td>
              <td className="text-end">
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={() => removeToken(key)}
                  title="Remove this token"
                >
                  ×
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Button variant="outline-secondary" size="sm" onClick={addToken}>
        <i className="bi bi-plus-lg me-1" />
        Add variable
      </Button>
      <Form.Text className="text-muted d-block mt-1">
        Examples: <code>unique-id</code>, <code>hdr(host)</code>, <code>var(txn.request_id)</code>,{' '}
        <code>ssl_fc_protocol</code>. HAProxy itself does not expand these in static errorfile
        bodies — for real expansion you need <code>http-response set-header</code> /{' '}
        <code>http-after-response</code> directives or Lua. This panel mocks them so you can iterate
        on the look of your template.
      </Form.Text>
    </details>
  );
};

PreviewVariablesEditor.propTypes = {
  variables: PropTypes.objectOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
};

const renderPreviewPane = ({ mode, override, bundled, variables, viewport, theme }) => {
  if (mode === 'override') {
    return (
      <ErrorPagePreview
        source={override}
        title="override preview"
        height="24rem"
        variables={variables}
        viewport={viewport}
        theme={theme}
      />
    );
  }
  if (mode === 'bundled') {
    return (
      <ErrorPagePreview
        source={bundled}
        title="bundled preview"
        height="24rem"
        variables={variables}
        viewport={viewport}
        theme={theme}
      />
    );
  }
  return (
    <Row className="g-2">
      <Col md={6}>
        <div className="small fw-semibold text-muted text-uppercase mb-1">Override</div>
        <ErrorPagePreview
          source={override}
          title="override preview"
          height="22rem"
          variables={variables}
          viewport={viewport}
          theme={theme}
        />
      </Col>
      <Col md={6}>
        <div className="small fw-semibold text-muted text-uppercase mb-1">Bundled</div>
        <ErrorPagePreview
          source={bundled}
          title="bundled preview"
          height="22rem"
          variables={variables}
          viewport={viewport}
          theme={theme}
        />
      </Col>
    </Row>
  );
};

const MODE_HELP = Object.freeze({
  raw: (
    <>
      Served byte-for-byte via <code>errorfile</code>. HAProxy does NOT expand <code>%[token]</code>{' '}
      tokens here — what you type is what hits the wire. Written to{' '}
      <code>{'{haproxyErrorPagesDir}/{blockId}/{code}.http'}</code>.
    </>
  ),
  lf: (
    <>
      Served via <code>http-error … lf-file</code>. HAProxy <strong>does</strong> expand log-format
      tokens like <code>%[unique-id]</code>, <code>%[var(txn.x)]</code>, <code>%[hdr(host)]</code>,{' '}
      <code>%[src]</code> at request time. Written to{' '}
      <code>{'{haproxyErrorPagesDir}/{blockId}/lf/{code}.html'}</code>; the matching{' '}
      <code>http-error status {'{code}'}</code> directive is auto-injected on save.
    </>
  ),
});

const EditOverrideModal = ({ editing, doc, saving, onChange, onSave, onCancel }) => {
  const [editMode, setEditMode] = useState(() =>
    editing.lf.content.length > 0 && editing.raw.content.length === 0 ? 'lf' : 'raw'
  );
  const [previewMode, setPreviewMode] = useState('override');
  const [viewport, setViewport] = useState('desktop');
  const [iframeTheme, setIframeTheme] = useState('light');
  const [variables, setVariables] = useState(() => buildDefaultPreviewVars(editing.code));
  const textareaRef = useRef(null);

  const bundled = editing.template ?? '';
  const activeContent = editing[editMode].content;
  const effectivePreviewMode = activeContent.length === 0 ? 'bundled' : previewMode;

  // Insert at cursor (or replace selection) — keeps the textarea focused with
  // the caret immediately after the inserted token so users can keep typing.
  const insertAtCursor = useCallback(
    token => {
      const el = textareaRef.current;
      const current = editing[editMode].content;
      if (!el) {
        onChange(editMode, current + token);
        return;
      }
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      onChange(editMode, next);
      // Restore focus + caret on the next paint, after React re-renders the
      // textarea with the new value.
      requestAnimationFrame(() => {
        const after = textareaRef.current;
        if (!after) {
          return;
        }
        after.focus();
        const caret = start + token.length;
        try {
          after.setSelectionRange(caret, caret);
        } catch {
          // Some browsers throw on programmatic setSelectionRange when the
          // element isn't focusable yet; non-fatal.
        }
      });
    },
    [editMode, editing, onChange]
  );

  return (
    <Modal show onHide={onCancel} size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          <Badge bg="secondary">{editing.code}</Badge>
          <span>override in defaults block</span>
          <code>{editing.blockId}</code>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-3">
          <SegmentedToggle
            name="error-edit-mode"
            options={EDIT_MODES}
            value={editMode}
            onChange={setEditMode}
          />
        </div>
        <Row className="g-3">
          <Col lg={6}>
            <Form.Group>
              <Form.Label className="d-flex justify-content-between align-items-center">
                <span>{editMode === 'lf' ? 'Log-format body' : 'Raw response body'}</span>
                {editMode === 'raw' ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => onChange('raw', bundled)}
                    disabled={saving || !bundled}
                    title="Load the bundled .http template into the editor as a starting point"
                  >
                    <i className="bi bi-arrow-counterclockwise me-1" />
                    Load bundled
                  </Button>
                ) : null}
              </Form.Label>
              <Form.Control
                as="textarea"
                ref={textareaRef}
                rows={20}
                value={activeContent}
                onChange={e => onChange(editMode, e.target.value)}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                placeholder={
                  editMode === 'lf'
                    ? '<!doctype html>\n<html>...\n<p>Unique ID: %[unique-id]</p>\n...'
                    : 'HTTP/1.0 503 Service Unavailable\nCache-Control: no-cache\nContent-Type: text/html\n\n<html>...'
                }
              />
              <Form.Text className="text-muted">{MODE_HELP[editMode]} Clear to remove.</Form.Text>
            </Form.Group>
            {editMode === 'lf' ? (
              <TokenReferencePanel
                body={activeContent}
                doc={doc}
                blockId={editing.blockId}
                onInsert={insertAtCursor}
              />
            ) : null}
          </Col>
          <Col lg={6}>
            <div className="d-flex flex-wrap justify-content-between align-items-center mb-2 gap-2">
              <Form.Label className="mb-0">Live preview</Form.Label>
              <SegmentedToggle
                name="error-preview-mode"
                options={PREVIEW_MODES}
                value={effectivePreviewMode}
                onChange={setPreviewMode}
              />
            </div>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2 small">
              <span className="text-muted">Viewport</span>
              <SegmentedToggle
                name="error-preview-viewport"
                options={VIEWPORT_OPTIONS}
                value={viewport}
                onChange={setViewport}
              />
              <span className="text-muted ms-2">Theme</span>
              <SegmentedToggle
                name="error-preview-theme"
                options={THEME_OPTIONS}
                value={iframeTheme}
                onChange={setIframeTheme}
              />
            </div>
            {renderPreviewPane({
              mode: effectivePreviewMode,
              override: activeContent,
              bundled,
              variables,
              viewport,
              theme: iframeTheme,
            })}
            <Form.Text className="text-muted d-block mt-2">
              {editMode === 'lf' ? (
                <>
                  Token expansion is <strong>real</strong> in this mode — the values below model
                  what HAProxy will substitute at serve time.
                </>
              ) : (
                <>
                  Tokens are mocked for the preview only. In raw mode HAProxy serves the file
                  byte-for-byte; tokens would render as literal text in production.
                </>
              )}
            </Form.Text>
            <PreviewVariablesEditor variables={variables} onChange={setVariables} />
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline-secondary"
          onClick={() => onChange(editMode, '')}
          disabled={saving}
        >
          Clear ({editMode === 'lf' ? 'lf-file' : 'raw'})
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
};

EditOverrideModal.propTypes = {
  editing: PropTypes.shape({
    blockId: PropTypes.string.isRequired,
    code: PropTypes.string.isRequired,
    template: PropTypes.string,
    raw: PropTypes.shape({ content: PropTypes.string.isRequired }).isRequired,
    lf: PropTypes.shape({ content: PropTypes.string.isRequired }).isRequired,
  }).isRequired,
  doc: stateDocShape.isRequired,
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

  const updateCodeMap = (map, code, content) => {
    const next = { ...(map ?? {}) };
    if (content && content.trim().length > 0) {
      next[code] = content;
    } else {
      delete next[code];
    }
    return next;
  };

  const persistEdit = async edited => {
    setSaving(true);
    setSaveError(null);
    try {
      const nextBlocks = blocks.map(b => {
        if (b.id !== edited.blockId) {
          return b;
        }
        return {
          ...b,
          errorPageContents: updateCodeMap(b.errorPageContents, edited.code, edited.raw.content),
          lfFileContents: updateCodeMap(b.lfFileContents, edited.code, edited.lf.content),
        };
      });
      await onSave({ ...doc, defaultsBlocks: nextBlocks });
      setEditing(null);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleEditingFieldChange = (mode, value) =>
    setEditing(prev => ({ ...prev, [mode]: { content: value } }));

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
                      <th style={{ width: '10rem' }}>Override</th>
                      <th className="text-end" style={{ width: '6rem' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map(page => {
                      const path = block.errorFiles?.[page.code];
                      const rawContent = block.errorPageContents?.[page.code] ?? '';
                      const lfContent = block.lfFileContents?.[page.code] ?? '';
                      const hasRaw = rawContent.length > 0;
                      const hasLf = lfContent.length > 0;
                      return (
                        <tr key={page.code}>
                          <td>
                            <Badge bg="secondary">{page.code}</Badge>
                          </td>
                          <td className="small font-monospace text-muted">
                            {path ?? <em>not set</em>}
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              {hasRaw ? (
                                <Badge bg="success" title="errorfile override (raw)">
                                  raw
                                </Badge>
                              ) : null}
                              {hasLf ? (
                                <Badge bg="primary" title="http-error lf-file (expanded)">
                                  lf-file
                                </Badge>
                              ) : null}
                              {!hasRaw && !hasLf ? (
                                <Badge
                                  bg="secondary"
                                  className="bg-opacity-25 text-body-secondary border"
                                >
                                  bundled
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="text-end">
                            <Button
                              variant="outline-secondary"
                              size="sm"
                              onClick={() =>
                                setEditing({
                                  blockId: block.id,
                                  code: page.code,
                                  template: page.template,
                                  raw: { content: rawContent },
                                  lf: { content: lfContent },
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
          doc={doc}
          saving={saving}
          onChange={handleEditingFieldChange}
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
            Each per-status override below can be edited in one of two modes:
            <br />
            <strong>Raw (.http, errorfile)</strong> — full HTTP response served byte-for-byte, no
            token expansion.
            <br />
            <strong>Log-format (lf-file)</strong> — HAProxy expands <code>%[unique-id]</code>,{' '}
            <code>%[var(…)]</code>, <code>%[hdr(…)]</code> etc. at serve time; required if you want
            per-request data like the unique ID to appear in the page. Rendered as{' '}
            <code>
              http-error status N content-type &quot;text/html; charset=utf-8&quot; lf-file …
            </code>
            .
            <br />
            The <strong>Error pages sections</strong> at the bottom define named{' '}
            <code>http-errors NAME</code> bundles that frontends and defaults blocks can reference
            via <code>useErrorFilesId</code>.
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
