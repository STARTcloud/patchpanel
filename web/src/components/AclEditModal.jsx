import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Col, Form, Modal, Row } from 'react-bootstrap';

import { ListEditor } from './ListEditor.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const ACL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u;

const OPERATORS = Object.freeze([
  { value: '', label: '(none — default str / boolean)' },
  { value: 'str', label: 'str (exact string match)' },
  { value: 'sub', label: 'sub (substring)' },
  { value: 'beg', label: 'beg (begins with)' },
  { value: 'end', label: 'end (ends with)' },
  { value: 'reg', label: 'reg (regex)' },
  { value: 'dir', label: 'dir (path-component match)' },
  { value: 'dom', label: 'dom (domain match)' },
  { value: 'len', label: 'len (length match)' },
  { value: 'bin', label: 'bin (binary match)' },
  { value: 'found', label: 'found (key exists; no value)' },
  { value: 'ip', label: 'ip (CIDR match for src/dst)' },
  { value: 'int', label: 'int (integer equality)' },
  { value: 'gt', label: 'gt (greater than)' },
  { value: 'lt', label: 'lt (less than)' },
  { value: 'ge', label: 'ge (≥)' },
  { value: 'le', label: 'le (≤)' },
  { value: 'eq', label: 'eq (equal)' },
  { value: 'ne', label: 'ne (not equal)' },
  { value: 'bool', label: 'bool (boolean fetch, no values)' },
]);

const FIELD_PRESETS = Object.freeze([
  { group: 'Common', fields: ['hdr', 'path', 'method', 'url', 'query', 'urlp', 'base'] },
  { group: 'Network', fields: ['src', 'dst', 'src_port', 'dst_port'] },
  {
    group: 'TLS',
    fields: ['ssl_fc', 'ssl_fc_sni', 'ssl_c_used', 'ssl_c_s_dn', 'ssl_c_san', 'ssl_fc_alpn'],
  },
  {
    group: 'Request',
    fields: ['req.hdr', 'req.fhdr', 'req.cook', 'req.body', 'req.proto_http'],
  },
  {
    group: 'Response',
    fields: ['res.hdr', 'res.fhdr', 'res.cook', 'res.body', 'res.status'],
  },
  {
    group: 'Variables',
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

const validate = draft => {
  if (!ID_REGEX.test(draft.id ?? '')) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  if (!ACL_NAME_REGEX.test(draft.name ?? '')) {
    return 'name must be a valid HAProxy ACL identifier (letter-start, letters/digits/_/./-)';
  }
  if (!draft.field?.trim()) {
    return 'field is required';
  }
  return null;
};

const renderPreview = draft => {
  if (!draft.name || !draft.field) {
    return '(complete name + field to preview)';
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
  const [draft, setDraft] = useState(() => acl ?? emptyAcl());
  const [error, setError] = useState(null);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    const message = validate(draft);
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
        <Modal.Title>{isExisting ? `Edit ACL: ${acl.name}` : 'New ACL'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Row className="g-3">
          <Col md={6}>
            <Form.Group>
              <Form.Label>ID</Form.Label>
              <Form.Control
                type="text"
                value={draft.id}
                disabled={isExisting}
                onChange={e => update({ id: e.target.value })}
                placeholder="e.g. host-home-assistant"
              />
              <Form.Text className="text-muted">
                Internal id (immutable). Lowercase a-z, digits, _ or -, start with letter.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>HAProxy ACL name</Form.Label>
              <Form.Control
                type="text"
                value={draft.name}
                onChange={e => update({ name: e.target.value })}
                placeholder="host_home_assistant"
              />
              <Form.Text className="text-muted">
                Used in rule conditions to reference this ACL.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col xs={12}>
            <Form.Group>
              <Form.Label>Description (optional)</Form.Label>
              <Form.Control
                type="text"
                value={draft.description ?? ''}
                onChange={e => update({ description: e.target.value })}
                placeholder="e.g. Matches all requests to home.example.com"
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Field (HAProxy fetch)</Form.Label>
              <Form.Select value={draft.field} onChange={e => update({ field: e.target.value })}>
                {FIELD_PRESETS.map(grp => (
                  <optgroup key={grp.group} label={grp.group}>
                    {grp.fields.map(f => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="Other">
                  <option value={draft.field}>
                    {draft.field} (currently set; type custom in field below)
                  </option>
                </optgroup>
              </Form.Select>
              <Form.Control
                type="text"
                className="mt-1"
                value={draft.field}
                placeholder="custom fetch (e.g. some.future_fetch)"
                onChange={e => update({ field: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>
                Field argument {requiresArg ? <span className="text-danger">*</span> : null}
              </Form.Label>
              <Form.Control
                type="text"
                value={draft.fieldArg ?? ''}
                disabled={!requiresArg ? !draft.fieldArg : null}
                onChange={e => update({ fieldArg: e.target.value })}
                placeholder={requiresArg ? 'e.g. host, X-Forwarded-For, txn.foo' : '(none)'}
              />
              <Form.Text className="text-muted">
                For <code>hdr(NAME)</code>, <code>var(scope.NAME)</code>, etc.
              </Form.Text>
            </Form.Group>
          </Col>
          <Col md={6}>
            <Form.Group>
              <Form.Label>Operator</Form.Label>
              <Form.Select
                value={draft.operator ?? ''}
                onChange={e => update({ operator: e.target.value || undefined })}
              >
                {OPERATORS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              id="acl-case-insensitive"
              label="-i (case-insensitive)"
              checked={Boolean(draft.caseInsensitive)}
              onChange={e => update({ caseInsensitive: e.target.checked })}
            />
          </Col>
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              type="switch"
              id="acl-no-dns"
              label="-n (no DNS lookup)"
              checked={Boolean(draft.noDnsLookup)}
              onChange={e => update({ noDnsLookup: e.target.checked })}
            />
          </Col>
          {!isBoolean ? (
            <Col xs={12}>
              <Form.Group>
                <Form.Label>Values (one or more, space-separated when rendered)</Form.Label>
                <ListEditor
                  items={draft.values ?? []}
                  onChange={list => update({ values: list })}
                  placeholder="value or CIDR or regex"
                />
              </Form.Group>
            </Col>
          ) : null}
          <Col xs={12}>
            <Form.Label className="mb-1 text-muted small text-uppercase">Preview</Form.Label>
            <pre
              className="border rounded p-2 bg-body-tertiary mb-0"
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.85rem' }}
            >
              {renderPreview(draft)}
            </pre>
          </Col>
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? 'Update' : 'Add'}
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
