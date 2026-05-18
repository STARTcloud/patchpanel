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
import { Trans, useTranslation } from 'react-i18next';

import { apiGet } from '../api/client.js';
import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { ErrorPagePreview } from '../components/ErrorPagePreview.jsx';
import { TokenReferencePanel } from '../components/TokenReferencePanel.jsx';
import { HTTP_ERRORS_SECTIONS_SECTION } from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const EDIT_MODES = Object.freeze([
  {
    value: 'raw',
    labelKey: 'config:errorPages.editMode.raw',
    labelFallback: 'Raw .http (errorfile)',
  },
  { value: 'lf', labelKey: 'config:errorPages.editMode.lf', labelFallback: 'Log-format (lf-file)' },
]);

const PREVIEW_MODES = Object.freeze([
  {
    value: 'override',
    labelKey: 'config:errorPages.previewMode.override',
    labelFallback: 'Override',
  },
  { value: 'bundled', labelKey: 'config:errorPages.previewMode.bundled', labelFallback: 'Bundled' },
  { value: 'both', labelKey: 'config:errorPages.previewMode.both', labelFallback: 'Side-by-side' },
]);

const VIEWPORT_OPTIONS = Object.freeze([
  {
    value: 'desktop',
    labelKey: 'config:errorPages.viewport.desktop',
    labelFallback: 'Desktop',
    icon: 'display',
  },
  {
    value: 'tablet',
    labelKey: 'config:errorPages.viewport.tablet',
    labelFallback: 'Tablet',
    icon: 'tablet',
  },
  {
    value: 'mobile',
    labelKey: 'config:errorPages.viewport.mobile',
    labelFallback: 'Mobile',
    icon: 'phone',
  },
]);

const THEME_OPTIONS = Object.freeze([
  {
    value: 'light',
    labelKey: 'config:errorPages.theme.light',
    labelFallback: 'Light',
    icon: 'sun',
  },
  {
    value: 'dark',
    labelKey: 'config:errorPages.theme.dark',
    labelFallback: 'Dark',
    icon: 'moon-stars',
  },
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

const SegmentedToggle = ({ name, options, value, onChange, size = 'sm' }) => {
  const { t } = useTranslation(['config']);
  return (
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
          {t(opt.labelKey, opt.labelFallback)}
        </ToggleButton>
      ))}
    </ButtonGroup>
  );
};

SegmentedToggle.propTypes = {
  name: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      labelKey: PropTypes.string.isRequired,
      labelFallback: PropTypes.string.isRequired,
      icon: PropTypes.string,
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  size: PropTypes.string,
};

const PreviewVariablesEditor = ({ variables, onChange }) => {
  const { t } = useTranslation(['config']);
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
        <Trans
          i18nKey="config:errorPages.previewVars.summary"
          t={t}
          defaults="Preview variables ({{count}}) — replaces <0>%[token]</0> in the preview only"
          values={{ count: entries.length }}
          components={[<code key="0" />]}
        />
      </summary>
      <Table size="sm" className="mt-2 mb-2 small">
        <thead>
          <tr>
            <th style={{ width: '40%' }}>{t('config:errorPages.previewVars.token', 'Token')}</th>
            <th>{t('config:errorPages.previewVars.mockValue', 'Mock value')}</th>
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
                  title={t('config:errorPages.previewVars.removeTitle', 'Remove this token')}
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
        {t('config:errorPages.previewVars.addVariable', 'Add variable')}
      </Button>
      <Form.Text className="text-muted d-block mt-1">
        <Trans
          i18nKey="config:errorPages.previewVars.examples"
          t={t}
          defaults="Examples: <0>unique-id</0>, <1>hdr(host)</1>, <2>var(txn.request_id)</2>, <3>ssl_fc_protocol</3>. HAProxy itself does not expand these in static errorfile bodies — for real expansion you need <4>http-response set-header</4> / <5>http-after-response</5> directives or Lua. This panel mocks them so you can iterate on the look of your template."
          components={[
            <code key="0" />,
            <code key="1" />,
            <code key="2" />,
            <code key="3" />,
            <code key="4" />,
            <code key="5" />,
          ]}
        />
      </Form.Text>
    </details>
  );
};

