import PropTypes from 'prop-types';
import { useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';

// Per-type renderer for a single config field. Reads `field.type` (boolean,
// select, password, textarea, array, integer, host, url, string) and
// dispatches to the appropriate Bootstrap control. The `upload: true` flag on
// a field overrides type-based rendering with an inline file-picker that
// POSTs to /api/config/upload-file and writes the resulting path back into
// the field's value.

const fieldId = path => `cfg-${path.replace(/\./gu, '-')}`;

const fileInputId = path => `${fieldId(path)}-upload`;

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const BooleanField = ({ field, currentValue, onChange }) => (
  <Form.Check
    type="switch"
    id={fieldId(field.path)}
    label={field.label}
    checked={Boolean(currentValue)}
    onChange={e => onChange(e.target.checked)}
  />
);

BooleanField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

const SelectField = ({ field, currentValue, onChange }) => (
  <Form.Select
    id={fieldId(field.path)}
    value={currentValue ?? ''}
    onChange={e => onChange(e.target.value)}
  >
    {(field.options ?? []).map(opt => (
      <option key={opt} value={opt}>
        {opt}
      </option>
    ))}
  </Form.Select>
);

SelectField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const PasswordField = ({ field, currentValue, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [reveal, setReveal] = useState(false);
  return (
    <InputGroup>
      <Form.Control
        id={fieldId(field.path)}
        type={reveal ? 'text' : 'password'}
        value={currentValue ?? ''}
        placeholder={field.placeholder ?? ''}
        autoComplete="off"
        onChange={e => onChange(e.target.value)}
      />
      <Button
        variant="outline-secondary"
        type="button"
        onClick={() => setReveal(prev => !prev)}
        title={
          reveal ? t('haproxy:configField.hide', 'Hide') : t('haproxy:configField.show', 'Show')
        }
      >
        <i className={`bi bi-${reveal ? 'eye-slash' : 'eye'}`} />
      </Button>
    </InputGroup>
  );
};

PasswordField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const TextareaField = ({ field, currentValue, onChange }) => (
  <Form.Control
    as="textarea"
    id={fieldId(field.path)}
    rows={3}
    value={currentValue ?? ''}
    placeholder={field.placeholder ?? ''}
    onChange={e => onChange(e.target.value)}
  />
);

TextareaField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const ArrayField = ({ field, currentValue, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const text = Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue ?? '');
  return (
    <Form.Control
      id={fieldId(field.path)}
      type="text"
      value={text}
      placeholder={t('haproxy:configField.commaSeparated', 'item-1, item-2, item-3')}
      onChange={e =>
        onChange(
          e.target.value
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0)
        )
      }
    />
  );
};

ArrayField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.oneOfType([PropTypes.array, PropTypes.string]),
  onChange: PropTypes.func.isRequired,
};

const IntegerField = ({ field, currentValue, onChange }) => (
  <Form.Control
    id={fieldId(field.path)}
    type="number"
    value={currentValue ?? ''}
    min={field.validation?.min ?? undefined}
    max={field.validation?.max ?? undefined}
    placeholder={field.placeholder ?? ''}
    onChange={e => {
      if (e.target.value === '') {
        onChange(null);
        return;
      }
      const parsed = Number(e.target.value);
      onChange(Number.isInteger(parsed) ? parsed : null);
    }}
  />
);

IntegerField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.number,
  onChange: PropTypes.func.isRequired,
};

const StringField = ({ field, currentValue, onChange }) => (
  <Form.Control
    id={fieldId(field.path)}
    type="text"
    value={currentValue ?? ''}
    placeholder={field.placeholder ?? ''}
    required={field.required}
    onChange={e => onChange(e.target.value)}
  />
);

