import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Form, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { stripInternalDeep } from '../utils/entity-naming.js';
import { genKey } from '../utils/keys.js';

import { ListEditor } from './ListEditor.jsx';

// Declarative form renderer for the Phase 1 schema arrays. A field config
// looks like:
//
//   { key: 'name', label: 'Name', type: 'text', required: true, help: '…' }
//   { key: 'count', label: 'Count', type: 'number', min: 0, max: 100 }
//   { key: 'enabled', label: 'Enabled', type: 'switch' }
//   { key: 'mode', label: 'Mode', type: 'select', options: [{value, label}, …] }
//   { key: 'alpn', label: 'ALPN', type: 'string-list', itemLabel: 'protocol' }
//   { key: 'mailers', label: 'Mailers', type: 'list', minItems: 1,
//     itemLabel: 'mailer', itemFields: […same shape…] }
//   { key: 'kind', label: 'Kind', type: 'discriminated-union',
//     configKey: 'config',     // sub-fields write to draft.config.X
//                              // (null = sub-fields write at top level)
//     options: [
//       { value: 'rate-limit', label: 'Rate limit', fields: [...] },
//       { value: 'geo-block',  label: 'Geo block',  fields: [...] },
//     ],
//   }

const blankItem = itemFields => {
  const out = { _key: genKey() };
  for (const sub of itemFields) {
    if (sub.type === 'switch') {
      out[sub.key] = false;
    } else if (sub.type === 'list' || sub.type === 'string-list') {
      out[sub.key] = [];
    } else {
      out[sub.key] = '';
    }
  }
  return out;
};

const ensureListKeys = (entity, fields) => {
  if (!entity) {
    return entity;
  }
  const out = { ...entity };
  for (const field of fields) {
    if (field.type === 'list' && Array.isArray(out[field.key])) {
      out[field.key] = out[field.key].map(item => ({ ...item, _key: item._key ?? genKey() }));
    }
    if (field.type === 'discriminated-union') {
      const currentKind = out[field.key];
      const currentOption = field.options.find(o => o.value === currentKind);
      if (currentOption) {
        if (field.configKey) {
          out[field.configKey] = ensureListKeys(out[field.configKey] ?? {}, currentOption.fields);
        } else {
          const merged = ensureListKeys(out, currentOption.fields);
          Object.assign(out, merged);
        }
      }
    }
  }
  return out;
};

const TextField = ({ field, value, onChange }) => (
  <Form.Group className="mb-2">
    <Form.Label>
      {field.label}
      {field.required ? <span className="text-danger ms-1">*</span> : null}
    </Form.Label>
    <Form.Control
      type="text"
      value={value ?? ''}
      placeholder={field.placeholder ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
    {field.help ? <Form.Text className="text-muted">{field.help}</Form.Text> : null}
  </Form.Group>
);

TextField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const NumberField = ({ field, value, onChange }) => (
  <Form.Group className="mb-2">
    <Form.Label>
      {field.label}
      {field.required ? <span className="text-danger ms-1">*</span> : null}
    </Form.Label>
    <Form.Control
      type="number"
      value={value ?? ''}
      min={field.min}
      max={field.max}
      placeholder={field.placeholder ?? ''}
      onChange={e => {
        if (e.target.value === '') {
          onChange(undefined);
          return;
        }
        const parsed = Number(e.target.value);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
    />
    {field.help ? <Form.Text className="text-muted">{field.help}</Form.Text> : null}
  </Form.Group>
);

NumberField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.number,
  onChange: PropTypes.func.isRequired,
};

const SwitchField = ({ field, value, onChange }) => (
  <Form.Group className="mb-2">
    <Form.Check
      type="switch"
      id={`form-switch-${field.key}`}
      label={field.label}
      checked={Boolean(value)}
      onChange={e => onChange(e.target.checked)}
    />
    {field.help ? <Form.Text className="text-muted">{field.help}</Form.Text> : null}
  </Form.Group>
);

SwitchField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
};

const SelectField = ({ field, value, onChange }) => (
  <Form.Group className="mb-2">
    <Form.Label>
      {field.label}
      {field.required ? <span className="text-danger ms-1">*</span> : null}
    </Form.Label>
    <Form.Select
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      {field.allowEmpty ? <option value="">(none)</option> : null}
      {field.options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </Form.Select>
    {field.help ? <Form.Text className="text-muted">{field.help}</Form.Text> : null}
  </Form.Group>
);

SelectField.propTypes = {
  field: PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    required: PropTypes.bool,
    allowEmpty: PropTypes.bool,
    help: PropTypes.string,
    options: PropTypes.array.isRequired,
  }).isRequired,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

const SCALAR_RENDERERS = Object.freeze({
  text: TextField,
  number: NumberField,
  switch: SwitchField,
  select: SelectField,
});

const ScalarField = ({ field, value, onChange }) => {
  const Renderer = SCALAR_RENDERERS[field.type];
  if (!Renderer) {
    return null;
  }
  return <Renderer field={field} value={value} onChange={onChange} />;
};

ScalarField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.any,
  onChange: PropTypes.func.isRequired,
};