PreviewVariablesEditor.propTypes = {
  variables: PropTypes.objectOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
};

const PreviewPane = ({ mode, override, bundled, variables, viewport, theme }) => {
  const { t } = useTranslation(['config']);
  const overrideTitle = t('config:errorPages.preview.overrideTitle', 'override preview');
  const bundledTitle = t('config:errorPages.preview.bundledTitle', 'bundled preview');
  if (mode === 'override') {
    return (
      <ErrorPagePreview
        source={override}
        title={overrideTitle}
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
        title={bundledTitle}
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
        <div className="small fw-semibold text-muted text-uppercase mb-1">
          {t('config:errorPages.preview.override', 'Override')}
        </div>
        <ErrorPagePreview
          source={override}
          title={overrideTitle}
          height="22rem"
          variables={variables}
          viewport={viewport}
          theme={theme}
        />
      </Col>
      <Col md={6}>
        <div className="small fw-semibold text-muted text-uppercase mb-1">
          {t('config:errorPages.preview.bundled', 'Bundled')}
        </div>
        <ErrorPagePreview
          source={bundled}
          title={bundledTitle}
          height="22rem"
          variables={variables}
          viewport={viewport}
          theme={theme}
        />
      </Col>
    </Row>
  );
};

PreviewPane.propTypes = {
  mode: PropTypes.string.isRequired,
  override: PropTypes.string.isRequired,
  bundled: PropTypes.string.isRequired,
  variables: PropTypes.objectOf(PropTypes.string).isRequired,
  viewport: PropTypes.string.isRequired,
  theme: PropTypes.string.isRequired,
};

const ModeHelp = ({ mode }) => {
  const { t } = useTranslation(['config']);
  if (mode === 'raw') {
    return (
      <Trans
        i18nKey="config:errorPages.modeHelp.raw"
        t={t}
        defaults="Served byte-for-byte via <0>errorfile</0>. HAProxy does NOT expand <1>%[token]</1> tokens here — what you type is what hits the wire. Written to <2>{{outPath}}</2>."
        values={{ outPath: '{haproxyErrorPagesDir}/{blockId}/{code}.http' }}
        components={[<code key="0" />, <code key="1" />, <code key="2" />]}
      />
    );
  }
  return (
    <Trans
      i18nKey="config:errorPages.modeHelp.lf"
      t={t}
      defaults="Served via <0>http-error … lf-file</0>. HAProxy <1>does</1> expand log-format tokens like <2>%[unique-id]</2>, <3>%[var(txn.x)]</3>, <4>%[hdr(host)]</4>, <5>%[src]</5> at request time. Written to <6>{{outPath}}</6>; the matching <7>http-error status {{codePh}}</7> directive is auto-injected on save."
      values={{
        outPath: '{haproxyErrorPagesDir}/{blockId}/lf/{code}.html',
        codePh: '{code}',
      }}
      components={[
        <code key="0" />,
        <strong key="1" />,
        <code key="2" />,
        <code key="3" />,
        <code key="4" />,
        <code key="5" />,
        <code key="6" />,
        <code key="7" />,
      ]}
    />
  );
};

ModeHelp.propTypes = {
  mode: PropTypes.string.isRequired,
};

const EditOverrideModal = ({ editing, doc, saving, onChange, onSave, onCancel }) => {
  const { t } = useTranslation(['config', 'common']);
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
          <span>{t('config:errorPages.modal.overrideIn', 'override in defaults block')}</span>
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
                <span>
                  {editMode === 'lf'
                    ? t('config:errorPages.modal.lfBody', 'Log-format body')
                    : t('config:errorPages.modal.rawBody', 'Raw response body')}
                </span>
                {editMode === 'raw' ? (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => onChange('raw', bundled)}
                    disabled={saving || !bundled}
                    title={t(
                      'config:errorPages.modal.loadBundledTitle',
                      'Load the bundled .http template into the editor as a starting point'
                    )}
                  >
                    <i className="bi bi-arrow-counterclockwise me-1" />
                    {t('config:errorPages.modal.loadBundled', 'Load bundled')}
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
                    ? t(
                        'config:errorPages.modal.lfPlaceholder',
                        '<!doctype html>\n<html>...\n<p>Unique ID: %[unique-id]</p>\n...'
                      )
                    : t(
                        'config:errorPages.modal.rawPlaceholder',
                        'HTTP/1.0 503 Service Unavailable\nCache-Control: no-cache\nContent-Type: text/html\n\n<html>...'
                      )
                }
              />
              <Form.Text className="text-muted">
                <ModeHelp mode={editMode} />{' '}
                {t('config:errorPages.modal.clearToRemove', 'Clear to remove.')}
              </Form.Text>
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
              <Form.Label className="mb-0">
                {t('config:errorPages.modal.livePreview', 'Live preview')}
              </Form.Label>
              <SegmentedToggle
                name="error-preview-mode"
                options={PREVIEW_MODES}
                value={effectivePreviewMode}
                onChange={setPreviewMode}
              />
            </div>
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2 small">
              <span className="text-muted">
                {t('config:errorPages.modal.viewport', 'Viewport')}
              </span>
              <SegmentedToggle
                name="error-preview-viewport"
                options={VIEWPORT_OPTIONS}
                value={viewport}
                onChange={setViewport}
              />
              <span className="text-muted ms-2">{t('config:errorPages.modal.theme', 'Theme')}</span>
              <SegmentedToggle
                name="error-preview-theme"
                options={THEME_OPTIONS}
                value={iframeTheme}
                onChange={setIframeTheme}
              />
            </div>
            <PreviewPane
              mode={effectivePreviewMode}
              override={activeContent}
              bundled={bundled}
              variables={variables}
              viewport={viewport}
              theme={iframeTheme}
            />
            <Form.Text className="text-muted d-block mt-2">
              {editMode === 'lf' ? (
                <Trans
                  i18nKey="config:errorPages.modal.lfNote"
                  t={t}
                  defaults="Token expansion is <0>real</0> in this mode — the values below model what HAProxy will substitute at serve time."
                  components={[<strong key="0" />]}
                />
              ) : (
                t(
                  'config:errorPages.modal.rawNote',
                  'Tokens are mocked for the preview only. In raw mode HAProxy serves the file byte-for-byte; tokens would render as literal text in production.'
                )
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
          {editMode === 'lf'
            ? t('config:errorPages.modal.clearLf', 'Clear (lf-file)')
            : t('config:errorPages.modal.clearRaw', 'Clear (raw)')}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={() => onSave(editing)} disabled={saving}>
          {saving ? (
            <>
              <Spinner as="span" size="sm" animation="border" />{' '}
              <span>{t('common:status.saving', 'Saving…')}</span>
            </>
          ) : (
            t('common:buttons.save', 'Save')
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
  const { t } = useTranslation(['config']);
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
        <Card.Title>
          {t('config:errorPages.perStatus.title', 'Per-status template overrides')}
        </Card.Title>
        <Card.Text className="text-muted small">
          <Trans
            i18nKey="config:errorPages.perStatus.description"
            t={t}
            defaults="The 19 canonical HTTP status codes. Each row shows the current path emitted into <0>haproxy.cfg</0> for this defaults block, whether a custom body override is set, and an Edit button that opens the bundled template plus an editor for the override body."
            components={[<code key="0" />]}
          />
        </Card.Text>
        {fetchError ? (
          <Alert variant="warning" className="small">
            {t(
              'config:errorPages.perStatus.bundledUnavailable',
              'Bundled templates unavailable: {{message}}',
              { message: fetchError.message }
            )}
          </Alert>
        ) : null}
        {saveError ? (
          <Alert variant="danger" dismissible onClose={() => setSaveError(null)}>
            {t('config:errorPages.perStatus.saveFailed', 'Save failed: {{message}}', {
              message: saveError.message,
            })}
          </Alert>
        ) : null}
        {!pages && !fetchError ? (
          <div className="d-flex align-items-center gap-2 small text-muted py-2">
            <Spinner as="span" animation="border" size="sm" />{' '}
            {t('config:errorPages.perStatus.loadingBundled', 'Loading bundled templates…')}
          </div>
        ) : null}
        {pages && blocks.length === 0 ? (
          <Alert variant="info" className="small mb-0">
            {t(
              'config:errorPages.perStatus.noBlocks',
              'No defaults blocks yet. Add one on the Defaults page first.'
            )}
          </Alert>
        ) : null}
        {pages
          ? blocks.map(block => (
              <div key={block.id} className="mb-3">
                <h6 className="mt-3 mb-2">
                  <Trans
                    i18nKey="config:errorPages.perStatus.defaultsBlock"
                    t={t}
                    defaults="Defaults block <0>{{name}}</0>"
                    values={{ name: block.name }}
                    components={[<code key="0" />]}
                  />
                </h6>
                <Table size="sm" responsive striped className="mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: '4rem' }}>
                        {t('config:errorPages.perStatus.col.code', 'Code')}
                      </th>
                      <th>{t('config:errorPages.perStatus.col.path', 'Path')}</th>
                      <th style={{ width: '10rem' }}>
                        {t('config:errorPages.perStatus.col.override', 'Override')}
                      </th>
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
                            {path ?? <em>{t('config:errorPages.perStatus.notSet', 'not set')}</em>}
                          </td>
                          <td>
                            <div className="d-flex flex-wrap gap-1">
                              {hasRaw ? (
                                <Badge
                                  bg="success"
                                  title={t(
                                    'config:errorPages.perStatus.badge.rawTitle',
                                    'errorfile override (raw)'
                                  )}
                                >
                                  {t('config:errorPages.perStatus.badge.raw', 'raw')}
                                </Badge>
                              ) : null}
                              {hasLf ? (
                                <Badge
                                  bg="primary"
                                  title={t(
                                    'config:errorPages.perStatus.badge.lfTitle',
                                    'http-error lf-file (expanded)'
                                  )}
                                >
                                  {t('config:errorPages.perStatus.badge.lf', 'lf-file')}
                                </Badge>
                              ) : null}
                              {!hasRaw && !hasLf ? (
                                <Badge
                                  bg="secondary"
                                  className="bg-opacity-25 text-body-secondary border"
                                >
                                  {t('config:errorPages.perStatus.badge.bundled', 'bundled')}
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
                              {t('config:errorPages.perStatus.edit', 'Edit')}
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
  const { t } = useTranslation(['config']);
  if (!doc) {
    return null;
  }
  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>{t('config:errorPages.title', 'Error pages')}</Card.Title>
          <Card.Text className="text-muted small mb-0">
            <Trans
              i18nKey="config:errorPages.intro"
              t={t}
              defaults='Each per-status override below can be edited in one of two modes:<0/><1>Raw (.http, errorfile)</1> — full HTTP response served byte-for-byte, no token expansion.<2/><3>Log-format (lf-file)</3> — HAProxy expands <4>%[unique-id]</4>, <5>%[var(…)]</5>, <6>%[hdr(…)]</6> etc. at serve time; required if you want per-request data like the unique ID to appear in the page. Rendered as <7>http-error status N content-type "text/html; charset=utf-8" lf-file …</7>.<8/>The <9>Error pages sections</9> at the bottom define named <10>http-errors NAME</10> bundles that frontends and defaults blocks can reference via <11>useErrorFilesId</11>.'
              components={[
                <br key="0" />,
                <strong key="1" />,
                <br key="2" />,
                <strong key="3" />,
                <code key="4" />,
                <code key="5" />,
                <code key="6" />,
                <code key="7" />,
                <br key="8" />,
                <strong key="9" />,
                <code key="10" />,
                <code key="11" />,
              ]}
            />
          </Card.Text>
        </Card.Body>
      </Card>
      {onSave ? <PerStatusOverridesCard doc={doc} onSave={onSave} /> : null}
      {onSave ? (
        <EntitySectionCard doc={doc} onSave={onSave} section={HTTP_ERRORS_SECTIONS_SECTION} />
      ) : (
        <Alert variant="warning">
          {t('config:errorPages.saveUnavailable', 'State save unavailable.')}
        </Alert>
      )}
    </>
  );
};

ErrorPagesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
