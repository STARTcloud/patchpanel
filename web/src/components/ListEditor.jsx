import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

const SEPARATOR_CHARS = [' ', ',', ';', '\n', '\r', '\t'];
const SEPARATOR_REGEX = /[ ,;\n\r\t]+/u;

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

const tokenizeWithValidate = (trimmed, validate) => {
  const whole = validate(trimmed);
  if (whole === true) {
    return { tokens: [trimmed], invalid: [] };
  }
  const parts = trimmed
    .split(SEPARATOR_REGEX)
    .map(p => p.trim())
    .filter(Boolean);
  const tokens = [];
  const invalid = [];
  for (const part of parts) {
    const r = validate(part);
    if (r === true) {
      tokens.push(part);
    } else {
      invalid.push({ value: part, reason: typeof r === 'string' ? r : null });
    }
  }
  return { tokens, invalid };
};

const tokenizeNoValidate = trimmed => {
  const parts = trimmed
    .split(/[\n\r]+/u)
    .map(p => p.trim())
    .filter(Boolean);
  return { tokens: parts, invalid: [] };
};

const tokenize = (raw, validate) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { tokens: [], invalid: [] };
  }
  return validate ? tokenizeWithValidate(trimmed, validate) : tokenizeNoValidate(trimmed);
};

export const ListEditor = ({ items, onChange, placeholder = '', validate = null }) => {
  const { t } = useTranslation(['common']);
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState(null);

  const uniqueItems = useMemo(() => dedupePreservingOrder(items), [items]);

  const commitTokens = raw => {
    const { tokens, invalid } = tokenize(raw, validate);
    if (tokens.length === 0 && invalid.length === 0) {
      setPending('');
      setFeedback(null);
      return;
    }
    const next = [...uniqueItems];
    let added = 0;
    let dup = 0;
    for (const tok of tokens) {
      if (next.includes(tok)) {
        dup += 1;
      } else {
        next.push(tok);
        added += 1;
      }
    }
    if (added > 0) {
      onChange(next);
    }
    setPending('');
    if (added <= 1 && dup === 0 && invalid.length === 0) {
      setFeedback(null);
    } else {
      setFeedback({ added, dup, invalid });
    }
  };

  const handleChange = e => {
    const v = e.target.value;
    const last = v.slice(-1);
    if (last && SEPARATOR_CHARS.includes(last)) {
      const buffer = v.slice(0, -1);
      if (buffer.length === 0) {
        setPending('');
        return;
      }
      commitTokens(buffer);
      return;
    }
    setPending(v);
    setFeedback(null);
  };

  const handlePaste = e => {
    const text = e.clipboardData?.getData?.('text') ?? '';
    if (!text || !SEPARATOR_REGEX.test(text)) {
      return;
    }
    e.preventDefault();
    commitTokens(pending + text);
  };

  const handleKeyDown = e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (pending) {
        commitTokens(pending);
      }
    }
  };

  const remove = value => {
    onChange(uniqueItems.filter(item => item !== value));
  };

  const hasInvalid = feedback ? feedback.invalid.length > 0 : false;
  const feedbackVariant = hasInvalid ? 'warning' : 'info';

  return (
    <div>
      <InputGroup className="mb-2">
        <Form.Control
          type="text"
          value={pending}
          placeholder={placeholder}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
        />
        <Button variant="outline-secondary" onClick={() => commitTokens(pending)} type="button">
          {t('common:buttons.add', 'Add')}
        </Button>
      </InputGroup>
      {feedback ? (
        <Alert
          variant={feedbackVariant}
          dismissible
          onClose={() => setFeedback(null)}
          className="py-1 px-2 mb-2 small"
        >
          <div>
            {t(
              'common:listEditor.bulkSummary',
              'Added {{added}} · {{dup}} duplicate · {{invalid}} invalid',
              { added: feedback.added, dup: feedback.dup, invalid: feedback.invalid.length }
            )}
          </div>
          {hasInvalid ? (
            <ul className="mb-0 ps-3 mt-1">
              {feedback.invalid.map(inv => (
                <li key={inv.value}>
                  <code>{inv.value}</code>
                  {inv.reason ? ` — ${inv.reason}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
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