const StringListField = ({ field, value, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const items = value ?? [];
  const handleChange = list => onChange(list.length === 0 ? undefined : list);
  const itemLabel = field.itemLabel ?? t('haproxy:entityForm.item', 'item');
  const placeholder =
    field.placeholder ??
    t('haproxy:entityForm.addItemPlaceholder', 'Add {{label}} and press Enter', {
      label: itemLabel,
    });
  return (
    <Form.Group className="mb-2">
      <Form.Label>
        {field.label}
        {field.required ? <span className="text-danger ms-1">*</span> : null}
      </Form.Label>
      <ListEditor
        items={items}
        onChange={handleChange}
        placeholder={placeholder}
        validate={field.validate ?? null}
      />
      {field.help ? <Form.Text className="text-muted d-block mt-1">{field.help}</Form.Text> : null}
    </Form.Group>
  );
};

StringListField.propTypes = {
  field: PropTypes.object.isRequired,
  value: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
};

// Render any field type. Used recursively by ListItemEditor (below) and
// DiscriminatedUnionField (also below); references ListField which is
// declared after this in source order — the narrow no-use-before-define
// disable handles the mutual-recursion case.
const renderAnyField = (field, value, onChange) => {
  if (field.type === 'list') {
    return <ListField key={field.key} field={field} items={value} onChange={onChange} />;
  }
  if (field.type === 'string-list') {
    return <StringListField key={field.key} field={field} value={value} onChange={onChange} />;
  }
  return <ScalarField key={field.key} field={field} value={value} onChange={onChange} />;
};

const ListItemEditor = ({ item, itemFields, idx, total, minItems, onChange, onRemove }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const canRemove = total > (minItems ?? 0);
  return (
    <div className="border rounded p-2 mb-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <Badge bg="secondary">#{idx + 1}</Badge>
        <Button variant="outline-danger" size="sm" disabled={!canRemove} onClick={onRemove}>
          {t('common:buttons.remove', 'Remove')}
        </Button>
      </div>
      {itemFields.map(sub => renderAnyField(sub, item[sub.key], v => onChange(sub.key, v)))}
    </div>
  );
};

ListItemEditor.propTypes = {
  item: PropTypes.object.isRequired,
  itemFields: PropTypes.array.isRequired,
  idx: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  minItems: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const ListField = ({ field, items, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const list = items ?? [];
  const update = (idx, key, value) => {
    onChange(list.map((item, i) => (i === idx ? { ...item, [key]: value } : item)));
  };
  const remove = idx => {
    const next = list.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const add = () => {
    onChange([...list, blankItem(field.itemFields)]);
  };
  const itemLabel = field.itemLabel ?? t('haproxy:entityForm.item', 'item');
  return (
    <div className="mb-3">
      <Form.Label>
        {field.label}
        {field.required ? <span className="text-danger ms-1">*</span> : null}
      </Form.Label>
      {list.length === 0 ? (
        <p className="text-muted small mb-2">
          {t('haproxy:entityForm.noItemsYet', 'No {{label}} yet.', {
            label: field.itemLabel ?? t('haproxy:entityForm.items', 'items'),
          })}
        </p>
      ) : (
        list.map((item, idx) => (
          <ListItemEditor
            key={item._key}
            item={item}
            itemFields={field.itemFields}
            idx={idx}
            total={list.length}
            minItems={field.minItems}
            onChange={(key, value) => update(idx, key, value)}
            onRemove={() => remove(idx)}
          />
        ))
      )}
      <Button variant="outline-primary" size="sm" type="button" onClick={add}>
        {t('haproxy:entityForm.addItem', 'Add {{label}}', { label: itemLabel })}
      </Button>
      {field.help ? <Form.Text className="text-muted d-block mt-1">{field.help}</Form.Text> : null}
    </div>
  );
};

ListField.propTypes = {
  field: PropTypes.object.isRequired,
  items: PropTypes.array,
  onChange: PropTypes.func.isRequired,
};

const DiscriminatedUnionField = ({ field, kindValue, subDraft, onKindChange, onSubChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const currentKind = kindValue ?? field.options[0].value;
  const currentOption = field.options.find(o => o.value === currentKind) ?? field.options[0];
  const kindSelectField = {
    key: field.key,
    label: field.label,
    type: 'select',
    options: field.options.map(o => ({ value: o.value, label: o.label })),
    help: field.help,
    required: true,
  };
  return (
    <>
      <SelectField field={kindSelectField} value={currentKind} onChange={onKindChange} />
      <div className="border rounded p-3 mb-3 bg-body-tertiary">
        <div className="text-muted small mb-2">
          {t('haproxy:entityForm.configFor', 'Configuration for')} <code>{currentKind}</code>
        </div>
        {currentOption.fields.map(sub =>
          renderAnyField(sub, subDraft?.[sub.key], v => onSubChange(sub.key, v))
        )}
      </div>
    </>
  );
};

DiscriminatedUnionField.propTypes = {
  field: PropTypes.object.isRequired,
  kindValue: PropTypes.string,
  subDraft: PropTypes.object,
  onKindChange: PropTypes.func.isRequired,
  onSubChange: PropTypes.func.isRequired,
};

const isMissing = value => {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
};

const findMissingInList = (field, draft) => {
  for (const item of draft[field.key] ?? []) {
    // eslint-disable-next-line no-use-before-define -- mutual recursion
    const missing = findMissingRequiredField(field.itemFields, item);
    if (missing) {
      return {
        ...missing,
        label: `${field.itemLabel ?? field.label}: ${missing.label}`,
      };
    }
  }
  return null;
};

const findMissingInUnion = (field, draft) => {
  const currentKind = draft[field.key];
  if (!currentKind) {
    return field;
  }
  const currentOption = field.options.find(o => o.value === currentKind);
  if (!currentOption) {
    return null;
  }
  const sub = field.configKey ? (draft[field.configKey] ?? {}) : draft;
  // eslint-disable-next-line no-use-before-define -- mutual recursion
  const missing = findMissingRequiredField(currentOption.fields, sub);
  if (missing) {
    return { ...missing, label: `${currentKind} → ${missing.label}` };
  }
  return null;
};

const findMissingRequiredField = (fields, draft) => {
  for (const field of fields) {
    if (field.type === 'discriminated-union') {
      const missing = findMissingInUnion(field, draft);
      if (missing) {
        return missing;
      }
      continue;
    }
    if (field.required && isMissing(draft[field.key])) {
      return field;
    }
    if (field.type === 'list' && field.itemFields) {
      const missing = findMissingInList(field, draft);
      if (missing) {
        return missing;
      }
    }
  }
  return null;
};

const removeKeys = (obj, keys) => {
  const out = { ...obj };
  for (const key of keys) {
    delete out[key];
  }
  return out;
};

const collectKindSubFieldKeys = field => field.options.flatMap(opt => opt.fields.map(f => f.key));

export const EntityFormBuilder = ({
  show,
  entity = null,
  label,
  emptyTemplate,
  fields,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(() => ensureListKeys(entity ?? emptyTemplate, fields));
  const [error, setError] = useState(null);

  const setFieldValue = (key, value) => {
    setDraft(prev => {
      if (value === undefined) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const setKindValue = (field, nextKind) => {
    setDraft(prev => {
      const cleared = field.configKey
        ? { ...prev, [field.configKey]: {} }
        : removeKeys(prev, collectKindSubFieldKeys(field));
      if (nextKind === undefined) {
        const next = { ...cleared };
        delete next[field.key];
        return next;
      }
      return { ...cleared, [field.key]: nextKind };
    });
  };

  const setSubFieldValue = (configKey, subKey, value) => {
    setDraft(prev => {
      if (configKey) {
        const subDraft = { ...(prev[configKey] ?? {}) };
        if (value === undefined) {
          delete subDraft[subKey];
        } else {
          subDraft[subKey] = value;
        }
        return { ...prev, [configKey]: subDraft };
      }
      if (value === undefined) {
        const next = { ...prev };
        delete next[subKey];
        return next;
      }
      return { ...prev, [subKey]: value };
    });
  };

  const handleSave = () => {
    const missing = findMissingRequiredField(fields, draft);
    if (missing) {
      setError(
        t('haproxy:entityForm.fieldRequired', '{{label}} is required.', { label: missing.label })
      );
      return;
    }
    setError(null);
    onSave(stripInternalDeep(draft));
  };

  const isExisting = Boolean(entity?.id);

  return (
    <Modal show={show} onHide={onCancel} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('haproxy:entityForm.editTitle', 'Edit {{label}}: {{id}}', {
                label,
                id: entity.id,
              })
            : t('haproxy:entityForm.newTitle', 'New {{label}}', { label })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {fields.map(field => {
          if (field.type === 'discriminated-union') {
            const subDraft = field.configKey ? draft[field.configKey] : draft;
            return (
              <DiscriminatedUnionField
                key={field.key}
                field={field}
                kindValue={draft[field.key]}
                subDraft={subDraft}
                onKindChange={value => setKindValue(field, value)}
                onSubChange={(subKey, value) => setSubFieldValue(field.configKey, subKey, value)}
              />
            );
          }
          if (field.type === 'list') {
            return (
              <ListField
                key={field.key}
                field={field}
                items={draft[field.key]}
                onChange={value => setFieldValue(field.key, value)}
              />
            );
          }
          if (field.type === 'string-list') {
            return (
              <StringListField
                key={field.key}
                field={field}
                value={draft[field.key]}
                onChange={value => setFieldValue(field.key, value)}
              />
            );
          }
          return (
            <ScalarField
              key={field.key}
              field={field}
              value={draft[field.key]}
              onChange={value => setFieldValue(field.key, value)}
            />
          );
        })}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting
            ? t('haproxy:entityForm.updateLabel', 'Update {{label}}', { label })
            : t('haproxy:entityForm.addLabel', 'Add {{label}}', { label })}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

EntityFormBuilder.propTypes = {
  show: PropTypes.bool.isRequired,
  entity: PropTypes.object,
  label: PropTypes.string.isRequired,
  emptyTemplate: PropTypes.object.isRequired,
  fields: PropTypes.array.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
