import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPost } from '../api/client.js';
import { stateDocShape } from '../prop-shapes.js';

import { WizardShell } from './WizardShell.jsx';

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
  const { t } = useTranslation(['cert']);
  if (testing) {
    return (
      <div className="d-flex align-items-center gap-2 small text-muted">
        <Spinner as="span" animation="border" size="sm" />
        {t('cert:renewal.providerTest.testing', 'Testing provider credentials…')}
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
        <strong>{t('cert:renewal.providerTest.label', 'Provider test')}</strong>
        <Badge bg={ok ? 'success' : 'warning'}>
          {ok
            ? t('cert:renewal.providerTest.pass', 'PASS')
            : t('cert:renewal.providerTest.check', 'CHECK')}
        </Badge>
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

const PickCertStep = ({ draft, update, doc }) => {
  const { t } = useTranslation(['cert']);
  return (
    <Row className="g-3">
      <Col xs={12}>
        <Form.Group>
          <Form.Label>
            {t('cert:renewal.pickCert.label', 'Which certificate are you troubleshooting?')}
          </Form.Label>
          <Form.Select value={draft.certId} onChange={e => update({ certId: e.target.value })}>
            <option value="">{t('cert:renewal.pickCert.choose', '— choose —')}</option>
            {doc.tls.certs.map(c => (
              <option key={c.id} value={c.id}>
                {t(
                  'cert:renewal.pickCert.option',
                  '{{certName}} ({{id}}) · {{count}} SAN · provider {{providerId}}',
                  {
                    certName: c.certName,
                    id: c.id,
                    count: c.domains.length,
                    providerId: c.providerId,
                  }
                )}
              </option>
            ))}
          </Form.Select>
          {doc.tls.certs.length === 0 ? (
            <Form.Text className="text-warning">
              {t(
                'cert:renewal.pickCert.empty',
                'No certificates in state yet. Use the cert wizard first.'
              )}
            </Form.Text>
          ) : null}
        </Form.Group>
      </Col>
    </Row>
  );
};

PickCertStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: stateDocShape.isRequired,
};

const PreflightStep = ({ draft, doc, testing, testResult }) => {
  const { t } = useTranslation(['cert']);
  const cert = doc.tls.certs.find(c => c.id === draft.certId);
  const provider = cert ? doc.tls.providers.find(p => p.id === cert.providerId) : null;
  if (!cert) {
    return (
      <Alert variant="info" className="mb-0">
        {t('cert:renewal.preflight.goBack', 'Go back and pick a cert.')}
      </Alert>
    );
  }
  return (
    <div className="small">
      <dl className="row mb-0">
        <dt className="col-sm-3">{t('cert:renewal.preflight.certName', 'certName')}</dt>
        <dd className="col-sm-9">
          <code>{cert.certName}</code>
        </dd>
        <dt className="col-sm-3">{t('cert:renewal.preflight.domains', 'Domains')}</dt>
        <dd className="col-sm-9">
          {cert.domains.map(d => (
            <Badge key={d} bg="info" className="me-1">
              {d}
            </Badge>
          ))}
        </dd>
        <dt className="col-sm-3">{t('cert:renewal.preflight.tlsProvider', 'TLS provider')}</dt>
        <dd className="col-sm-9">
          {provider ? (
            <>
              {provider.type}:<code>{provider.id}</code>{' '}
              {provider.credentialsRef ? (
                <span className="text-muted">
                  {t('cert:renewal.preflight.creds', 'creds {{ref}}', {
                    ref: provider.credentialsRef,
                  })}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-danger">
              {t('cert:renewal.preflight.missingProvider', 'missing provider {{id}}', {
                id: cert.providerId,
              })}
            </span>
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

const ActionStep = ({ draft, update }) => {
  const { t } = useTranslation(['cert']);
  return (
    <div>
      <Form.Group>
        <Form.Label>{t('cert:renewal.action.label', 'What do you want to do?')}</Form.Label>
        <div className="d-flex flex-column gap-2">
          <Form.Check
            type="radio"
            id="renew-act-renew"
            name="renew-act"
            label={
              <span>
                <strong>{t('cert:renewal.action.renew.title', 'Renew if needed.')}</strong>{' '}
                {t(
                  'cert:renewal.action.renew.desc',
                  'Standard renewal — certbot decides based on remaining lifetime.'
                )}
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
                <strong>{t('cert:renewal.action.force.title', 'Force renew.')}</strong>{' '}
                {t(
                  'cert:renewal.action.force.desc',
                  "Re-issues even if the current cert isn't close to expiry. Use after switching staging↔prod or after credentials changed."
                )}
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
                <strong>{t('cert:renewal.action.skip.title', 'Skip renewal.')}</strong>{' '}
                {t('cert:renewal.action.skip.desc', 'Close the wizard without changing anything.')}
              </span>
            }
            checked={draft.action === 'skip'}
            onChange={() => update({ action: 'skip' })}
          />
        </div>
      </Form.Group>
    </div>
  );
};

ActionStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const RunStep = ({ draft, running, runResult }) => {
  const { t } = useTranslation(['cert']);
  if (draft.action === 'skip') {
    return (
      <Alert variant="info" className="mb-0">
        {t('cert:renewal.run.skipPrefix', 'Nothing to do — click')}{' '}
        <strong>{t('cert:renewal.run.finish', 'Finish')}</strong>{' '}
        {t('cert:renewal.run.skipSuffix', 'to close the wizard.')}
      </Alert>
    );
  }
  if (running) {
    return (
      <div className="d-flex align-items-center gap-2">
        <Spinner as="span" animation="border" size="sm" />
        <span>
          {t(
            'cert:renewal.run.inProgress',
            'Renewal in progress. DNS-01 propagation can take a couple minutes per cert — leave the wizard open.'
          )}
        </span>
      </div>
    );
  }
  if (!runResult) {
    return (
      <Alert variant="info" className="mb-0">
        {t('cert:renewal.run.clickStart', 'Click')}{' '}
        <strong>{t('cert:renewal.run.startButton', 'Run renewal')}</strong>{' '}
        {t('cert:renewal.run.toStart', 'to start.')}
      </Alert>
    );
  }
  const reloadOk = runResult.reload?.ok !== false;
  return (
    <div>
      <Alert variant={reloadOk ? 'success' : 'danger'} className="mb-2">
        {reloadOk
          ? t('cert:renewal.run.finished', 'Renewal pipeline finished.')
          : t('cert:renewal.run.reloadFailed', 'Renewal completed but HAProxy reload failed.')}
        {typeof runResult.loadableCertCount === 'number' ? (
          <>
            {' '}
            {t('cert:renewal.run.loadable', 'Loadable PEMs now: {{count}}.', {
              count: runResult.loadableCertCount,
            })}
          </>
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
  const { t } = useTranslation(['cert', 'common']);
  const STEP_LABELS = useMemo(
    () => [
      t('cert:renewal.steps.pickCert', 'Pick cert'),
      t('cert:renewal.steps.preflight', 'Pre-flight'),
      t('cert:renewal.steps.action', 'Action'),
      t('cert:renewal.steps.run', 'Run'),
    ],
    [t]
  );
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
        message: err.message ?? t('cert:renewal.providerTest.failed', 'provider test failed'),
        details: err.payload ?? null,
      });
    } finally {
      setTesting(false);
    }
  }, [doc, draft.certId, t]);

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
            message: err.message ?? t('cert:renewal.providerTest.failed', 'provider test failed'),
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
  }, [step, draft.certId, doc, t]);

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
      return t('common:buttons.close', 'Close');
    }
    return runResult
      ? t('common:buttons.close', 'Close')
      : t('cert:renewal.run.startButton', 'Run renewal');
  })();

  return (
    <WizardShell
      show={show}
      title={t('cert:renewal.title', 'Certificate renewal troubleshooter')}
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
                <Spinner as="span" animation="border" size="sm" />{' '}
                {t('cert:renewal.testingShort', 'Testing…')}
              </>
            ) : (
              <>
                <i className="bi bi-arrow-clockwise me-1" />
                {t('cert:renewal.rerunProviderTest', 'Re-run provider test')}
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
