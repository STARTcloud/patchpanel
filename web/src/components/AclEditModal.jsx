import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { ACL_NAME_REGEX, ID_REGEX } from '../utils/regexes.js';

import { ListEditor } from './ListEditor.jsx';

const OPERATORS = Object.freeze([
  {
    value: '',
    labelKey: 'haproxy:acl.operators.none',
    labelFallback: '(none — default str / boolean)',
  },
  {
    value: 'str',
    labelKey: 'haproxy:acl.operators.str',
    labelFallback: 'str (exact string match)',
  },
  { value: 'sub', labelKey: 'haproxy:acl.operators.sub', labelFallback: 'sub (substring)' },
  { value: 'beg', labelKey: 'haproxy:acl.operators.beg', labelFallback: 'beg (begins with)' },
  { value: 'end', labelKey: 'haproxy:acl.operators.end', labelFallback: 'end (ends with)' },
  { value: 'reg', labelKey: 'haproxy:acl.operators.reg', labelFallback: 'reg (regex)' },
  {
    value: 'dir',
    labelKey: 'haproxy:acl.operators.dir',
    labelFallback: 'dir (path-component match)',
  },
  { value: 'dom', labelKey: 'haproxy:acl.operators.dom', labelFallback: 'dom (domain match)' },
  { value: 'len', labelKey: 'haproxy:acl.operators.len', labelFallback: 'len (length match)' },
  { value: 'bin', labelKey: 'haproxy:acl.operators.bin', labelFallback: 'bin (binary match)' },
  {
    value: 'found',
    labelKey: 'haproxy:acl.operators.found',
    labelFallback: 'found (key exists; no value)',
  },
  {
    value: 'ip',
    labelKey: 'haproxy:acl.operators.ip',
    labelFallback: 'ip (CIDR match for src/dst)',
  },
  { value: 'int', labelKey: 'haproxy:acl.operators.int', labelFallback: 'int (integer equality)' },
  { value: 'gt', labelKey: 'haproxy:acl.operators.gt', labelFallback: 'gt (greater than)' },
  { value: 'lt', labelKey: 'haproxy:acl.operators.lt', labelFallback: 'lt (less than)' },
  { value: 'ge', labelKey: 'haproxy:acl.operators.ge', labelFallback: 'ge (≥)' },
  { value: 'le', labelKey: 'haproxy:acl.operators.le', labelFallback: 'le (≤)' },
  { value: 'eq', labelKey: 'haproxy:acl.operators.eq', labelFallback: 'eq (equal)' },
  { value: 'ne', labelKey: 'haproxy:acl.operators.ne', labelFallback: 'ne (not equal)' },
  {
    value: 'bool',
    labelKey: 'haproxy:acl.operators.bool',
    labelFallback: 'bool (boolean fetch, no values)',
  },
]);

const FIELD_PRESETS = Object.freeze([
  {
    groupKey: 'haproxy:acl.fieldGroups.common',
    groupFallback: 'Common',
    fields: ['hdr', 'path', 'method', 'url', 'query', 'urlp', 'base'],
  },
  {
    groupKey: 'haproxy:acl.fieldGroups.network',
    groupFallback: 'Network',
    fields: ['src', 'dst', 'src_port', 'dst_port'],
  },
  {
    groupKey: 'haproxy:acl.fieldGroups.tls',
    groupFallback: 'TLS',
    fields: ['ssl_fc', 'ssl_fc_sni', 'ssl_c_used', 'ssl_c_s_dn', 'ssl_c_san', 'ssl_fc_alpn'],
  },
  {
    groupKey: 'haproxy:acl.fieldGroups.request',
    groupFallback: 'Request',
    fields: ['req.hdr', 'req.fhdr', 'req.cook', 'req.body', 'req.proto_http'],
  },
  {
    groupKey: 'haproxy:acl.fieldGroups.response',
    groupFallback: 'Response',
    fields: ['res.hdr', 'res.fhdr', 'res.cook', 'res.body', 'res.status'],
  },
  {
    groupKey: 'haproxy:acl.fieldGroups.variables',
    groupFallback: 'Variables',
    fields: ['var', 'sc_http_req_rate', 'sc_conn_rate', 'sc_http_err_rate'],
  },
]);