StringField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const UploadField = ({ field, currentValue, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async event => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const content = await readFileAsText(file);
      const result = await apiPost('api/config/upload-file', {
        targetPath: currentValue,
        content,
      });
      if (result?.ok && result.path) {
        onChange(result.path);
      } else {
        setError(result?.error ?? t('haproxy:configField.uploadFailed', 'upload failed'));
      }
    } catch (err) {
      setError(
        err.payload?.error ?? err.message ?? t('haproxy:configField.uploadFailed', 'upload failed')
      );
    } finally {
      setBusy(false);
      // Reset the file input so the same file can be re-picked after a failed
      // upload attempt — browsers otherwise refuse to re-fire onChange.

      event.target.value = '';
    }
  };

  return (
    <>
      <InputGroup>
        <Form.Control
          id={fieldId(field.path)}
          type="text"
          value={currentValue ?? ''}
          placeholder={field.placeholder ?? ''}
          onChange={e => onChange(e.target.value)}
        />
        <Form.Label
          className="btn btn-outline-secondary mb-0 d-inline-flex align-items-center"
          htmlFor={fileInputId(field.path)}
        >
          <i className="bi bi-upload me-1" />
          {busy
            ? t('haproxy:configField.uploading', 'Uploading…')
            : t('haproxy:configField.upload', 'Upload')}
        </Form.Label>
        <Form.Control
          id={fileInputId(field.path)}
          type="file"
          className="d-none"
          disabled={busy}
          onChange={handleFile}
        />
      </InputGroup>
      {error ? <Form.Text className="text-danger d-block">{error}</Form.Text> : null}
    </>
  );
};

UploadField.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const TYPE_RENDERERS = Object.freeze({
  boolean: BooleanField,
  select: SelectField,
  password: PasswordField,
  textarea: TextareaField,
  array: ArrayField,
  integer: IntegerField,
});

const InputByType = ({ field, currentValue, onChange }) => {
  if (field.upload) {
    return <UploadField field={field} currentValue={currentValue} onChange={onChange} />;
  }
  const Renderer = TYPE_RENDERERS[field.type];
  if (Renderer) {
    return <Renderer field={field} currentValue={currentValue} onChange={onChange} />;
  }
  return <StringField field={field} currentValue={currentValue} onChange={onChange} />;
};

InputByType.propTypes = {
  field: PropTypes.object.isRequired,
  currentValue: PropTypes.any,
  onChange: PropTypes.func.isRequired,
};

const HelperText = ({ description, error }) => (
  <>
    {description ? <Form.Text className="text-muted">{description}</Form.Text> : null}
    {error ? <Form.Text className="text-danger d-block">{error}</Form.Text> : null}
  </>
);

HelperText.propTypes = {
  description: PropTypes.string,
  error: PropTypes.string,
};

export const ConfigFieldRenderer = ({ field, currentValue, onChange, error = null }) => {
  // Boolean (switch) carries its own label; everything else gets a Form.Label.
  if (field.type === 'boolean' && !field.upload) {
    return (
      <Form.Group className="mb-2">
        <InputByType field={field} currentValue={currentValue} onChange={onChange} />
        <HelperText description={field.description} error={error} />
      </Form.Group>
    );
  }
  return (
    <Form.Group className="mb-2">
      <Form.Label htmlFor={fieldId(field.path)}>
        {field.label}
        {field.required ? <span className="text-danger ms-1">*</span> : null}
      </Form.Label>
      <InputByType field={field} currentValue={currentValue} onChange={onChange} />
      <HelperText description={field.description} error={error} />
    </Form.Group>
  );
};

ConfigFieldRenderer.propTypes = {
  field: PropTypes.shape({
    path: PropTypes.string.isRequired,
    type: PropTypes.string.isRequired,
    label: PropTypes.string,
    description: PropTypes.string,
    placeholder: PropTypes.string,
    required: PropTypes.bool,
    upload: PropTypes.bool,
    options: PropTypes.array,
    validation: PropTypes.shape({
      min: PropTypes.number,
      max: PropTypes.number,
    }),
  }).isRequired,
  currentValue: PropTypes.any,
  onChange: PropTypes.func.isRequired,
  error: PropTypes.string,
};
