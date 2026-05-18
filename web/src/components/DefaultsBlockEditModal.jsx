import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Tab, Table, Tabs } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { genKey } from '../utils/keys.js';

import { ErrorFilesIdSelect } from './ErrorFilesIdSelect.jsx';
import { ListEditor } from './ListEditor.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const SECTION_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;
const INIT_ADDR_OPTIONS = Object.freeze(['last', 'libc', 'none', 'ip']);

const stripInternal = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) {
      out[k] = v;
    }
  }
  return out;
};

const newHttpErrorEntry = () => ({
  _key: genKey(),
  status: 503,
  contentType: 'text/html; charset=utf-8',
  lfFile: '',
  lfString: undefined,
});

const ensureHttpErrorKeys = list =>
  (list ?? []).map(entry => ({ ...entry, _key: entry._key ?? genKey() }));

const cleanHttpErrors = entries =>
  entries
    .map(stripInternal)
    .map(entry => {
      const cleaned = { status: entry.status };
      if (entry.contentType) {
        cleaned.contentType = entry.contentType;
      }
      if (entry.lfFile) {
        cleaned.lfFile = entry.lfFile;
      } else if (entry.lfString) {
        cleaned.lfString = entry.lfString;
      }
      return cleaned;
    })
    .filter(e => e.lfFile || e.lfString);

const defaultBlock = () => ({
  id: '',
  name: '',
  description: undefined,
  mode: 'http',
  timeouts: {
    httpRequest: '60s',
    queue: '1m',
    connect: '30s',
    client: '1m',
    server: '1m',
    httpKeepAlive: '30s',
    check: '10s',
    clientFin: '30s',
    tunnel: '1h',
  },
  options: [
    'http-keep-alive',
    'http-server-close',
    'dontlognull',
    'httplog',
    'redispatch',
    'tcpka',
  ],
  retries: 3,
  errorFiles: {},
  httpErrors: [],
  useErrorFilesId: null,
  defaultServer: { initAddr: ['last', 'libc', 'none'] },
  dontlogNormal: false,
  advancedDirectives: [],
});

const validate = (draft, t) => {
  if (!ID_REGEX.test(draft.id ?? '')) {
    return t(
      'haproxy:defaults.errors.idFormat',
      'id must match a-z, 0-9, _, - (starting with a letter)'
    );
  }
  if (!SECTION_NAME_REGEX.test(draft.name ?? '')) {
    return t(
      'haproxy:defaults.errors.nameFormat',
      'name must be a valid HAProxy section identifier (letters/digits/_/-, start with letter)'
    );
  }
  return null;
};

const HttpErrorRow = ({ entry, onChange, onRemove }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const bodyKind = entry.lfFile !== undefined && entry.lfFile !== '' ? 'lf-file' : 'lf-string';
  const setBodyKind = next => {
    if (next === 'lf-file') {
      onChange({ ...entry, lfFile: entry.lfFile || '', lfString: undefined });
    } else {
      onChange({ ...entry, lfString: entry.lfString || '', lfFile: undefined });
    }
  };
  return (
    <tr>
      <td style={{ width: '6rem' }}>
        <Form.Control
          type="number"
          min={100}
          max={599}
          size="sm"
          value={entry.status}
          onChange={e => onChange({ ...entry, status: Number(e.target.value) || 0 })}
        />
      </td>
      <td>
        <Form.Control
          type="text"
          size="sm"
          placeholder="text/html; charset=utf-8"
          value={entry.contentType ?? ''}
          onChange={e => onChange({ ...entry, contentType: e.target.value || undefined })}
        />
      </td>
      <td style={{ width: '8rem' }}>
        <Form.Select size="sm" value={bodyKind} onChange={e => setBodyKind(e.target.value)}>
          <option value="lf-file">lf-file</option>
          <option value="lf-string">lf-string</option>
        </Form.Select>
      </td>
      <td>
        {bodyKind === 'lf-file' ? (
          <Form.Control
            type="text"
            size="sm"
            placeholder="/etc/haproxy/errors/tpl/503.http"
            value={entry.lfFile ?? ''}
            onChange={e => onChange({ ...entry, lfFile: e.target.value })}
          />
        ) : (
          <Form.Control
            as="textarea"
            rows={2}
            size="sm"
            placeholder={t(
              'haproxy:defaults.httpErrors.inlinePlaceholder',
              'Inline body with log-format vars'
            )}
            value={entry.lfString ?? ''}
            onChange={e => onChange({ ...entry, lfString: e.target.value })}
          />
        )}
      </td>
      <td className="text-end">
        <Button variant="outline-danger" size="sm" onClick={onRemove}>
          ×
        </Button>
      </td>
    </tr>
  );
};

