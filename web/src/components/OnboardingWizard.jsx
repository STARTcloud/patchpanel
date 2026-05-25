import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Col, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiPut } from '../api/client.js';
import { stateDocShape } from '../prop-shapes.js';
import { collectRuleIds, slugifyId, slugifyName, uniquify } from '../utils/entity-naming.js';
import { ADDR_PORT_REGEX, EMAIL_REGEX, HOSTNAME_REGEX, ID_REGEX } from '../utils/regexes.js';

import { ListEditor } from './ListEditor.jsx';
import { WizardShell } from './WizardShell.jsx';

const STEP_LABEL_KEYS = Object.freeze([
  { key: 'auth:onboardingWizard.steps.welcome', fallback: 'Welcome' },
  { key: 'auth:onboardingWizard.steps.account', fallback: 'Account & ACME' },
  { key: 'auth:onboardingWizard.steps.backend', fallback: 'Backend' },
  { key: 'auth:onboardingWizard.steps.frontend', fallback: 'Frontend' },
  { key: 'auth:onboardingWizard.steps.firstRoute', fallback: 'First route' },
  { key: 'auth:onboardingWizard.steps.review', fallback: 'Review' },
]);

const PROVIDER_OPTIONS = Object.freeze([
  {
    value: 'cloudflare',
    labelKey: 'auth:onboardingWizard.provider.cloudflareLabel',
    labelFallback: 'Cloudflare DNS-01',
    descriptionKey: 'auth:onboardingWizard.provider.cloudflareDescription',
    descriptionFallback:
      "Best for wildcards and when port 80 isn't reachable. Requires a Cloudflare API token (collected below).",
    providerType: 'dns-cloudflare',
  },
  {
    value: 'http-01',
    labelKey: 'auth:onboardingWizard.provider.http01Label',
    labelFallback: "Let's Encrypt HTTP-01 webroot",
    descriptionKey: 'auth:onboardingWizard.provider.http01Description',
    descriptionFallback:
      'Works with any DNS host. Requires port 80 reachable from the public Internet.',
    providerType: 'http-01',
  },
]);

const slugId = source => slugifyId(source, { fallback: 'default' });
const slugName = source => slugifyName(source, { fallback: 'default' });

const emptyDraft = () => ({
  email: '',
  provider: 'cloudflare',
  cloudflareApiToken: '',
  backendName: 'default',
  backendServerAddress: '',
  frontendName: 'https-in',
  frontendBindAddress: '*:443',
  routeHostname: '',
  extraCertDomains: [],
});

const WelcomeStep = () => {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <Alert variant="info" className="mb-0">
      <h6 className="mb-2">
        <i className="bi bi-stars me-2" />
        {t('auth:onboardingWizard.welcome.title', 'Set up your first working route')}
      </h6>
      <p className="small mb-2">
        {t(
          'auth:onboardingWizard.welcome.body1',
          'This wizard walks through six short steps to produce an end-to-end working state — a defaults block, frontend, backend, ACL + use-backend rule, TLS provider, and covering cert. The output runs through the standard apply pipeline (schema validate → render → haproxy -c → atomic write → master-socket reload).'
        )}
      </p>
      <p className="small mb-0">
        {t(
          'auth:onboardingWizard.welcome.body2',
          'Re-running this on an already-configured install adds new entities with collision-safe ids; existing ones are left alone.'
        )}
      </p>
    </Alert>
  );
};

const IdentityStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  const emailValid = EMAIL_REGEX.test(draft.email);
  return (
    <Row className="g-3">
      <Col md={8}>
        <Form.Group>
          <Form.Label>
            {t('auth:onboardingWizard.identity.emailLabel', "Let's Encrypt account email")}
          </Form.Label>
          <Form.Control
            type="email"
            value={draft.email}
            onChange={e => update({ email: e.target.value })}
            placeholder="you@example.com"
            isInvalid={draft.email !== '' ? !emailValid : null}
          />
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Label>
          {t('auth:onboardingWizard.identity.providerLabel', 'ACME provider')}
        </Form.Label>
        <div className="d-flex flex-column gap-2">
          {PROVIDER_OPTIONS.map(opt => (
            <Form.Check
              key={opt.value}
              type="radio"
              id={`onboarding-provider-${opt.value}`}
              name="onboarding-provider"
              label={
                <span>
                  <strong>{t(opt.labelKey, opt.labelFallback)}</strong>
                  <span className="ms-2 text-muted small">
                    {t(opt.descriptionKey, opt.descriptionFallback)}
                  </span>
                </span>
              }
              checked={draft.provider === opt.value}
              onChange={() => update({ provider: opt.value })}
            />
          ))}
        </div>
      </Col>
      {draft.provider === 'cloudflare' ? (
        <Col xs={12}>
          <Form.Group>
            <Form.Label>
              {t('auth:onboardingWizard.identity.cloudflareTokenLabel', 'Cloudflare API token')}
            </Form.Label>
            <Form.Control
              type="password"
              value={draft.cloudflareApiToken}
              onChange={e => update({ cloudflareApiToken: e.target.value })}
              placeholder={t(
                'auth:onboardingWizard.identity.cloudflareTokenPlaceholder',
                'Scoped Zone → DNS → Edit token'
              )}
              autoComplete="new-password"
            />
            <Form.Text className="text-muted">
              {t(
                'auth:onboardingWizard.identity.cloudflareTokenHelpPrefix',
                'Create a scoped API token in the Cloudflare dashboard with'
              )}{' '}
              <code>Zone : DNS : Edit</code>{' '}
              {t(
                'auth:onboardingWizard.identity.cloudflareTokenHelpSuffix',
                'on the zone(s) you want to issue certs for. patchpanel writes the token to a mode-600 file in the credentials directory; it never leaves the addon.'
              )}
            </Form.Text>
          </Form.Group>
        </Col>
      ) : null}
    </Row>
  );
};

IdentityStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const BackendStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:onboardingWizard.backend.nameLabel', 'Backend name')}</Form.Label>
          <Form.Control
            value={draft.backendName}
            onChange={e => update({ backendName: e.target.value })}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:onboardingWizard.backend.serverAddressLabel', 'Server address')}
          </Form.Label>
          <Form.Control
            value={draft.backendServerAddress}
            onChange={e => update({ backendServerAddress: e.target.value })}
            placeholder="10.0.0.10:8080"
          />
        </Form.Group>
      </Col>
    </Row>
  );
};

BackendStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const FrontendStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('auth:onboardingWizard.frontend.nameLabel', 'Frontend name')}</Form.Label>
          <Form.Control
            value={draft.frontendName}
            onChange={e => update({ frontendName: e.target.value })}
          />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('auth:onboardingWizard.frontend.bindAddressLabel', 'Bind address')}
          </Form.Label>
          <Form.Control
            value={draft.frontendBindAddress}
            onChange={e => update({ frontendBindAddress: e.target.value })}
            placeholder="*:443"
          />
          <Form.Text className="text-muted">
            {t(
              'auth:onboardingWizard.frontend.bindAddressHelpPrefix',
              'TLS bind. The wizard wires'
            )}{' '}
            <code>ssl crt-list /etc/haproxy/certs.list</code>{' '}
            {t('auth:onboardingWizard.frontend.bindAddressHelpSuffix', 'for SNI cert selection.')}
          </Form.Text>
        </Form.Group>
      </Col>
    </Row>
  );
};

FrontendStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const RouteStep = ({ draft, update }) => {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <Row className="g-3">
      <Col md={8}>
        <Form.Group>
          <Form.Label>
            {t('auth:onboardingWizard.route.hostnameLabel', 'Public hostname')}
          </Form.Label>
          <Form.Control
            value={draft.routeHostname}
            onChange={e => update({ routeHostname: e.target.value })}
            placeholder="home.example.com"
          />
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>
            {t('auth:onboardingWizard.route.extraSansLabel', 'Extra cert SANs (optional)')}
          </Form.Label>
          <ListEditor
            items={draft.extraCertDomains}
            onChange={list => update({ extraCertDomains: list })}
            placeholder={t(
              'auth:onboardingWizard.route.extraSansPlaceholder',
              'e.g. www.example.com or *.example.com'
            )}
            validate={value =>
              HOSTNAME_REGEX.test(value)
                ? true
                : t('auth:onboardingWizard.route.invalidDomain', 'invalid domain')
            }
          />
        </Form.Group>
      </Col>
    </Row>
  );
};

RouteStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
};

const ReviewStep = ({ draft }) => {
  const { t } = useTranslation(['auth', 'common']);
  const providerOpt = PROVIDER_OPTIONS.find(p => p.value === draft.provider);
  const domains = [draft.routeHostname, ...draft.extraCertDomains].filter(Boolean);
  const willWriteCloudflareToken =
    draft.provider === 'cloudflare' && draft.cloudflareApiToken.trim().length > 0;
  return (
    <div className="small">
      <h6 className="mb-3">{t('auth:onboardingWizard.review.willCreate', 'Will create')}</h6>
      <dl className="row mb-0">
        <dt className="col-sm-4">
          {t('auth:onboardingWizard.review.emailRow', "Let's Encrypt email")}
        </dt>
        <dd className="col-sm-8">
          <code>{draft.email}</code>
        </dd>
        <dt className="col-sm-4">
          {t('auth:onboardingWizard.review.providerRow', 'ACME provider')}
        </dt>
        <dd className="col-sm-8">
          {providerOpt ? t(providerOpt.labelKey, providerOpt.labelFallback) : '—'}
          {willWriteCloudflareToken ? (
            <Badge bg="success" className="ms-2">
              {t('auth:onboardingWizard.review.tokenStoredBadge', 'token will be stored')}
            </Badge>
          ) : null}
        </dd>
        <dt className="col-sm-4">
          {t('auth:onboardingWizard.review.defaultsBlockRow', 'Defaults block')}
        </dt>
        <dd className="col-sm-8">
          <code>default</code>{' '}
          {t('auth:onboardingWizard.review.defaultsBlockDetail', '(mode http, sensible timeouts)')}
        </dd>
        <dt className="col-sm-4">{t('auth:onboardingWizard.review.backendRow', 'Backend')}</dt>
        <dd className="col-sm-8">
          <code>{draft.backendName}</code> → <code>{draft.backendServerAddress}</code>
        </dd>
        <dt className="col-sm-4">{t('auth:onboardingWizard.review.frontendRow', 'Frontend')}</dt>
        <dd className="col-sm-8">
          <code>{draft.frontendName}</code> {t('auth:onboardingWizard.review.frontendOn', 'on')}{' '}
          <code>{draft.frontendBindAddress}</code>
        </dd>
        <dt className="col-sm-4">{t('auth:onboardingWizard.review.aclRow', 'ACL + rule')}</dt>
        <dd className="col-sm-8">
          host_{slugName(draft.routeHostname || 'host')} →{' '}
          {t('auth:onboardingWizard.review.useBackend', 'use-backend')}{' '}
          <code>{draft.backendName}</code>
        </dd>
        <dt className="col-sm-4">
          {t('auth:onboardingWizard.review.certSansRow', 'Certificate SANs')}
        </dt>
        <dd className="col-sm-8">
          {domains.map(d => (
            <Badge bg="info" key={d} className="me-1">
              {d}
            </Badge>
          ))}
        </dd>
      </dl>
      <Alert variant="light" className="border small mt-3 mb-0">
        {t('auth:onboardingWizard.review.applyHintPrefix', 'Clicking')}{' '}
        <strong>{t('auth:onboardingWizard.applySetup', 'Apply setup')}</strong>{' '}
        {t('auth:onboardingWizard.review.applyHintWrites', 'writes state')}
        {willWriteCloudflareToken
          ? t(
              'auth:onboardingWizard.review.applyHintStoresToken',
              ' and stores the Cloudflare API token'
            )
          : ''}
        .{' '}
        {t(
          'auth:onboardingWizard.review.applyHintRenewPrefix',
          "The cert isn't issued automatically — open the Certificates tab and click"
        )}{' '}
        <strong>{t('auth:onboardingWizard.review.renewLabel', 'Renew')}</strong>{' '}
        {t('auth:onboardingWizard.review.applyHintRenewSuffix', 'after the wizard closes.')}
      </Alert>
    </div>
  );
};

ReviewStep.propTypes = {
  draft: PropTypes.object.isRequired,
};

