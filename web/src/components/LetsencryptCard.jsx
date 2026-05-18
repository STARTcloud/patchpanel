import { useState } from 'react';
import { Alert, Button, Col, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const LetsencryptCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const current = draft ?? doc.letsencrypt;
  const update = patch => setDraft({ ...current, ...patch });

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    onSave({ ...doc, letsencrypt: current })
      .then(() => {
        setStatus({ kind: 'success', message: t('cert:letsencrypt.saved', 'Saved.') });
        setDraft(null);
      })
      .catch(err => {
        setStatus({ kind: 'danger', message: err.message });
      });
  };

  return (
    <>
      <p className="text-muted small mb-2">
        {t(
          'cert:letsencrypt.description',
          'Global renewal settings. Account identity (email + ACME server) lives per-account in the ACME accounts card above. Each certificate picks which account it uses.'
        )}
      </p>
      {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
      <Form onSubmit={submit}>
        <Row className="g-3">
          <Col md={4}>
            <Form.Group>
              <Form.Label>{t('cert:letsencrypt.dnsPropagation', 'DNS propagation (s)')}</Form.Label>
              <Form.Control
                type="number"
                min={30}
                max={600}
                value={current.defaultPropagationSeconds}
                onChange={e =>
                  update({
                    defaultPropagationSeconds: Number.parseInt(e.target.value, 10) || 120,
                  })
                }
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Group>
              <Form.Label>
                {t('cert:letsencrypt.renewalSchedule', 'Renewal schedule (cron)')}
              </Form.Label>
              <Form.Control
                type="text"
                value={current.renewalSchedule}
                onChange={e => update({ renewalSchedule: e.target.value })}
              />
            </Form.Group>
          </Col>
          <Col md={4}>
            <Form.Check
              type="switch"
              id="le-skip"
              label={t('cert:letsencrypt.skipRenewal', 'Skip renewal entirely')}
              checked={current.skipRenewal}
              onChange={e => update({ skipRenewal: e.target.checked })}
              className="mt-4"
            />
            <Form.Check
              type="switch"
              id="le-force"
              label={t('cert:letsencrypt.forceRenewal', 'Force renewal on next run')}
              checked={current.forceRenewal}
              onChange={e => update({ forceRenewal: e.target.checked })}
            />
          </Col>
          <Col xs={12}>
            <Button type="submit" variant="primary" disabled={!draft}>
              {t('common:buttons.save', 'Save')}
            </Button>
          </Col>
        </Row>
      </Form>
    </>
  );
};

LetsencryptCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
