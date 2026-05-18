import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Col, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { stateDocShape } from '../prop-shapes.js';

import { WizardShell } from './WizardShell.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const ACL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u;
const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/u;
const ADDR_PORT_REGEX = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/u;

const STEP_LABEL_KEYS = Object.freeze([
  { key: 'auth:autheliaWizard.steps.upstream', fallback: 'Authelia upstream' },
  { key: 'auth:autheliaWizard.steps.routing', fallback: 'Portal routing' },
  { key: 'auth:autheliaWizard.steps.names', fallback: 'Names' },
  { key: 'auth:autheliaWizard.steps.review', fallback: 'Review' },
]);

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

const AUTH_REQUEST_LUA_PATH = '/etc/haproxy/haproxy-lua-http/auth-request.lua';
const AUTH_REQUEST_LUA_NAME = 'haproxy-auth-request';
const AUTH_REQUEST_LUA_PREPEND = '/etc/haproxy';

const initialDraft = doc => {
  const httpsFrontend =
    (doc.frontends ?? []).find(f => f.mode === 'http' && f.binds?.some(b => b.ssl?.enabled)) ??
    null;
  return {
    providerId: 'authelia',
    backendServerAddress: 'authelia.example.com:9091',
    portalHost: 'auth.example.com',
    portalFrontendId: httpsFrontend?.id ?? '',
    endpointFlavor: 'forward-auth',
    apiVerifyPath: '/api/authz/forward-auth',
    backendId: 'authelia',
    backendName: 'authelia',
    aclId: 'host-authelia',
    aclName: 'host_authelia',
    routeRuleId: 'route-authelia-portal',
  };
};

const AutheliaUpstreamStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  const onFlavorChange = nextFlavor => {
    const isLegacy = nextFlavor === 'legacy';
    const defaultPath = isLegacy ? '/api/verify' : '/api/authz/forward-auth';
    const looksLikeDefault =
      draft.apiVerifyPath === '/api/verify' || draft.apiVerifyPath === '/api/authz/forward-auth';
    update({
      endpointFlavor: nextFlavor,
      apiVerifyPath: looksLikeDefault ? defaultPath : draft.apiVerifyPath,
    });
  };
  return (
    <Row className="g-3">
      <Col xs={12}>
        <Alert variant="info" className="mb-0 small">
          {t(
            'auth:autheliaWizard.upstream.intro',
            "This wizard creates 4 state entities in one shot: a Backend pointing at your Authelia server, an ACL matching the portal hostname, a use-backend Rule on the chosen HTTPS frontend that routes browser portal traffic to that backend, and the AuthProvider entity itself (referencing the new backend by id). It also registers the bundled auth-request.lua plugin under globalSettings.luaPlugins if it isn't already there. All editable later as first-class state."
          )}
        </Alert>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.upstream.versionLabel', 'Authelia version')}
          </Form.Label>
          <Form.Select value={draft.endpointFlavor} onChange={e => onFlavorChange(e.target.value)}>
            <option value="forward-auth">
              {t(
                'auth:autheliaWizard.upstream.versionForwardAuth',
                '4.38+ (/api/authz/forward-auth)'
              )}
            </option>
            <option value="legacy">
              {t('auth:autheliaWizard.upstream.versionLegacy', '≤ 4.37 (/api/verify)')}
            </option>
          </Form.Select>
          <Form.Text className="text-muted">
            {t(
              'auth:autheliaWizard.upstream.versionHelp',
              'Modern emits X-Forwarded-* before the auth probe; legacy emits a single X-Original-URL. Auto-fills the path + redirect template below.'
            )}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.upstream.serverAddressLabel', 'Authelia server address')}
          </Form.Label>
          <Form.Control
            value={draft.backendServerAddress}
            onChange={e => update({ backendServerAddress: e.target.value })}
            placeholder="assistant.example.com:9091"
          />
          <Form.Text className="text-muted">
            {t(
              'auth:autheliaWizard.upstream.serverAddressHelp',
              'host:port of your Authelia instance. Same backend serves both the lua auth probe and the browser portal.'
            )}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={12}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.upstream.endpointPathLabel', 'Authz endpoint path')}
          </Form.Label>
          <Form.Control
            value={draft.apiVerifyPath}
            onChange={e => update({ apiVerifyPath: e.target.value })}
          />
          <Form.Text className="text-muted">
            {t(
              'auth:autheliaWizard.upstream.endpointPathHelp',
              'Auto-filled from the version selector; override only if your Authelia is reverse-mounted at a non-default path.'
            )}
          </Form.Text>
        </Form.Group>
      </Col>
    </Row>
  );
};

AutheliaUpstreamStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const PortalRoutingStep = ({ draft, update, doc }) => {
  const { t } = useTranslation(['auth', 'common']);
  const httpsFrontends = (doc.frontends ?? []).filter(
    f => f.mode === 'http' && f.binds?.some(b => b.ssl?.enabled)
  );
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:autheliaWizard.routing.hostLabel', 'Portal hostname')}</Form.Label>
          <Form.Control
            value={draft.portalHost}
            onChange={e => update({ portalHost: e.target.value })}
            placeholder="auth.example.com"
          />
          <Form.Text className="text-muted">
            {t(
              'auth:autheliaWizard.routing.hostHelp',
              "The hostname users hit to reach the Authelia web portal. Make sure it's on the covering certificate's SAN list."
            )}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.routing.frontendLabel', 'HTTPS frontend hosting the portal')}
          </Form.Label>
          <Form.Select
            value={draft.portalFrontendId}
            onChange={e => update({ portalFrontendId: e.target.value })}
          >
            <option value="">{t('auth:autheliaWizard.routing.choosePrompt', '— choose —')}</option>
            {httpsFrontends.map(f => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.binds?.[0]?.address ?? '?'})
              </option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            {t(
              'auth:autheliaWizard.routing.frontendHelp',
              "The use-backend rule is inserted at the top of this frontend's rulePhases.httpRequest, so portal traffic matches before any other route on that hostname."
            )}
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

const NamesStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:autheliaWizard.names.providerId', 'AuthProvider id')}</Form.Label>
          <Form.Control
            value={draft.providerId}
            onChange={e => update({ providerId: e.target.value })}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:autheliaWizard.names.backendId', 'Backend id')}</Form.Label>
          <Form.Control
            value={draft.backendId}
            onChange={e => update({ backendId: e.target.value })}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.names.backendName', 'Backend name (HAProxy section name)')}
          </Form.Label>
          <Form.Control
            value={draft.backendName}
            onChange={e => update({ backendName: e.target.value })}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:autheliaWizard.names.aclId', 'ACL id')}</Form.Label>
          <Form.Control value={draft.aclId} onChange={e => update({ aclId: e.target.value })} />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:autheliaWizard.names.aclName', 'ACL name (HAProxy identifier)')}
          </Form.Label>
          <Form.Control value={draft.aclName} onChange={e => update({ aclName: e.target.value })} />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:autheliaWizard.names.ruleId', 'Rule id')}</Form.Label>
          <Form.Control
            value={draft.routeRuleId}
            onChange={e => update({ routeRuleId: e.target.value })}
          />
        </Form.Group>
      </Col>
    </Row>
  );
};

NamesStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const buildRedirectUrlTemplate = (portalHost, flavor) => {
  const base = `https://${portalHost}/?rd=%[var(req.scheme)]://%[base]%[var(req.questionmark)]%[query]`;
  return flavor === 'forward-auth' ? `${base}&rm=%[method]` : base;
};

