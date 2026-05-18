import { useState } from 'react';
import { Alert, Button, Card, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

import { ListEditor } from './ListEditor.jsx';

export const AdvancedDirectivesCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const current = draft ?? doc.globalSettings.advancedDirectives ?? [];

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    onSave({
      ...doc,
      globalSettings: { ...doc.globalSettings, advancedDirectives: current },
    })
      .then(() => {
        setStatus({ kind: 'success', message: t('haproxy:common.saved', 'Saved.') });
        setDraft(null);
      })
      .catch(err => setStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>
          {t('haproxy:advancedDirectives.title', 'Advanced global directives')}
        </Card.Title>
        <Card.Text className="text-muted small">
          {t(
            'haproxy:advancedDirectives.description',
            "Raw passthrough lines appended verbatim to the rendered global section. One directive per row. Use only for HAProxy features patchpanel doesn't model natively — these lines bypass schema validation."
          )}
        </Card.Text>
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
        <Form onSubmit={submit}>
          <ListEditor
            items={current}
            onChange={list => {
              setStatus(null);
              setDraft(list);
            }}
            placeholder={t(
              'haproxy:advancedDirectives.placeholder',
              'e.g. tune.h2.fe.max-concurrent-streams 100'
            )}
          />
          <div className="mt-3">
            <Button type="submit" variant="primary" size="sm" disabled={!draft}>
              {t('haproxy:advancedDirectives.save', 'Save advanced directives')}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

AdvancedDirectivesCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