HttpErrorRow.propTypes = {
  entry: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const HttpErrorsEditor = ({ entries, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const update = (key, next) =>
    onChange(entries.map(e => (e._key === key ? { ...next, _key: key } : e)));
  const remove = key => onChange(entries.filter(e => e._key !== key));
  const add = () => onChange([...entries, newHttpErrorEntry()]);
  return (
    <>
      {entries.length === 0 ? (
        <p className="text-muted small mb-2">
          {t('haproxy:defaults.httpErrors.empty', 'No http-error directives.')}
        </p>
      ) : (
        <Table size="sm" bordered className="mb-2">
          <thead>
            <tr>
              <th>{t('haproxy:defaults.httpErrors.status', 'Status')}</th>
              <th>{t('haproxy:defaults.httpErrors.contentType', 'Content-Type')}</th>
              <th>{t('haproxy:defaults.httpErrors.bodyKind', 'Body kind')}</th>
              <th>{t('haproxy:defaults.httpErrors.body', 'Body')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <HttpErrorRow
                key={entry._key}
                entry={entry}
                onChange={next => update(entry._key, next)}
                onRemove={() => remove(entry._key)}
              />
            ))}
          </tbody>
        </Table>
      )}
      <Button variant="outline-primary" size="sm" onClick={add}>
        <i className="bi bi-plus-lg me-1" />
        {t('haproxy:defaults.httpErrors.add', 'Add http-error directive')}
      </Button>
    </>
  );
};

HttpErrorsEditor.propTypes = {
  entries: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
};

const BasicsTab = ({ draft, update, isExisting }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <Row className="g-2 pt-3">
      <Col md={4}>
        <Form.Group>
          <Form.Label>{t('haproxy:defaults.edit.id', 'ID')}</Form.Label>
          <Form.Control
            type="text"
            value={draft.id ?? ''}
            disabled={isExisting}
            onChange={e => update({ id: e.target.value })}
          />
          <Form.Text className="text-muted">
            {t('haproxy:defaults.edit.idHelp', 'Immutable after creation.')}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>{t('haproxy:defaults.edit.sectionName', 'HAProxy section name')}</Form.Label>
          <Form.Control
            type="text"
            value={draft.name ?? ''}
            onChange={e => update({ name: e.target.value })}
          />
          <Form.Text className="text-muted">
            {t('haproxy:defaults.edit.sectionNameHelp', 'Used as the `from NAME` reference.')}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>{t('haproxy:defaults.edit.mode', 'Mode')}</Form.Label>
          <Form.Select
            value={draft.mode ?? 'http'}
            onChange={e => update({ mode: e.target.value })}
          >
            <option value="http">http</option>
            <option value="tcp">tcp</option>
          </Form.Select>
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>{t('haproxy:defaults.edit.description', 'Description')}</Form.Label>
          <Form.Control
            as="textarea"
            rows={2}
            value={draft.description ?? ''}
            onChange={e => update({ description: e.target.value || undefined })}
          />
        </Form.Group>
      </Col>
      <Col md={4}>
        <Form.Group>
          <Form.Label>retries</Form.Label>
          <Form.Control
            type="number"
            min={0}
            max={10}
            value={draft.retries ?? 3}
            onChange={e => update({ retries: Number(e.target.value) })}
          />
        </Form.Group>
      </Col>
      <Col md={8}>
        <Form.Group>
          <Form.Label>
            {t('haproxy:defaults.edit.initAddr', 'default-server init-addr (resolution order)')}
          </Form.Label>
          <Form.Select
            multiple
            value={draft.defaultServer?.initAddr ?? []}
            onChange={e => {
              const selected = Array.from(e.target.selectedOptions).map(o => o.value);
              update({ defaultServer: { ...(draft.defaultServer ?? {}), initAddr: selected } });
            }}
            style={{ minHeight: '6rem' }}
          >
            {INIT_ADDR_OPTIONS.map(opt => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            {t(
              'haproxy:defaults.edit.initAddrHelp',
              'Cmd/Ctrl-click to select multiple. Empty omits the directive.'
            )}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={12}>
        <Form.Check
          type="switch"
          id="defaults-dontlog-normal"
          label="option dontlog-normal"
          checked={Boolean(draft.dontlogNormal)}
          onChange={e => update({ dontlogNormal: e.target.checked })}
        />
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>{t('haproxy:defaults.edit.options', 'options (one per line)')}</Form.Label>
          <ListEditor
            items={draft.options ?? []}
            onChange={list => update({ options: list })}
            placeholder="e.g. http-keep-alive"
          />
        </Form.Group>
      </Col>
    </Row>
  );
};

BasicsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  isExisting: PropTypes.bool.isRequired,
};