const validateStep = (step, draft) => {
  switch (step) {
    case 0:
      return true;
    case 1: {
      const baseOk =
        EMAIL_REGEX.test(draft.email) && PROVIDER_OPTIONS.some(p => p.value === draft.provider);
      if (!baseOk) {
        return false;
      }
      if (draft.provider === 'cloudflare') {
        return draft.cloudflareApiToken.trim().length > 0;
      }
      return true;
    }
    case 2:
      return (
        ID_REGEX.test(slugId(draft.backendName)) && ADDR_PORT_REGEX.test(draft.backendServerAddress)
      );
    case 3:
      return (
        ID_REGEX.test(slugId(draft.frontendName)) && draft.frontendBindAddress.trim().length > 0
      );
    case 4:
      return HOSTNAME_REGEX.test(draft.routeHostname);
    default:
      return true;
  }
};

const buildDefaultsBlock = doc => {
  const takenIds = new Set((doc.defaultsBlocks ?? []).map(b => b.id));
  const id = uniquify('default', takenIds);
  return { id, name: id, mode: 'http' };
};

const buildProvider = (doc, providerOpt) => {
  const takenIds = new Set((doc.tls?.providers ?? []).map(p => p.id));
  const id = uniquify(slugId(`tls-${providerOpt.value}`), takenIds);
  return {
    id,
    type: providerOpt.providerType,
    credentialsRef: null,
    options: {},
  };
};

