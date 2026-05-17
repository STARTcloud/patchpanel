import { useState } from 'react';
import { Alert, Button, Card, Form } from 'react-bootstrap';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

import { ListEditor } from './ListEditor.jsx';

export const AdvancedDirectivesCard = ({ doc, onSave }) => {
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
        setStatus({ kind: 'success', message: 'Saved.' });
        setDraft(null);
      })
      .catch(err => setStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>Advanced global directives</Card.Title>
        <Card.Text className="text-muted small">
          Raw passthrough lines appended verbatim to the rendered <code>global</code> section. One
          directive per row. Use only for HAProxy features patchpanel doesn&apos;t model natively —
          these lines bypass schema validation.
        </Card.Text>
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
        <Form onSubmit={submit}>
          <ListEditor
            items={current}
            onChange={list => {
              setStatus(null);
              setDraft(list);
            }}
            placeholder="e.g. tune.h2.fe.max-concurrent-streams 100"
          />
          <div className="mt-3">
            <Button type="submit" variant="primary" size="sm" disabled={!draft}>
              Save advanced directives
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