const ReviewStep = ({ draft, doc }) => {
  const { t } = useTranslation(['auth', 'common']);
  const frontend = (doc.frontends ?? []).find(f => f.id === draft.portalFrontendId);
  const redirectUrlTemplate = buildRedirectUrlTemplate(draft.portalHost, draft.endpointFlavor);
  const hasAuthRequestLua = (doc.globalSettings?.luaPlugins ?? []).some(
    p => p.path === AUTH_REQUEST_LUA_PATH || p.name === AUTH_REQUEST_LUA_NAME
  );
  return (
    <div className="small">
      <h6 className="mb-3">{t('auth:autheliaWizard.review.willCreate', 'Will create:')}</h6>
      <dl className="row mb-2">
        <dt className="col-sm-4">
          {t('auth:autheliaWizard.review.versionRow', 'Authelia version')}
        </dt>
        <dd className="col-sm-8">
          <Badge bg={draft.endpointFlavor === 'legacy' ? 'warning' : 'success'} text="dark">
            {draft.endpointFlavor === 'legacy'
              ? t('auth:autheliaWizard.review.versionLegacy', '≤ 4.37 (legacy /api/verify)')
              : t('auth:autheliaWizard.review.versionForwardAuth', '4.38+ (forward-auth)')}
          </Badge>
        </dd>
        <dt className="col-sm-4">{t('auth:autheliaWizard.review.luaPluginRow', 'Lua plugin')}</dt>
        <dd className="col-sm-8">
          {hasAuthRequestLua ? (
            <span className="text-muted">
              <code>{AUTH_REQUEST_LUA_PATH}</code>{' '}
              {t('auth:autheliaWizard.review.luaAlready', 'already registered — no change')}
            </span>
          ) : (
            <>
              {t('auth:autheliaWizard.review.luaWillRegisterPrefix', 'will register')}{' '}
              <code>{AUTH_REQUEST_LUA_PATH}</code>{' '}
              {t('auth:autheliaWizard.review.luaWillRegisterSuffix', 'under')}{' '}
              <code>globalSettings.luaPlugins</code>
            </>
          )}
        </dd>
        <dt className="col-sm-4">
          {t('auth:autheliaWizard.review.authProviderRow', 'AuthProvider')}
        </dt>
        <dd className="col-sm-8">
          <code>{draft.providerId}</code> (type=authelia) →{' '}
          <code>authRequestBackendId: {draft.backendId}</code>
        </dd>
        <dt className="col-sm-4">{t('auth:autheliaWizard.review.backendRow', 'Backend')}</dt>
        <dd className="col-sm-8">
          <code>{draft.backendName}</code> ({draft.backendId}) →{' '}
          <code>{draft.backendServerAddress}</code>
        </dd>
        <dt className="col-sm-4">{t('auth:autheliaWizard.review.aclRow', 'ACL')}</dt>
        <dd className="col-sm-8">
          <code>{draft.aclName}</code> ({draft.aclId}) →{' '}
          <code>hdr(host) -m str -i {draft.portalHost}</code>
        </dd>
        <dt className="col-sm-4">
          {t('auth:autheliaWizard.review.useBackendRuleRow', 'Use-backend rule')}
        </dt>
        <dd className="col-sm-8">
          {t('auth:autheliaWizard.review.onFrontend', 'on frontend')}{' '}
          <Badge bg="primary">{frontend?.name ?? '?'}</Badge> →{' '}
          <code>
            use_backend {draft.backendName} if {draft.aclName}
          </code>
        </dd>
        <dt className="col-sm-4">
          {t('auth:autheliaWizard.review.redirectTemplateRow', 'redirect template')}
        </dt>
        <dd className="col-sm-8">
          <code className="small">{redirectUrlTemplate}</code>
        </dd>
      </dl>
      <Alert variant="info" className="small mb-0">
        {t(
          'auth:autheliaWizard.review.gatingHintPrefix',
          'After save, gating other routes is one more step: add an'
        )}{' '}
        <code>apply-auth-provider</code>{' '}
        {t('auth:autheliaWizard.review.gatingHintMiddle', 'rule on the gated frontend with')}{' '}
        <code>providerId: {draft.providerId}</code>{' '}
        {t(
          'auth:autheliaWizard.review.gatingHintSuffix',
          'and a condition matching the host you want protected. Do that from the Rules tab.'
        )}
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
        ADDR_PORT_REGEX.test(draft.backendServerAddress) &&
        Boolean(draft.apiVerifyPath?.trim()) &&
        (draft.endpointFlavor === 'legacy' || draft.endpointFlavor === 'forward-auth')
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
  const redirectUrlTemplate = buildRedirectUrlTemplate(draft.portalHost, draft.endpointFlavor);
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
      endpointFlavor: draft.endpointFlavor,
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

  // Register the bundled auth-request lua plugin in globalSettings if absent.
  // expandAutheliaProvider emits `lua.auth-intercept`, which only resolves when
  // auth-request.lua has been loaded via `lua-load` at HAProxy startup.
  const existingLuaPlugins = doc.globalSettings?.luaPlugins ?? [];
  const hasAuthRequestLua = existingLuaPlugins.some(
    p => p.path === AUTH_REQUEST_LUA_PATH || p.name === AUTH_REQUEST_LUA_NAME
  );
  const nextLuaPlugins = hasAuthRequestLua
    ? existingLuaPlugins
    : [
        ...existingLuaPlugins,
        {
          name: AUTH_REQUEST_LUA_NAME,
          path: AUTH_REQUEST_LUA_PATH,
          prependPath: AUTH_REQUEST_LUA_PREPEND,
        },
      ];

  return {
    ...doc,
    globalSettings: {
      ...(doc.globalSettings ?? {}),
      luaPlugins: nextLuaPlugins,
    },
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
  const { t } = useTranslation(['auth', 'common']);
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
  const stepLabels = STEP_LABEL_KEYS.map(entry => t(entry.key, entry.fallback));

  return (
    <WizardShell
      show={show}
      title={t('auth:autheliaWizard.title', 'Authelia setup')}
      stepLabels={stepLabels}
      currentStep={step}
      canAdvance={canAdvance}
      saving={saving}
      error={error}
      finishLabel={t('auth:autheliaWizard.finishLabel', 'Create everything')}
      onPrev={step > 0 ? () => setStep(s => s - 1) : null}
      onNext={step < STEP_LABEL_KEYS.length - 1 ? () => setStep(s => s + 1) : null}
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