const FIELDS_REQUIRING_ARG = new Set([
  'hdr',
  'req.hdr',
  'req.fhdr',
  'req.cook',
  'res.hdr',
  'res.fhdr',
  'res.cook',
  'urlp',
  'var',
  'sc_http_req_rate',
  'sc_conn_rate',
  'sc_http_err_rate',
  'ssl_c_s_dn',
]);

const FIELDS_BOOLEAN = new Set(['ssl_fc', 'ssl_c_used', 'req.proto_http']);

const emptyAcl = () => ({
  id: '',
  name: '',
  description: undefined,
  field: 'hdr',
  fieldArg: 'host',
  operator: 'str',
  values: [],
  caseInsensitive: true,
  noDnsLookup: false,
});

const validate = (draft, t) => {
  if (!ID_REGEX.test(draft.id ?? '')) {
    return t(
      'haproxy:acl.errors.idFormat',
      'id must match a-z, 0-9, _, - (starting with a letter)'
    );
  }
  if (!ACL_NAME_REGEX.test(draft.name ?? '')) {
    return t(
      'haproxy:acl.errors.nameFormat',
      'name must be a valid HAProxy ACL identifier (letter-start, letters/digits/_/./-)'
    );
  }
  if (!draft.field?.trim()) {
    return t('haproxy:acl.errors.fieldRequired', 'field is required');
  }
  return null;
};

const renderPreview = (draft, t) => {
  if (!draft.name || !draft.field) {
    return t('haproxy:acl.previewIncomplete', '(complete name + field to preview)');
  }
  const parts = ['acl', draft.name];
  const field = draft.fieldArg ? `${draft.field}(${draft.fieldArg})` : draft.field;
  parts.push(field);
  if (draft.operator && draft.operator !== 'bool') {
    parts.push(`-m ${draft.operator}`);
  }
  if (draft.caseInsensitive) {
    parts.push('-i');
  }
  if (draft.noDnsLookup) {
    parts.push('-n');
  }
  if (draft.values && draft.values.length > 0) {
    parts.push(...draft.values);
  }
  return parts.join(' ');
};

