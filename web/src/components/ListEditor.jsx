import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Badge, Button, Form, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

const dedupePreservingOrder = arr => {
  const seen = new Set();
  const result = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
};

export const ListEditor = ({ items, onChange, placeholder = '', validate = null }) => {
  const { t } = useTranslation(['common']);
  const [pending, setPending] = useState('');
  const [error, setError] = useState(null);

  const uniqueItems = useMemo(() => dedupePreservingOrder(items), [items]);

  const add = () => {
    const value = pending.trim();
    if (!value) {
      return;
    }
    if (validate) {
      const result = validate(value);
      if (result !== true) {
        setError(
          typeof result === 'string' ? result : t('common:listEditor.invalidValue', 'invalid value')
        );
        return;
      }
    }
    if (uniqueItems.includes(value)) {
      setError(t('common:listEditor.duplicateEntry', 'duplicate entry'));
      return;
    }
    onChange([...uniqueItems, value]);
    setPending('');
    setError(null);
  };

  const remove = value => {
    onChange(uniqueItems.filter(item => item !== value));
  };

  return (
    <div>
      <InputGroup className="mb-2" hasValidation>
        <Form.Control
          type="text"
          value={pending}
          placeholder={placeholder}
          onChange={e => {
            setPending(e.target.value);
            setError(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          isInvalid={Boolean(error)}
        />
        <Button variant="outline-secondary" onClick={add} type="button">
          {t('common:buttons.add', 'Add')}
        </Button>
        {error ? <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback> : null}
      </InputGroup>
      <div className="d-flex flex-wrap gap-1">
        {uniqueItems.length === 0 ? (
          <span className="text-muted small">
            {t('common:listEditor.noEntries', 'No entries.')}
          </span>
        ) : (
          uniqueItems.map(item => (
            <Badge
              key={item}
              bg="secondary"
              className="d-flex align-items-start gap-2 py-2"
              style={{
                maxWidth: '100%',
                whiteSpace: 'normal',
                wordBreak: 'break-all',
                textAlign: 'left',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontWeight: 400,
              }}
            >
              <span style={{ minWidth: 0, flex: '1 1 auto' }}>{item}</span>
              <Button
                type="button"
                size="sm"
                variant="link"
                className="text-white p-0 lh-1"
                aria-label={t('common:buttons.remove', 'Remove')}
                style={{ flex: '0 0 auto' }}
                onClick={() => remove(item)}
              >
                ×
              </Button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
};

ListEditor.propTypes = {
  items: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  validate: PropTypes.func,
};
