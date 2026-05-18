import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Tab, Tabs } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const parseIntOrUndef = raw => {
  if (raw === '' || raw === null || raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
};

const triStateBoolToString = value => {
  if (value === true) {
    return 'on';
  }
  if (value === false) {
    return 'off';
  }
  return '';
};

const triStateStringToBool = value => {
  if (value === 'on') {
    return true;
  }
  if (value === 'off') {
    return false;
  }
  return undefined;
};

const SHARED_NUMERIC_FIELDS = Object.freeze([
  { key: 'ccCubicMinLosses', label: 'cc.cubic-min-losses', helpText: 'CUBIC min loss events.' },
  { key: 'ccMaxFrameLoss', label: 'cc.max-frame-loss', helpText: 'Frame-loss tolerance.' },
  {
    key: 'ccReorderRatio',
    label: 'cc.reorder-ratio',
    helpText: 'Reorder ratio (0..100).',
    min: 0,
    max: 100,
  },
  {
    key: 'secGlitchesThreshold',
    label: 'sec.glitches-threshold',
    helpText: 'Drop connection after N protocol glitches.',
  },
  { key: 'streamDataRatio', label: 'stream.data-ratio', helpText: 'Per-stream data fairness.' },
  {
    key: 'streamMaxConcurrent',
    label: 'stream.max-concurrent',
    helpText: 'Max concurrent bidi streams per connection.',
  },
]);

const SHARED_SIZE_FIELDS = Object.freeze([
  {
    key: 'ccMaxWinSize',
    label: 'cc.max-win-size',
    helpText: 'Max congestion window size (e.g. 1m).',
  },
  { key: 'streamRxbuf', label: 'stream.rxbuf', helpText: 'Per-stream receive buffer size.' },
]);

const SHARED_BOOL_FIELDS = Object.freeze([
  { key: 'ccHystart', label: 'cc.hystart', helpText: 'Enable HyStart++ slow-start.' },
  { key: 'txPacing', label: 'tx.pacing', helpText: 'Pace egress packets.' },
  { key: 'txUdpGso', label: 'tx.udp-gso', helpText: 'Use UDP GSO for egress batching.' },
]);

const FE_EXTRA_NUMERIC_FIELDS = Object.freeze([
  {
    key: 'sockPerConn',
    label: 'sock-per-conn',
    helpText: 'Per-connection sockets (fe only).',
    min: 1,
  },
  {
    key: 'secRetryThreshold',
    label: 'sec.retry-threshold',
    helpText: 'Pending-connection count that triggers Retry validation (fe only).',
  },
]);

const NumericField = ({ field, side, setSide }) => (
  <Col md={4}>
    <Form.Group className="mb-2">
      <Form.Label>{field.label}</Form.Label>
      <Form.Control
        type="number"
        min={field.min ?? 0}
        max={field.max}
        value={side[field.key] ?? ''}
        onChange={e => setSide({ [field.key]: parseIntOrUndef(e.target.value) })}
      />
      {field.helpText ? <Form.Text className="text-muted">{field.helpText}</Form.Text> : null}
    </Form.Group>
  </Col>
);

NumericField.propTypes = {
  field: PropTypes.object.isRequired,
  side: PropTypes.object.isRequired,
  setSide: PropTypes.func.isRequired,
};

const SizeField = ({ field, side, setSide }) => (
  <Col md={4}>
    <Form.Group className="mb-2">
      <Form.Label>{field.label}</Form.Label>
      <Form.Control
        type="text"
        value={side[field.key] ?? ''}
        placeholder="e.g. 1m"
        onChange={e => setSide({ [field.key]: e.target.value || undefined })}
      />
      {field.helpText ? <Form.Text className="text-muted">{field.helpText}</Form.Text> : null}
    </Form.Group>
  </Col>
);

SizeField.propTypes = {
  field: PropTypes.object.isRequired,
  side: PropTypes.object.isRequired,
  setSide: PropTypes.func.isRequired,
};

const TriStateField = ({ field, side, setSide }) => (
  <Col md={4}>
    <Form.Group className="mb-2">
      <Form.Label>{field.label}</Form.Label>
      <Form.Select
        value={triStateBoolToString(side[field.key])}
        onChange={e => setSide({ [field.key]: triStateStringToBool(e.target.value) })}
      >
        <option value="">(default)</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </Form.Select>
      {field.helpText ? <Form.Text className="text-muted">{field.helpText}</Form.Text> : null}
    </Form.Group>
  </Col>
);

TriStateField.propTypes = {
  field: PropTypes.object.isRequired,
  side: PropTypes.object.isRequired,
  setSide: PropTypes.func.isRequired,
};

const SidePanel = ({ side, setSide, includeFeExtras }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <div className="pt-3">
      <Row className="g-2">
        <Col md={4}>
          <Form.Group className="mb-2">
            <Form.Label>max-idle-timeout</Form.Label>
            <Form.Control
              type="text"
              value={side.maxIdleTimeout ?? ''}
              placeholder="e.g. 30s"
              onChange={e => setSide({ maxIdleTimeout: e.target.value || undefined })}
            />
            <Form.Text className="text-muted">
              {t('haproxy:quic.maxIdleTimeoutHelp', 'QUIC idle timeout on this side.')}
            </Form.Text>
          </Form.Group>
        </Col>
        {includeFeExtras
          ? FE_EXTRA_NUMERIC_FIELDS.map(field => (
              <NumericField key={field.key} field={field} side={side} setSide={setSide} />
            ))
          : null}
        {SHARED_NUMERIC_FIELDS.map(field => (
          <NumericField key={field.key} field={field} side={side} setSide={setSide} />
        ))}
        {SHARED_SIZE_FIELDS.map(field => (
          <SizeField key={field.key} field={field} side={side} setSide={setSide} />
        ))}
        {SHARED_BOOL_FIELDS.map(field => (
          <TriStateField key={field.key} field={field} side={side} setSide={setSide} />
        ))}
      </Row>
    </div>
  );
};

