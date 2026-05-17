import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Row, Spinner } from 'react-bootstrap';

import { apiPost } from '../api/client.js';
import { stateDocShape } from '../prop-shapes.js';

import { WizardShell } from './WizardShell.jsx';

const STEP_LABELS = Object.freeze(['Pick cert', 'Pre-flight', 'Action', 'Run']);

const formatJson = value => {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const ProviderTestBlock = ({ testing, result }) => {
  if (testing) {
    return (
      <div className="d-flex align-items-center gap-2 small text-muted">
        <Spinner as="span" animation="border" size="sm" />
        Testing provider credentials…
      </div>
    );
  }
  if (!result) {
    return null;
  }
  const ok = result.ok === true;
  return (
    <Alert variant={ok ? 'success' : 'warning'} className="mt-3 mb-0">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <strong>Provider test</strong>
        <Badge bg={ok ? 'success' : 'warning'}>{ok ? 'PASS' : 'CHECK'}</Badge>
      </div>
      {result.message ? <div className="small">{result.message}</div> : null}
      {result.details ? (
        <pre
          className="small mt-2 mb-0"
          style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}
        >
          {formatJson(result.details)}
        </pre>
      ) : null}
    </Alert>
  );
};

ProviderTestBlock.propTypes = {
  testing: PropTypes.bool.isRequired,
  result: PropTypes.object,
};

const PickCertStep = ({ draft, update, doc }) => (
  <Row className="g-3">
    <Col xs={12}>
      <Form.Group>
        <Form.Label>Which certificate are you troubleshooting?</Form.Label>
        <Form.Select value={draft.certId} onChange={e => update({ certId: e.target.value })}>
          <option value="">— choose —</option>
          {doc.tls.certs.map(c => (
            <option key={c.id} value={c.id}>
              {c.certName} ({c.id}) · {c.domains.length} SAN
              {c.domains.length === 1 ? '' : 's'} · provider {c.providerId}
            </option>
          ))}
        </Form.Select>
        {doc.tls.certs.length === 0 ? (
          <Form.Text className="text-warning">
            No certificates in state yet. Use the cert wizard first.
          </Form.Text>
        ) : null}
      </Form.Group>
    </Col>
  </Row>
);

PickCertStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: stateDocShape.isRequired,
};

const PreflightStep = ({ draft, doc, testing, testResult }) => {
  const cert = doc.tls.certs.find(c => c.id === draft.certId);
  const provider = cert ? doc.tls.providers.find(p => p.id === cert.providerId) : null;
  if (!cert) {
    return (
      <Alert variant="info" className="mb-0">
        Go back and pick a cert.
      </Alert>
    );
  }
  return (
    <div className="small">
      <dl className="row mb-0">
        <dt className="col-sm-3">certName</dt>
        <dd className="col-sm-9">
          <code>{cert.certName}</code>
        </dd>
        <dt className="col-sm-3">Domains</dt>
        <dd className="col-sm-9">
          {cert.domains.map(d => (
            <Badge key={d} bg="info" className="me-1">
              {d}
            </Badge>
          ))}
        </dd>
        <dt className="col-sm-3">TLS provider</dt>
        <dd className="col-sm-9">
          {provider ? (
            <>
              {provider.type}:<code>{provider.id}</code>{' '}
              {provider.credentialsRef ? (
                <span className="text-muted">creds {provider.credentialsRef}</span>
              ) : null}
            </>
          ) : (
            <span className="text-danger">missing provider {cert.providerId}</span>
          )}
        </dd>
      </dl>
      <ProviderTestBlock testing={testing} result={testResult} />
    </div>
  );
};

PreflightStep.propTypes = {
  draft: PropTypes.object.isRequired,
  doc: stateDocShape.isRequired,
  testing: PropTypes.bool.isRequired,
  testResult: PropTypes.object,
};

const ActionStep = ({ draft, update }) => (
  <div>
    <Form.Group>
      <Form.Label>What do you want to do?</Form.Label>
      <div className="d-flex flex-column gap-2">
        <Form.Check
          type="radio"
          id="renew-act-renew"
          name="renew-act"
          label={
            <span>
              <strong>Renew if needed.</strong> Standard renewal — certbot decides based on
              remaining lifetime.
            </span>
          }
          checked={draft.action === 'renew'}
          onChange={() => update({ action: 'renew' })}
        />
        <Form.Check
          type="radio"
          id="renew-act-force"
          name="renew-act"
          label={
            <span>
              <strong>Force renew.</strong> Re-issues even if the current cert isn&apos;t close to
              expiry. Use after switching staging↔prod or after credentials changed.
            </span>
          }
          checked={draft.action === 'force'}
          onChange={() => update({ action: 'force' })}
        />
        <Form.Check
          type="radio"
          id="renew-act-skip"
          name="renew-act"
          label={
            <span>
              <strong>Skip renewal.</strong> Close the wizard without changing anything.
            </span>
          }
          checked={draft.action === 'skip'}
          onChange={() => update({ action: 'skip' })}
        />
      </div>
    </Form.Group>
  </div>
);

ActionStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const RunStep = ({ draft, running, runResult }) => {
  if (draft.action === 'skip') {
    return (
      <Alert variant="info" className="mb-0">
        Nothing to do — click <strong>Finish</strong> to close the wizard.
      </Alert>
    );
  }
  if (running) {
    return (
      <div className="d-flex align-items-center gap-2">
        <Spinner as="span" animation="border" size="sm" />
        <span>
          Renewal in progress. DNS-01 propagation can take a couple minutes per cert — leave the
          wizard open.
        </span>
      </div>
    );
  }
  if (!runResult) {
    return (
      <Alert variant="info" className="mb-0">
        Click <strong>Run renewal</strong> to start.
      </Alert>
    );
  }
  const reloadOk = runResult.reload?.ok !== false;
  return (
    <div>
      <Alert variant={reloadOk ? 'success' : 'danger'} className="mb-2">
        {reloadOk ? 'Renewal pipeline finished.' : 'Renewal completed but HAProxy reload failed.'}
        {typeof runResult.loadableCertCount === 'number' ? (
          <> Loadable PEMs now: {runResult.loadableCertCount}.</>
        ) : null}
      </Alert>
      <pre
        className="small mb-0"
        style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap' }}
      >
        {formatJson(runResult)}
      </pre>
    </div>
  );
};

RunStep.propTypes = {
  draft: PropTypes.object.isRequired,
  running: PropTypes.bool.isRequired,
  runResult: PropTypes.object,
};

const validateStep = (step, draft) => {
  switch (step) {
    case 0:
      return Boolean(draft.certId);
    case 1:
      return true;
    case 2:
      return draft.action !== null;
    default:
      return true;
  }
};

export const CertRenewalWizard = ({ show, doc, onCancel, onComplete = null }) => {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({ certId: '', action: 'renew' });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [error, setError] = useState(null);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const runProviderTest = useCallback(async () => {
    const cert = doc.tls.certs.find(c => c.id === draft.certId);
    if (!cert) {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const data = await apiPost(`api/tls-providers/${cert.providerId}/test`);
      setTestResult({ ok: true, details: data });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err.message ?? 'provider test failed',
        details: err.payload ?? null,
      });
    } finally {
      setTesting(false);
    }
  }, [doc, draft.certId]);

  useEffect(() => {
    if (step !== 1 || !draft.certId) {
      return undefined;
    }
    const cert = doc.tls.certs.find(c => c.id === draft.certId);
    if (!cert) {
      return undefined;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) {
        return;
      }
      setTesting(true);
      setTestResult(null);
      apiPost(`api/tls-providers/${cert.providerId}/test`)
        .then(data => {
          if (cancelled) {
            return;
          }
          setTestResult({ ok: true, details: data });
        })
        .catch(err => {
          if (cancelled) {
            return;
          }
          setTestResult({
            ok: false,
            message: err.message ?? 'provider test failed',
            details: err.payload ?? null,
          });
        })
        .finally(() => {
          if (!cancelled) {
            setTesting(false);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [step, draft.certId, doc]);

  const runRenewal = async () => {
    setRunning(true);
    setError(null);
    setRunResult(null);
    try {
      const body = draft.action === 'force' ? { force: true } : {};
      const data = await apiPost(`api/certificates/${draft.certId}/renew`, body);
      setRunResult(data);
    } catch (err) {
      setError(err);
      setRunResult({ ok: false, error: err.message ?? String(err) });
    } finally {
      setRunning(false);
    }
  };

  const handleFinish = async () => {
    if (draft.action === 'skip') {
      onCancel();
      return;
    }
    if (!runResult) {
      await runRenewal();
      return;
    }
    if (onComplete) {
      onComplete();
    }
    onCancel();
  };

  const canAdvance = validateStep(step, draft);

  const finishLabel = (() => {
    if (draft.action === 'skip') {
      return 'Close';
    }
    return runResult ? 'Close' : 'Run renewal';
  })();

  return (
    <WizardShell
      show={show}
      title="Certificate renewal troubleshooter"
      stepLabels={STEP_LABELS}
      currentStep={step}
      canAdvance={canAdvance}
      saving={running}
      error={error}
      finishLabel={finishLabel}
      finishVariant={runResult || draft.action === 'skip' ? 'primary' : 'warning'}
      onPrev={
        step > 0 && !running
          ? () => {
              setStep(s => s - 1);
              setRunResult(null);
            }
          : null
      }
      onNext={step < STEP_LABELS.length - 1 ? () => setStep(s => s + 1) : null}
      onFinish={handleFinish}
      onCancel={onCancel}
    >
      {step === 0 ? <PickCertStep draft={draft} update={update} doc={doc} /> : null}
      {step === 1 ? (
        <PreflightStep draft={draft} doc={doc} testing={testing} testResult={testResult} />
      ) : null}
      {step === 2 ? <ActionStep draft={draft} update={update} /> : null}
      {step === 3 ? <RunStep draft={draft} running={running} runResult={runResult} /> : null}
      {step === 1 ? (
        <div className="mt-3">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={runProviderTest}
            disabled={testing}
          >
            {testing ? (
              <>
                <Spinner as="span" animation="border" size="sm" /> Testing…
              </>
            ) : (
              <>
                <i className="bi bi-arrow-clockwise me-1" />
                Re-run provider test
              </>
            )}
          </Button>
        </div>
      ) : null}
    </WizardShell>
  );
};

CertRenewalWizard.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: stateDocShape.isRequired,
  onCancel: PropTypes.func.isRequired,
  onComplete: PropTypes.func,
};
