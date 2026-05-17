import PropTypes from 'prop-types';
import { Col, Form, Spinner } from 'react-bootstrap';

// Matches the server's PRESERVE_SENTINEL in lib/dns-provider-templates.js.
// When a secret field's value on PUT is this string, the server keeps the
// existing on-disk value instead of overwriting it. The GET handler masks
// every secret as `***` so editing UIs can pass values straight back through
// when the user didn't touch them.
export const PRESERVE_SENTINEL = '***';

export const stripEmptyFields = values => {
  const out = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (v === '' || v === null || v === undefined) {
      continue;
    }
    out[k] = v;
  }
  return out;
};

const FieldControl = ({ field, value, onChange }) => {
  const v = value ?? '';
  if (field.type === 'password') {
    return (
      <Form.Control
        type="password"
        value={v}
        onChange={e => onChange(e.target.value)}
        autoComplete="new-password"
      />
    );
  }
  if (field.type === 'textarea') {
    return (
      <Form.Control
        as="textarea"
        rows={6}
        value={v}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
      />
    );
  }
  if (field.type === 'integer') {
    return (
      <Form.Control
        type="number"
        value={v}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const n = Number.parseInt(raw, 10);
          onChange(Number.isInteger(n) ? n : raw);
        }}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <Form.Select value={v} onChange={e => onChange(e.target.value)}>
        {(field.options ?? []).map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Form.Select>
    );
  }
  return <Form.Control type="text" value={v} onChange={e => onChange(e.target.value)} />;
};

FieldControl.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onChange: PropTypes.func.isRequired,
};

export const TlsCredentialsForm = ({
  template,
  values,
  onChange,
  loading = false,
  exists = false,
}) => {
  if (loading) {
    return (
      <Col xs={12}>
        <div className="d-flex align-items-center gap-2 small text-muted py-2">
          <Spinner as="span" animation="border" size="sm" />
          Loading existing credentials…
        </div>
      </Col>
    );
  }
  const fields = template?.fields ?? [];
  if (fields.length === 0) {
    return null;
  }
  return (
    <>
      {fields.map(field => {
        const fullWidth = field.type === 'textarea';
        const value = values[field.key];
        const showPreservedHint = field.secret && exists && value === PRESERVE_SENTINEL;
        return (
          <Col xs={12} md={fullWidth ? 12 : 6} key={field.key}>
            <Form.Group>
              <Form.Label>
                {field.label}
                {field.required ? <span className="text-danger ms-1">*</span> : null}
                {field.secret ? (
                  <span className="ms-2 text-muted small">
                    <i className="bi bi-lock-fill" /> secret
                  </span>
                ) : null}
              </Form.Label>
              <FieldControl
                field={field}
                value={value}
                onChange={next => onChange({ ...values, [field.key]: next })}
              />
              {field.helpText ? (
                <Form.Text className="text-muted">{field.helpText}</Form.Text>
              ) : null}
              {showPreservedHint ? (
                <Form.Text className="text-info">
                  Existing value preserved on save. Clear and retype to replace.
                </Form.Text>
              ) : null}
            </Form.Group>
          </Col>
        );
      })}
    </>
  );
};

TlsCredentialsForm.propTypes = {
  template: PropTypes.shape({
    type: PropTypes.string,
    format: PropTypes.string,
    fields: PropTypes.array,
  }),
  values: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  exists: PropTypes.bool,
};
