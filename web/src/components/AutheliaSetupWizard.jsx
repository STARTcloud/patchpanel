import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Col, Form, Row } from 'react-bootstrap';

import { stateDocShape } from '../prop-shapes.js';

import { WizardShell } from './WizardShell.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const ACL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u;
const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/u;
const ADDR_PORT_REGEX = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/u;

const STEP_LABELS = Object.freeze(['Authelia upstream', 'Portal routing', 'Names', 'Review']);

const slugifyId = source =>
  source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 63) || 'authelia';

const slugifyName = source =>
  source
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 63) || 'authelia';

const uniqueIn = (proposed, taken) => {
  if (!taken.has(proposed)) {
    return proposed;
  }
  let s = 2;
  let cand = `${proposed}-${s}`;
  while (taken.has(cand)) {
    s += 1;
    cand = `${proposed}-${s}`;
  }
  return cand;
};

const uniqueNameIn = (proposed, taken) => {
  if (!taken.has(proposed)) {
    return proposed;
  }
  let s = 2;
  let cand = `${proposed}_${s}`;
  while (taken.has(cand)) {
    s += 1;
    cand = `${proposed}_${s}`;
  }
  return cand;
};

const initialDraft = doc => {
  const httpsFrontend =
    (doc.frontends ?? []).find(f => f.mode === 'http' && f.binds?.some(b => b.ssl?.enabled)) ??
    null;
  return {
    providerId: 'authelia',
    backendServerAddress: 'authelia.example.com:9091',
    portalHost: 'auth.example.com',
    portalFrontendId: httpsFrontend?.id ?? '',
    apiVerifyPath: '/api/authz/forward-auth',
    backendId: 'authelia',
    backendName: 'authelia',
    aclId: 'host-authelia',
    aclName: 'host_authelia',
    routeRuleId: 'route-authelia-portal',
  };
};

const AutheliaUpstreamStep = ({ draft, update }) => (
  <Row className="g-3">
    <Col xs={12}>
      <Alert variant="info" className="mb-0 small">
        This wizard creates 4 state entities in one shot: a <strong>Backend</strong> pointing at
        your Authelia server, an <strong>ACL</strong> matching the portal hostname, a{' '}
        <strong>use-backend Rule</strong> on the chosen HTTPS frontend that routes browser portal
        traffic to that backend, and the <strong>AuthProvider</strong> entity itself (referencing
        the new backend by id). All editable later as first-class state.
      </Alert>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Authelia server address</Form.Label>
        <Form.Control
          value={draft.backendServerAddress}
          onChange={e => update({ backendServerAddress: e.target.value })}
          placeholder="assistant.example.com:9091"
        />
        <Form.Text className="text-muted">
          host:port of your Authelia instance. The same backend serves the lua auth-intercept{' '}
          <code>/api/authz/forward-auth</code> probe and the browser portal.
        </Form.Text>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Authz endpoint path</Form.Label>
        <Form.Control
          value={draft.apiVerifyPath}
          onChange={e => update({ apiVerifyPath: e.target.value })}
        />
        <Form.Text className="text-muted">
          Authelia 4.38+ canonical: <code>/api/authz/forward-auth</code>. Legacy:{' '}
          <code>/api/verify</code>.
        </Form.Text>
      </Form.Group>
    </Col>
  </Row>
);

AutheliaUpstreamStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const PortalRoutingStep = ({ draft, update, doc }) => {
  const httpsFrontends = (doc.frontends ?? []).filter(
    f => f.mode === 'http' && f.binds?.some(b => b.ssl?.enabled)
  );
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>Portal hostname</Form.Label>
          <Form.Control
            value={draft.portalHost}
            onChange={e => update({ portalHost: e.target.value })}
            placeholder="auth.example.com"
          />
          <Form.Text className="text-muted">
            The hostname users hit to reach the Authelia web portal. Make sure it&apos;s on the
            covering certificate&apos;s SAN list.
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>HTTPS frontend hosting the portal</Form.Label>
          <Form.Select
            value={draft.portalFrontendId}
            onChange={e => update({ portalFrontendId: e.target.value })}
          >
            <option value="">— choose —</option>
            {httpsFrontends.map(f => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.binds?.[0]?.address ?? '?'})
              </option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            The use-backend rule is inserted at the top of this frontend&apos;s
            <code> rulePhases.httpRequest</code>, so portal traffic matches before any other route
            on that hostname.
          </Form.Text>
        </Form.Group>
      </Col>
    </Row>
  );
};

PortalRoutingStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: PropTypes.object.isRequired,
};

const NamesStep = ({ draft, update }) => (
  <Row className="g-3">
    <Col md={6}>
      <Form.Group>
        <Form.Label>AuthProvider id</Form.Label>
        <Form.Control
          value={draft.providerId}
          onChange={e => update({ providerId: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Backend id</Form.Label>
        <Form.Control
          value={draft.backendId}
          onChange={e => update({ backendId: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Backend name (HAProxy section name)</Form.Label>
        <Form.Control
          value={draft.backendName}
          onChange={e => update({ backendName: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>ACL id</Form.Label>
        <Form.Control value={draft.aclId} onChange={e => update({ aclId: e.target.value })} />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>ACL name (HAProxy identifier)</Form.Label>
        <Form.Control value={draft.aclName} onChange={e => update({ aclName: e.target.value })} />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Rule id</Form.Label>
        <Form.Control
          value={draft.routeRuleId}
          onChange={e => update({ routeRuleId: e.target.value })}
        />
      </Form.Group>
    </Col>
  </Row>
);

NamesStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const ReviewStep = ({ draft, doc }) => {
  const frontend = (doc.frontends ?? []).find(f => f.id === draft.portalFrontendId);
  const redirectUrlTemplate = `https://${draft.portalHost}/?rd=%[var(req.scheme)]://%[base]%[var(req.questionmark)]%[query]`;
  return (
    <div className="small">
      <h6 className="mb-3">Will create:</h6>
      <dl className="row mb-2">
        <dt className="col-sm-4">AuthProvider</dt>
        <dd className="col-sm-8">
          <code>{draft.providerId}</code> (type=authelia) →{' '}
          <code>authRequestBackendId: {draft.backendId}</code>
        </dd>
        <dt className="col-sm-4">Backend</dt>
        <dd className="col-sm-8">
          <code>{draft.backendName}</code> ({draft.backendId}) →{' '}
          <code>{draft.backendServerAddress}</code>
        </dd>
        <dt className="col-sm-4">ACL</dt>
        <dd className="col-sm-8">
          <code>{draft.aclName}</code> ({draft.aclId}) →{' '}
          <code>hdr(host) -m str -i {draft.portalHost}</code>
        </dd>
        <dt className="col-sm-4">Use-backend rule</dt>
        <dd className="col-sm-8">
          on frontend <Badge bg="primary">{frontend?.name ?? '?'}</Badge> →{' '}
          <code>
            use_backend {draft.backendName} if {draft.aclName}
          </code>
        </dd>
        <dt className="col-sm-4">redirect template</dt>
        <dd className="col-sm-8">
          <code className="small">{redirectUrlTemplate}</code>
        </dd>
      </dl>
      <Alert variant="info" className="small mb-0">
        After save, gating other routes is one more step: add an <code>apply-auth-provider</code>{' '}
        rule on the gated frontend with <code>providerId: {draft.providerId}</code> and a condition
        matching the host you want protected. Do that from the Rules tab.
      </Alert>
    </div>
  );
};

ReviewStep.propTypes = {
  draft: PropTypes.object.isRequired,
  doc: PropTypes.object.isRequired,
};

const validateStep = (step, draft, doc) => {
  switch (step) {
    case 0:
      return (
        ADDR_PORT_REGEX.test(draft.backendServerAddress) && Boolean(draft.apiVerifyPath?.trim())
      );
    case 1:
      return (
        HOSTNAME_REGEX.test(draft.portalHost) &&
        Boolean(draft.portalFrontendId) &&
        (doc.frontends ?? []).some(f => f.id === draft.portalFrontendId)
      );
    case 2:
      return (
        ID_REGEX.test(draft.providerId) &&
        ID_REGEX.test(draft.backendId) &&
        ACL_NAME_REGEX.test(draft.backendName) &&
        ID_REGEX.test(draft.aclId) &&
        ACL_NAME_REGEX.test(draft.aclName) &&
        ID_REGEX.test(draft.routeRuleId)
      );
    default:
      return true;
  }
};

const buildNextDoc = (draft, doc) => {
  const redirectUrlTemplate = `https://${draft.portalHost}/?rd=%[var(req.scheme)]://%[base]%[var(req.questionmark)]%[query]`;
  const newBackend = {
    id: draft.backendId,
    name: draft.backendName,
    mode: 'http',
    balance: 'roundrobin',
    servers: [
      {
        name: 'authelia',
        address: draft.backendServerAddress,
        check: true,
        ssl: false,
        backup: false,
        sendProxy: 'none',
        advancedDirectives: [],
      },
    ],
    options: [],
    timeouts: {},
    forwardFor: false,
    advancedDirectives: [],
  };
  const newAcl = {
    id: draft.aclId,
    name: draft.aclName,
    description: `Authelia portal hostname (${draft.portalHost})`,
    field: 'hdr',
    fieldArg: 'host',
    operator: 'str',
    values: [draft.portalHost],
    caseInsensitive: true,
    noDnsLookup: false,
  };
  const newRule = {
    id: draft.routeRuleId,
    name: 'Authelia portal',
    enabled: true,
    action: { type: 'use-backend', backendId: draft.backendId },
    condition: [{ kind: 'aclRef', aclName: draft.aclName, negate: false, combineWithNext: 'and' }],
  };
  const newProvider = {
    id: draft.providerId,
    type: 'authelia',
    config: {
      authRequestBackendId: draft.backendId,
      redirectUrlTemplate,
      apiVerifyPath: draft.apiVerifyPath,
      propagateHeaders: ['remote-user', 'remote-groups', 'remote-name', 'remote-email'],
    },
  };
  const nextFrontends = (doc.frontends ?? []).map(fe => {
    if (fe.id !== draft.portalFrontendId) {
      return fe;
    }
    const phases = fe.rulePhases ?? {};
    const httpRequest = [newRule, ...(phases.httpRequest ?? [])];
    return { ...fe, rulePhases: { ...phases, httpRequest } };
  });
  return {
    ...doc,
    backends: [...(doc.backends ?? []), newBackend],
    acls: [...(doc.acls ?? []), newAcl],
    authProviders: [...(doc.authProviders ?? []), newProvider],
    frontends: nextFrontends,
  };
};

const collisionFreeDraft = (draft, doc) => {
  const takenProviderIds = new Set((doc.authProviders ?? []).map(p => p.id));
  const takenBackendIds = new Set((doc.backends ?? []).map(b => b.id));
  const takenBackendNames = new Set((doc.backends ?? []).map(b => b.name));
  const takenAclIds = new Set((doc.acls ?? []).map(a => a.id));
  const takenAclNames = new Set((doc.acls ?? []).map(a => a.name));
  const takenRuleIds = new Set();
  for (const fe of doc.frontends ?? []) {
    for (const r of fe.rulePhases?.httpRequest ?? []) {
      takenRuleIds.add(r.id);
    }
  }
  return {
    ...draft,
    providerId: uniqueIn(slugifyId(draft.providerId), takenProviderIds),
    backendId: uniqueIn(slugifyId(draft.backendId), takenBackendIds),
    backendName: uniqueNameIn(slugifyName(draft.backendName), takenBackendNames),
    aclId: uniqueIn(slugifyId(draft.aclId), takenAclIds),
    aclName: uniqueNameIn(slugifyName(draft.aclName), takenAclNames),
    routeRuleId: uniqueIn(slugifyId(draft.routeRuleId), takenRuleIds),
  };
};

export const AutheliaSetupWizard = ({ show, doc, onComplete, onCancel }) => {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const initial = useMemo(() => collisionFreeDraft(initialDraft(doc), doc), [doc]);
  const [draft, setDraft] = useState(initial);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      await onComplete(buildNextDoc(draft, doc));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const canAdvance = validateStep(step, draft, doc);

  return (
    <WizardShell
      show={show}
      title="Authelia setup"
      stepLabels={STEP_LABELS}
      currentStep={step}
      canAdvance={canAdvance}
      saving={saving}
      error={error}
      finishLabel="Create everything"
      onPrev={step > 0 ? () => setStep(s => s - 1) : null}
      onNext={step < STEP_LABELS.length - 1 ? () => setStep(s => s + 1) : null}
      onFinish={handleFinish}
      onCancel={onCancel}
    >
      {step === 0 ? <AutheliaUpstreamStep draft={draft} update={update} /> : null}
      {step === 1 ? <PortalRoutingStep draft={draft} update={update} doc={doc} /> : null}
      {step === 2 ? <NamesStep draft={draft} update={update} /> : null}
      {step === 3 ? <ReviewStep draft={draft} doc={doc} /> : null}
    </WizardShell>
  );
};

AutheliaSetupWizard.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: stateDocShape.isRequired,
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