export const AclEditModal = ({ show, acl = null, onSave, onCancel }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(() => acl ?? emptyAcl());
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
      fieldArg: draft.fieldArg?.trim() || undefined,
      description: draft.description?.trim() || undefined,
    });
  };

  const isExisting = Boolean(acl?.id);
  const requiresArg = FIELDS_REQUIRING_ARG.has(draft.field);
  const isBoolean = FIELDS_BOOLEAN.has(draft.field) || draft.operator === 'bool';

  return (
    <Modal show={show} onHide={onCancel} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('haproxy:acl.edit.editTitle', 'Edit ACL: {{name}}', { name: acl.name })
            : t('haproxy:acl.edit.newTitle', 'New ACL')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('haproxy:acl.edit.id', 'ID')}</Form.Label>
              <Form.Control
                type="text"
                value={draft.id}
                disabled={isExisting}
                onChange={e => update({ id: e.target.value })}
                placeholder={t('haproxy:acl.edit.idPlaceholder', 'e.g. host-home-assistant')}
              />
              <Form.Text className="text-muted">
                {t(
                  'haproxy:acl.edit.idHelp',
                  'Internal id (immutable). Lowercase a-z, digits, _ or -, start with letter.'
                )}
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('haproxy:acl.edit.name', 'HAProxy ACL name')}</Form.Label>
              <Form.Control
                type="text"
                value={draft.name}
                onChange={e => update({ name: e.target.value })}
                placeholder="host_home_assistant"
              />
              <Form.Text className="text-muted">
                {t('haproxy:acl.edit.nameHelp', 'Used in rule conditions to reference this ACL.')}
              </Form.Text>
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>{t('haproxy:acl.edit.description', 'Description (optional)')}</Form.Label>
              <Form.Control
                type="text"
                value={draft.description ?? ''}
                onChange={e => update({ description: e.target.value })}
                placeholder={t(
                  'haproxy:acl.edit.descriptionPlaceholder',
                  'e.g. Matches all requests to home.example.com'
                )}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('haproxy:acl.edit.field', 'Field (HAProxy fetch)')}</Form.Label>
              <Form.Select value={draft.field} onChange={e => update({ field: e.target.value })}>
                {FIELD_PRESETS.map(grp => {
                  const label = t(grp.groupKey, grp.groupFallback);
                  return (
                    <optgroup key={grp.groupFallback} label={label}>
                      {grp.fields.map(f => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
                <optgroup label={t('haproxy:acl.fieldGroups.other', 'Other')}>
                  <option value={draft.field}>
                    {draft.field}{' '}
                    {t(
                      'haproxy:acl.edit.fieldCurrent',
                      '(currently set; type custom in field below)'
                    )}
                  </option>
                </optgroup>
              </Form.Select>
              <Form.Control
                type="text"
                className="mt-1"
                value={draft.field}
                placeholder={t(
                  'haproxy:acl.edit.fieldCustomPlaceholder',
                  'custom fetch (e.g. some.future_fetch)'
                )}
                onChange={e => update({ field: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>
                {t('haproxy:acl.edit.fieldArg', 'Field argument')}{' '}
                {requiresArg ? <span className="text-danger">*</span> : null}
              </Form.Label>
              <Form.Control
                type="text"
                value={draft.fieldArg ?? ''}
                disabled={!requiresArg ? !draft.fieldArg : null}
                onChange={e => update({ fieldArg: e.target.value })}
                placeholder={
                  requiresArg
                    ? t(
                        'haproxy:acl.edit.fieldArgPlaceholder',
                        'e.g. host, X-Forwarded-For, txn.foo'
                      )
                    : t('haproxy:acl.edit.none', '(none)')
                }
              />
              <Form.Text className="text-muted">
                {t('haproxy:acl.edit.fieldArgHelp', 'For hdr(NAME), var(scope.NAME), etc.')}
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>{t('haproxy:acl.edit.operator', 'Operator')}</Form.Label>
              <Form.Select
                value={draft.operator ?? ''}
                onChange={e => update({ operator: e.target.value || undefined })}
              >
                {OPERATORS.map(o => (
                  <option key={o.value} value={o.value}>
                    {t(o.labelKey, o.labelFallback)}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              id="acl-case-insensitive"
              label={t('haproxy:acl.edit.caseInsensitive', '-i (case-insensitive)')}
              checked={Boolean(draft.caseInsensitive)}
              onChange={e => update({ caseInsensitive: e.target.checked })}
            />
          </Col>
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              id="acl-no-dns"
              label={t('haproxy:acl.edit.noDns', '-n (no DNS lookup)')}
              checked={Boolean(draft.noDnsLookup)}
              onChange={e => update({ noDnsLookup: e.target.checked })}
            />
          </Col>
          {!isBoolean ? (
            <Col xs={12}>
              <Form.Group>
                <Form.Label>
                  {t(
                    'haproxy:acl.edit.values',
                    'Values (one or more, space-separated when rendered)'
                  )}
                </Form.Label>
                <ListEditor
                  items={draft.values ?? []}
                  onChange={list => update({ values: list })}
                  placeholder={t('haproxy:acl.edit.valuePlaceholder', 'value or CIDR or regex')}
                />
              </Form.Group>
            </Col>
          ) : null}
          <Col xs={12}>
            <Form.Label className="mb-1 text-muted small text-uppercase">
              {t('haproxy:acl.edit.preview', 'Preview')}
            </Form.Label>
            <pre
              className="border rounded p-2 bg-body-tertiary mb-0"
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85rem' }}
            >
              {renderPreview(draft, t)}
            </pre>
          </Col>
        </Row>
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

AclEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  acl: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