const TimeoutsTab = ({ draft, update }) => {
  const timeouts = draft.timeouts ?? {};
  const setT = patch => update({ timeouts: { ...timeouts, ...patch } });
  // Labels here are HAProxy directive names (http-request, queue, connect…) — config tokens, not translatable.
  const timeoutField = (key, label, placeholder) => (
    <Col md={4} key={key}>
      <Form.Group>
        <Form.Label>{label}</Form.Label>
        <Form.Control
          type="text"
          value={timeouts[key] ?? ''}
          placeholder={placeholder}
          onChange={e => setT({ [key]: e.target.value })}
        />
      </Form.Group>
    </Col>
  );
  return (
    <Row className="g-2 pt-3">
      {timeoutField('httpRequest', 'http-request', '60s')}
      {timeoutField('queue', 'queue', '1m')}
      {timeoutField('connect', 'connect', '30s')}
      {timeoutField('client', 'client', '1m')}
      {timeoutField('server', 'server', '1m')}
      {timeoutField('httpKeepAlive', 'http-keep-alive', '30s')}
      {timeoutField('check', 'check', '10s')}
      {timeoutField('clientFin', 'client-fin', '30s')}
      {timeoutField('tunnel', 'tunnel', '1h')}
    </Row>
  );
};

TimeoutsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const ErrorsTab = ({ draft, update, sections }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <div className="pt-3 d-flex flex-column gap-3">
      <ErrorFilesIdSelect
        label={t('haproxy:defaults.errors.sectionLabel', 'errorfiles section (named bundle)')}
        sections={sections}
        value={draft.useErrorFilesId}
        onChange={v => update({ useErrorFilesId: v })}
        helpText={t(
          'haproxy:defaults.errors.sectionHelp',
          'References one of the named http-errors sections (top-level).'
        )}
      />
      <div>
        <strong className="small text-muted text-uppercase d-block mb-1">
          {t(
            'haproxy:defaults.errors.directivesHeading',
            'http-error directives (with log-format expansion)'
          )}
        </strong>
        <HttpErrorsEditor
          entries={draft.httpErrors ?? []}
          onChange={list => update({ httpErrors: list })}
        />
      </div>
    </div>
  );
};

ErrorsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  sections: PropTypes.array.isRequired,
};

const AdvancedTab = ({ draft, update }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <div className="pt-3">
      <Form.Group>
        <Form.Label>
          {t('haproxy:defaults.advanced.label', 'Advanced HAProxy directives')}
        </Form.Label>
        <ListEditor
          items={draft.advancedDirectives ?? []}
          onChange={list => update({ advancedDirectives: list })}
          placeholder={t('haproxy:defaults.advanced.placeholder', 'raw HAProxy line to inject')}
        />
        <Form.Text className="text-muted">
          {t('haproxy:defaults.advanced.help', 'Appended verbatim inside the defaults block.')}
        </Form.Text>
      </Form.Group>
    </div>
  );
};

AdvancedTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

export const DefaultsBlockEditModal = ({ show, block = null, doc, onSave, onCancel }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(() => {
    const seed = block ?? defaultBlock();
    return { ...seed, httpErrors: ensureHttpErrorKeys(seed.httpErrors) };
  });
  const [error, setError] = useState(null);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    const message = validate(draft, t);
    if (message) {
      setError(message);
      return;
    }
    onSave({
      ...draft,
      httpErrors: cleanHttpErrors(draft.httpErrors ?? []),
    });
  };

  const isExisting = Boolean(block?.id);
  const sections = doc.httpErrorsSections ?? [];

  return (
    <Modal show={show} onHide={onCancel} size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('haproxy:defaults.edit.editTitle', 'Edit defaults block: {{name}}', {
                name: block.name,
              })
            : t('haproxy:defaults.edit.newTitle', 'New defaults block')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Tabs defaultActiveKey="basics" id="defaults-edit-tabs" className="mb-1">
          <Tab eventKey="basics" title={t('haproxy:defaults.tabs.basics', 'Basics')}>
            <BasicsTab draft={draft} update={update} isExisting={isExisting} />
          </Tab>
          <Tab eventKey="timeouts" title={t('haproxy:defaults.tabs.timeouts', 'Timeouts')}>
            <TimeoutsTab draft={draft} update={update} />
          </Tab>
          <Tab eventKey="errors" title={t('haproxy:defaults.tabs.errors', 'Error pages')}>
            <ErrorsTab draft={draft} update={update} sections={sections} />
          </Tab>
          <Tab eventKey="advanced" title={t('haproxy:defaults.tabs.advanced', 'Advanced')}>
            <AdvancedTab draft={draft} update={update} />
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? t('common:buttons.update', 'Update') : t('common:buttons.add', 'Add')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

DefaultsBlockEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  block: PropTypes.object,
  doc: PropTypes.object.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
