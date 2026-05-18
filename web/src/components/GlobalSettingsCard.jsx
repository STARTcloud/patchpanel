import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const LOG_LEVELS = Object.freeze([
  'emerg',
  'alert',
  'crit',
  'err',
  'warning',
  'notice',
  'info',
  'debug',
]);

const toIntOr = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : fallback;
};

export const GlobalSettingsCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const current = draft ?? doc.globalSettings;
  const update = patch => {
    setStatus(null);
    setDraft({ ...current, ...patch });
  };

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    onSave({ ...doc, globalSettings: current })
      .then(() => {
        setStatus({ kind: 'success', message: t('haproxy:common.saved', 'Saved.') });
        setDraft(null);
      })
      .catch(err => setStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>{t('haproxy:globalSettings.title', 'HAProxy global block')}</Card.Title>
        <Card.Text className="text-muted small">
          {t(
            'haproxy:globalSettings.description',
            'Capacity, logging, and unique-id format. These render into the global section of haproxy.cfg. SSL / TLS, Lua plugins, QUIC tunables, and raw passthrough directives are configured in the cards below.'
          )}
        </Card.Text>
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
        <Form onSubmit={submit}>
          <h6 className="mt-2 text-uppercase text-muted small">
            {t('haproxy:globalSettings.capacity', 'Capacity')}
          </h6>
          <Row className="g-3">
            <Col md={3}>
              <Form.Group>
                <Form.Label>maxconn</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  max={2_000_000}
                  value={current.maxconn}
                  onChange={e => update({ maxconn: toIntOr(e.target.value, current.maxconn) })}
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.maxconnHelp',
                    'Per-process simultaneous connection limit. Effective value capped by fd-hard-limit / 2 - 256.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>fd-hard-limit</Form.Label>
                <Form.Control
                  type="number"
                  min={1024}
                  max={2_000_000}
                  value={current.fdHardLimit}
                  onChange={e =>
                    update({ fdHardLimit: toIntOr(e.target.value, current.fdHardLimit) })
                  }
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.fdHardLimitHelp',
                    'Hard ceiling on file descriptors HAProxy will ever request from the OS.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>tune.bufsize</Form.Label>
                <Form.Control
                  type="number"
                  min={8192}
                  value={current.tuneBufsize}
                  onChange={e =>
                    update({ tuneBufsize: toIntOr(e.target.value, current.tuneBufsize) })
                  }
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.bufsizeHelp',
                    'Per-stream buffer size in bytes. 64K covers most workloads.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <h6 className="mt-4 text-uppercase text-muted small">
            {t('haproxy:globalSettings.process', 'Process')}
          </h6>
          <Row className="g-3">
            <Col md={4}>
              <Form.Group>
                <Form.Label>hard-stop-after</Form.Label>
                <Form.Control
                  type="text"
                  value={current.hardStopAfter}
                  placeholder="30s"
                  onChange={e => update({ hardStopAfter: e.target.value })}
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.hardStopAfterHelp',
                    'Grace period for old workers to drain after a reload before SIGKILL.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>{t('haproxy:globalSettings.logLevel', 'Log level')}</Form.Label>
                <Form.Select
                  value={current.logLevel}
                  onChange={e => update({ logLevel: e.target.value })}
                >
                  {LOG_LEVELS.map(level => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.logLevelHelp',
                    'HAProxy log emit level (passed to log stdout format raw local0 X).'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <h6 className="mt-4 text-uppercase text-muted small">
            {t('haproxy:globalSettings.loggingFormat', 'Logging format')}
          </h6>
          <Row className="g-3">
            <Col md={4} className="d-flex align-items-end">
              <Form.Check
                type="switch"
                id="gs-json-log"
                label={t('haproxy:globalSettings.jsonLogs', 'Emit JSON access logs')}
                checked={current.jsonLogFormat}
                onChange={e => update({ jsonLogFormat: e.target.checked })}
              />
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>unique-id-header</Form.Label>
                <Form.Control
                  type="text"
                  value={current.uniqueIdHeader ?? ''}
                  placeholder="X-Request-ID"
                  onChange={e => update({ uniqueIdHeader: e.target.value || null })}
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.uniqueIdHeaderHelp',
                    'Header name used to surface the unique request id. Blank disables the directive.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group>
                <Form.Label>unique-id-format</Form.Label>
                <Form.Control
                  type="text"
                  value={current.uniqueIdFormat}
                  onChange={e => update({ uniqueIdFormat: e.target.value })}
                  spellCheck={false}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <Form.Text className="text-muted">
                  {t(
                    'haproxy:globalSettings.uniqueIdFormatHelp',
                    'HAProxy log-format expression. Default %{+X}o\\ %ci:%cp_%fi:%fp_%Ts_%rt:%pid is the canonical hex form per docs 8.2.1.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>

          <div className="mt-4">
            <Button type="submit" variant="primary" disabled={!draft}>
              {t('haproxy:globalSettings.save', 'Save global settings')}
            </Button>
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

GlobalSettingsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