SidePanel.propTypes = {
  side: PropTypes.object.isRequired,
  setSide: PropTypes.func.isRequired,
  includeFeExtras: PropTypes.bool.isRequired,
};

const ProcessPanel = ({ current, setCurrent }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <div className="pt-3">
      <Row className="g-2">
        <Col md={4}>
          <Form.Group className="mb-2">
            <Form.Label>tune.quic.listen</Form.Label>
            <Form.Select
              value={triStateBoolToString(current.listen)}
              onChange={e =>
                setCurrent({ ...current, listen: triStateStringToBool(e.target.value) })
              }
            >
              <option value="">({t('haproxy:common.default', 'default')})</option>
              <option value="on">{t('haproxy:quic.listenOn', 'on (accept QUIC binds)')}</option>
              <option value="off">
                {t('haproxy:quic.listenOff', 'off (disable QUIC globally)')}
              </option>
            </Form.Select>
            <Form.Text className="text-muted">
              {t(
                'haproxy:quic.listenHelp',
                'Master switch for QUIC listeners. Replaces the legacy no-quic global flag.'
              )}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-2">
            <Form.Label>tune.quic.mem.tx-max</Form.Label>
            <Form.Control
              type="text"
              value={current.memTxMax ?? ''}
              placeholder="e.g. 100m"
              onChange={e => setCurrent({ ...current, memTxMax: e.target.value || undefined })}
            />
            <Form.Text className="text-muted">
              {t('haproxy:quic.memTxMaxHelp', 'Process-wide TX memory ceiling for QUIC.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={4}>
          <Form.Group className="mb-2">
            <Form.Label>tune.quic.zero-copy-fwd-send</Form.Label>
            <Form.Select
              value={triStateBoolToString(current.zeroCopyFwdSend)}
              onChange={e =>
                setCurrent({ ...current, zeroCopyFwdSend: triStateStringToBool(e.target.value) })
              }
            >
              <option value="">({t('haproxy:common.default', 'default')})</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </Form.Select>
            <Form.Text className="text-muted">
              {t(
                'haproxy:quic.zeroCopyHelp',
                'Use zero-copy egress forwarding when the kernel supports it.'
              )}
            </Form.Text>
          </Form.Group>
        </Col>
      </Row>
    </div>
  );
};

ProcessPanel.propTypes = {
  current: PropTypes.object.isRequired,
  setCurrent: PropTypes.func.isRequired,
};

const emptyQuic = () => ({ fe: {}, be: {} });

export const QuicTunablesCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const live = doc.globalSettings.quic ?? emptyQuic();
  const current = draft ?? { ...emptyQuic(), ...live, fe: { ...live.fe }, be: { ...live.be } };

  const update = next => {
    setStatus(null);
    setDraft(next);
  };

  const setFe = patch => update({ ...current, fe: { ...current.fe, ...patch } });
  const setBe = patch => update({ ...current, be: { ...current.be, ...patch } });

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    onSave({
      ...doc,
      globalSettings: { ...doc.globalSettings, quic: current },
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
        <Card.Title>{t('haproxy:quic.title', 'QUIC tunables (global)')}</Card.Title>
        <Card.Text className="text-muted small">
          {t(
            'haproxy:quic.description',
            'Process-wide and per-side QUIC knobs rendered as tune.quic.* directives in the global section. Per-bind QUIC keywords (quic-cc-algo, quic-force-retry, quic-socket) are configured per-frontend on each quic4@ / quic6@ bind. Backend QUIC requires a server address prefixed with quic4@ or quic6@.'
          )}
        </Card.Text>
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
        <Form onSubmit={submit}>
          <Tabs defaultActiveKey="process" id="quic-tunables-tabs" className="mb-1">
            <Tab eventKey="process" title={t('haproxy:quic.tabs.process', 'Process')}>
              <ProcessPanel current={current} setCurrent={update} />
            </Tab>
            <Tab eventKey="fe" title={t('haproxy:quic.tabs.frontend', 'Frontend (tune.quic.fe.*)')}>
              <SidePanel side={current.fe} setSide={setFe} includeFeExtras />
            </Tab>
            <Tab eventKey="be" title={t('haproxy:quic.tabs.backend', 'Backend (tune.quic.be.*)')}>
              <SidePanel side={current.be} setSide={setBe} includeFeExtras={false} />
            </Tab>
          </Tabs>
          <div className="mt-3 d-flex gap-2">
            <Button type="submit" variant="primary" disabled={!draft}>
              {t('haproxy:quic.save', 'Save QUIC tunables')}
            </Button>
            {draft ? (
              <Button variant="outline-secondary" onClick={() => setDraft(null)}>
                {t('haproxy:common.discard', 'Discard changes')}
              </Button>
            ) : null}
          </div>
        </Form>
      </Card.Body>
    </Card>
  );
};

QuicTunablesCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