const buildBackend = (doc, draft) => {
  const takenIds = new Set((doc.backends ?? []).map(b => b.id));
  const id = uniquify(slugId(draft.backendName), takenIds);
  return {
    id,
    name: draft.backendName,
    mode: 'http',
    balance: 'random',
    servers: [
      {
        name: 'srv1',
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
};

const buildAcmeAccount = (doc, draft) => {
  const takenIds = new Set((doc.acmeAccounts ?? []).map(a => a.id));
  const id = uniquify('default', takenIds);
  return {
    id,
    email: draft.email,
    server: 'letsencrypt',
    description: 'Created by onboarding wizard',
  };
};

const buildCert = (doc, draft, providerId, acmeAccountId) => {
  const takenIds = new Set((doc.tls?.certs ?? []).map(c => c.id));
  const id = uniquify(slugId(`cert-${draft.routeHostname}`), takenIds);
  return {
    id,
    certName: draft.routeHostname.replace(/[^a-zA-Z0-9-]/gu, '-').slice(0, 127),
    domains: [draft.routeHostname, ...draft.extraCertDomains],
    providerId,
    acmeAccountId,
    expanding: true,
    keyType: 'ecdsa',
  };
};

const buildAcl = (doc, draft) => {
  const takenIds = new Set((doc.acls ?? []).map(a => a.id));
  const takenNames = new Set((doc.acls ?? []).map(a => a.name));
  const id = uniquify(slugId(`host-${draft.routeHostname}`), takenIds);
  const name = uniquify(slugName(`host_${draft.routeHostname}`), takenNames, { separator: '_' });
  return {
    id,
    name,
    description: `Hostname match for ${draft.routeHostname}`,
    field: 'hdr',
    fieldArg: 'host',
    operator: 'str',
    values: [draft.routeHostname],
    caseInsensitive: true,
    noDnsLookup: false,
  };
};

const buildFrontend = (doc, draft, defaultsId, aclName, backendId) => {
  const takenFeIds = new Set((doc.frontends ?? []).map(f => f.id));
  const frontendId = uniquify(slugId(draft.frontendName), takenFeIds);
  const ruleId = uniquify(
    slugId(`route-${draft.routeHostname}`),
    collectRuleIds(doc, { phase: 'httpRequest' })
  );
  const newRule = {
    id: ruleId,
    name: `route to ${draft.backendName}`,
    enabled: true,
    action: { type: 'use-backend', backendId },
    condition: [{ kind: 'aclRef', aclName, negate: false, combineWithNext: 'and' }],
  };
  return {
    id: frontendId,
    name: draft.frontendName,
    enabled: true,
    mode: 'http',
    binds: [
      {
        id: `b${Math.random().toString(36).slice(2, 9)}`,
        address: draft.frontendBindAddress,
        ssl: {
          enabled: true,
          crtListRef: '/etc/haproxy/certs.list',
          alpn: ['h2', 'http/1.1'],
        },
        quic: {},
      },
    ],
    fromDefaults: defaultsId,
    httpOpts: {},
    tcpOpts: {},
    stats: {},
    rulePhases: { httpRequest: [newRule] },
  };
};

const buildNextDocAndProviderId = (draft, doc) => {
  const providerOpt = PROVIDER_OPTIONS.find(p => p.value === draft.provider);
  const newDefaults = buildDefaultsBlock(doc);
  const newProvider = buildProvider(doc, providerOpt);
  const newAcmeAccount = buildAcmeAccount(doc, draft);
  const newBackend = buildBackend(doc, draft);
  const newCert = buildCert(doc, draft, newProvider.id, newAcmeAccount.id);
  const newAcl = buildAcl(doc, draft);
  const newFrontend = buildFrontend(doc, draft, newDefaults.id, newAcl.name, newBackend.id);

  return {
    nextDoc: {
      ...doc,
      tls: {
        ...doc.tls,
        providers: [...(doc.tls?.providers ?? []), newProvider],
        certs: [...(doc.tls?.certs ?? []), newCert],
      },
      acmeAccounts: [...(doc.acmeAccounts ?? []), newAcmeAccount],
      defaultsBlocks: [...(doc.defaultsBlocks ?? []), newDefaults],
      acls: [...(doc.acls ?? []), newAcl],
      backends: [...(doc.backends ?? []), newBackend],
      frontends: [...(doc.frontends ?? []), newFrontend],
    },
    providerId: newProvider.id,
  };
};

export const OnboardingWizard = ({ show, doc, onComplete, onCancel }) => {
  const { t } = useTranslation(['auth', 'common']);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isFreshInstall = useMemo(
    () =>
      (doc.frontends ?? []).length === 0 &&
      (doc.backends ?? []).length === 0 &&
      (doc.acls ?? []).length === 0 &&
      (doc.tls?.providers ?? []).length === 0 &&
      (doc.tls?.certs ?? []).length === 0,
    [doc]
  );

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      const { nextDoc, providerId } = buildNextDocAndProviderId(draft, doc);
      const persisted1 = await onComplete(nextDoc);

      const token = draft.cloudflareApiToken.trim();
      if (draft.provider === 'cloudflare' && token) {
        const result = await apiPut(
          `api/tls-providers/${encodeURIComponent(providerId)}/credentials`,
          { fields: { dns_cloudflare_api_token: token } }
        );
        if (result?.path) {
          const baseDoc = persisted1 ?? nextDoc;
          const nextProviders = baseDoc.tls.providers.map(p =>
            p.id === providerId ? { ...p, credentialsRef: result.path } : p
          );
          await onComplete({ ...baseDoc, tls: { ...baseDoc.tls, providers: nextProviders } });
        }
      }

      onCancel();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const canAdvance = validateStep(step, draft);
  const stepLabels = STEP_LABEL_KEYS.map(entry => t(entry.key, entry.fallback));

  return (
    <WizardShell
      show={show}
      title={
        isFreshInstall
          ? t('auth:onboardingWizard.titleFresh', 'Welcome to patchpanel')
          : t('auth:onboardingWizard.title', 'Onboarding wizard')
      }
      stepLabels={stepLabels}
      currentStep={step}
      canAdvance={canAdvance}
      saving={saving}
      error={error}
      finishLabel={t('auth:onboardingWizard.applySetup', 'Apply setup')}
      onPrev={step > 0 ? () => setStep(s => s - 1) : null}
      onNext={step < STEP_LABEL_KEYS.length - 1 ? () => setStep(s => s + 1) : null}
      onFinish={handleFinish}
      onCancel={onCancel}
    >
      {step === 0 ? <WelcomeStep /> : null}
      {step === 1 ? <IdentityStep draft={draft} update={update} /> : null}
      {step === 2 ? <BackendStep draft={draft} update={update} /> : null}
      {step === 3 ? <FrontendStep draft={draft} update={update} /> : null}
      {step === 4 ? <RouteStep draft={draft} update={update} /> : null}
      {step === 5 ? <ReviewStep draft={draft} /> : null}
    </WizardShell>
  );
};

OnboardingWizard.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: stateDocShape.isRequired,
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
