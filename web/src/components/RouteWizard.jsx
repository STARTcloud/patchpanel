import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Col, Form, Row } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { collectRuleIds, slugifyId, slugifyName, uniquify } from '../utils/entity-naming.js';
import { ACL_NAME_REGEX, HOSTNAME_REGEX, ID_REGEX } from '../utils/regexes.js';

import { ListEditor } from './ListEditor.jsx';
import { WizardShell } from './WizardShell.jsx';

const STEP_KEYS = Object.freeze([
  { key: 'haproxy:routeWizard.steps.pickFrontend', fallback: 'Pick frontend' },
  { key: 'haproxy:routeWizard.steps.hostsBackend', fallback: 'Hostnames & backend' },
  { key: 'haproxy:routeWizard.steps.names', fallback: 'Names' },
  { key: 'haproxy:routeWizard.steps.review', fallback: 'Review' },
]);

const PickFrontendStep = ({ draft, update, doc }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const httpFrontends = (doc.frontends ?? []).filter(f => f.mode === 'http');
  return (
    <Row className="g-3">
      <Col xs={12}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.frontend', 'Frontend')}</Form.Label>
          <Form.Select
            value={draft.frontendId}
            onChange={e => update({ frontendId: e.target.value })}
          >
            <option value="">— {t('haproxy:routeWizard.choose', 'choose')} —</option>
            {httpFrontends.map(f => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.binds?.[0]?.address ?? '?'})
              </option>
            ))}
          </Form.Select>
          {httpFrontends.length === 0 ? (
            <Form.Text className="text-warning">
              {t(
                'haproxy:routeWizard.noHttpFrontends',
                'No HTTP frontends defined. Create one on the Frontends page first.'
              )}
            </Form.Text>
          ) : null}
        </Form.Group>
      </Col>
    </Row>
  );
};

PickFrontendStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: PropTypes.object.isRequired,
};

const HostsAndBackendStep = ({ draft, update, doc }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <Row className="g-3">
      <Col xs={12}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.hostnames', 'Hostnames')}</Form.Label>
          <ListEditor
            items={draft.hostnames}
            onChange={list => update({ hostnames: list })}
            placeholder={t('haproxy:routeWizard.hostnamePlaceholder', 'e.g. home.example.com')}
            validate={value =>
              HOSTNAME_REGEX.test(value)
                ? true
                : t('haproxy:routeWizard.invalidHostname', 'invalid hostname')
            }
          />
          <Form.Text className="text-muted">
            {t(
              'haproxy:routeWizard.hostnamesHelp',
              'One or more hostnames matched by hdr(host) -i. Wildcards allowed (-i default).'
            )}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.backend', 'Backend')}</Form.Label>
          <Form.Select
            value={draft.backendId}
            onChange={e => update({ backendId: e.target.value })}
          >
            <option value="">— {t('haproxy:routeWizard.choose', 'choose')} —</option>
            {(doc.backends ?? []).map(b => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.id})
              </option>
            ))}
          </Form.Select>
          {(doc.backends ?? []).length === 0 ? (
            <Form.Text className="text-warning">
              {t(
                'haproxy:routeWizard.noBackends',
                'No backends defined. Create one on the Backends page first.'
              )}
            </Form.Text>
          ) : null}
        </Form.Group>
      </Col>
    </Row>
  );
};

HostsAndBackendStep.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  doc: PropTypes.object.isRequired,
};

const NamesStep = ({ draft, update }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <Row className="g-3">
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.aclId', 'ACL id')}</Form.Label>
          <Form.Control value={draft.aclId} onChange={e => update({ aclId: e.target.value })} />
          <Form.Text className="text-muted">
            {t('haproxy:routeWizard.aclIdHelp', 'Internal id for the host-matching ACL entity.')}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>
            {t('haproxy:routeWizard.aclName', 'ACL name (HAProxy identifier)')}
          </Form.Label>
          <Form.Control value={draft.aclName} onChange={e => update({ aclName: e.target.value })} />
          <Form.Text className="text-muted">
            {t('haproxy:routeWizard.aclNameHelp', 'Rendered as acl NAME hdr(host) -i ….')}
          </Form.Text>
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.ruleId', 'Rule id')}</Form.Label>
          <Form.Control value={draft.ruleId} onChange={e => update({ ruleId: e.target.value })} />
        </Form.Group>
      </Col>
      <Col md={6}>
        <Form.Group>
          <Form.Label>{t('haproxy:routeWizard.ruleLabel', 'Rule label (display)')}</Form.Label>
          <Form.Control
            value={draft.ruleLabel}
            onChange={e => update({ ruleLabel: e.target.value })}
            placeholder={t('haproxy:routeWizard.optional', 'optional')}
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

const ReviewStep = ({ draft, doc }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const frontend = (doc.frontends ?? []).find(f => f.id === draft.frontendId);
  const backend = (doc.backends ?? []).find(b => b.id === draft.backendId);
  return (
    <div className="small">
      <h6 className="mb-3">{t('haproxy:routeWizard.willCreate', 'Will create:')}</h6>
      <dl className="row mb-2">
        <dt className="col-sm-4">{t('haproxy:routeWizard.frontend', 'Frontend')}</dt>
        <dd className="col-sm-8">
          <code>{frontend?.name}</code>
        </dd>
        <dt className="col-sm-4">{t('haproxy:routeWizard.backend', 'Backend')}</dt>
        <dd className="col-sm-8">
          <code>{backend?.name}</code>
        </dd>
        <dt className="col-sm-4">{t('haproxy:routeWizard.hostnames', 'Hostnames')}</dt>
        <dd className="col-sm-8">
          {draft.hostnames.map(h => (
            <Badge bg="info" key={h} className="me-1">
              {h}
            </Badge>
          ))}
        </dd>
      </dl>
      <h6 className="mb-1 mt-3 text-muted text-uppercase small">
        {t('haproxy:routeWizard.diffHeader', 'Resulting state diff')}
      </h6>
      <pre className="border rounded p-2 bg-body-tertiary mb-2 small">
        {`+ state.acls += {
+   id: "${draft.aclId}",
+   name: "${draft.aclName}",
+   field: "hdr",
+   fieldArg: "host",
+   operator: "str",
+   values: ${JSON.stringify(draft.hostnames)},
+   caseInsensitive: true,
+ }
+
+ state.frontends["${frontend?.id ?? '?'}"].rulePhases.httpRequest += {
+   id: "${draft.ruleId}",
+   name: ${JSON.stringify(draft.ruleLabel || draft.ruleId)},
+   enabled: true,
+   action: { type: "use-backend", backendId: "${draft.backendId}" },
+   condition: [{ kind: "aclRef", aclName: "${draft.aclName}" }],
+ }`}
      </pre>
      <Alert variant="info" className="small mb-0">
        {t(
          'haproxy:routeWizard.diffNote',
          'Saving applies through the normal state → render → reload pipeline. The ACL and Rule are afterward fully editable from the ACLs and Rules pages.'
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
      return Boolean(draft.frontendId);
    case 1:
      return (
        draft.hostnames.length > 0 &&
        draft.hostnames.every(h => HOSTNAME_REGEX.test(h)) &&
        Boolean(draft.backendId) &&
        (doc.backends ?? []).some(b => b.id === draft.backendId)
      );
    case 2:
      return (
        ID_REGEX.test(draft.aclId) &&
        ACL_NAME_REGEX.test(draft.aclName) &&
        ID_REGEX.test(draft.ruleId)
      );
    default:
      return true;
  }
};

const buildDraftFromHostnames = (hostnames, doc) => {
  const baseHost = hostnames[0] ?? 'new';
  const slugName = slugifyName(`host_${baseHost}`);
  const slugId = slugifyId(`host-${baseHost}`);
  const takenAclIds = new Set((doc.acls ?? []).map(a => a.id));
  const takenAclNames = new Set((doc.acls ?? []).map(a => a.name));
  const aclId = uniquify(slugId, takenAclIds);
  const aclName = uniquify(slugName, takenAclNames, { separator: '_' });
  const ruleIdSlug = slugifyId(`route-${baseHost}`);
  const ruleId = uniquify(ruleIdSlug, collectRuleIds(doc, { phase: 'httpRequest' }));
  return { aclId, aclName, ruleId };
};

export const RouteWizard = ({ show, doc, onComplete, onCancel }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const initialFrontendId = useMemo(() => {
    const httpFrontends = (doc.frontends ?? []).filter(f => f.mode === 'http');
    return httpFrontends.length === 1 ? httpFrontends[0].id : '';
  }, [doc.frontends]);
  const [draft, setDraft] = useState({
    frontendId: initialFrontendId,
    hostnames: [],
    backendId: '',
    aclId: '',
    aclName: '',
    ruleId: '',
    ruleLabel: '',
  });

  const update = patch => {
    setError(null);
    setDraft(prev => {
      const next = { ...prev, ...patch };
      // When hostnames change and no name is set yet, auto-derive defaults.
      if (
        patch.hostnames &&
        patch.hostnames.length > 0 &&
        (!prev.aclId || !prev.aclName || !prev.ruleId)
      ) {
        const derived = buildDraftFromHostnames(patch.hostnames, doc);
        return { ...next, ...derived };
      }
      return next;
    });
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      const newAcl = {
        id: draft.aclId,
        name: draft.aclName,
        description: t('haproxy:routeWizard.aclDescription', 'Hostname match for {{hostnames}}', {
          hostnames: draft.hostnames.join(', '),
        }),
        field: 'hdr',
        fieldArg: 'host',
        operator: 'str',
        values: draft.hostnames,
        caseInsensitive: true,
        noDnsLookup: false,
      };
      const newRule = {
        id: draft.ruleId,
        name: draft.ruleLabel || undefined,
        enabled: true,
        action: { type: 'use-backend', backendId: draft.backendId },
        condition: [
          {
            kind: 'aclRef',
            aclName: draft.aclName,
            negate: false,
            combineWithNext: 'and',
          },
        ],
      };
      const nextFrontends = (doc.frontends ?? []).map(fe => {
        if (fe.id !== draft.frontendId) {
          return fe;
        }
        const phases = fe.rulePhases ?? {};
        const httpRequest = [...(phases.httpRequest ?? []), newRule];
        return { ...fe, rulePhases: { ...phases, httpRequest } };
      });
      const nextDoc = {
        ...doc,
        acls: [...(doc.acls ?? []), newAcl],
        frontends: nextFrontends,
      };
      await onComplete(nextDoc);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const canAdvance = validateStep(step, draft, doc);
  const stepLabels = STEP_KEYS.map(s => t(s.key, s.fallback));

  return (
    <WizardShell
      show={show}
      title={t('haproxy:routeWizard.newRoute', 'New route')}
      stepLabels={stepLabels}
      currentStep={step}
      canAdvance={canAdvance}
      saving={saving}
      error={error}
      finishLabel={t('haproxy:routeWizard.createRoute', 'Create route')}
      onPrev={step > 0 ? () => setStep(s => s - 1) : null}
      onNext={step < STEP_KEYS.length - 1 ? () => setStep(s => s + 1) : null}
      onFinish={handleFinish}
      onCancel={onCancel}
    >
      {step === 0 ? <PickFrontendStep draft={draft} update={update} doc={doc} /> : null}
      {step === 1 ? <HostsAndBackendStep draft={draft} update={update} doc={doc} /> : null}
      {step === 2 ? <NamesStep draft={draft} update={update} /> : null}
      {step === 3 ? <ReviewStep draft={draft} doc={doc} /> : null}
    </WizardShell>
  );
};

RouteWizard.propTypes = {
  show: PropTypes.bool.isRequired,
  doc: PropTypes.object.isRequired,
  onComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

// Lens-view helper exported so RoutesPage can detect route-like pairs.
// A "route" in the lens is one rule whose action is `use-backend` and
// whose condition references at least one ACL with field=hdr fieldArg=host.
export const deriveRouteRows = doc => {
  const aclByName = new Map((doc.acls ?? []).map(a => [a.name, a]));
  const rows = [];
  for (const fe of doc.frontends ?? []) {
    const rules = fe.rulePhases?.httpRequest ?? [];
    rules.forEach((rule, idx) => {
      if (rule.action?.type !== 'use-backend') {
        return;
      }
      const hostAclRefs = (rule.condition ?? []).filter(t => t.kind === 'aclRef');
      const hostnames = [];
      const matchedAclNames = [];
      for (const ref of hostAclRefs) {
        const acl = aclByName.get(ref.aclName);
        if (!acl) {
          continue;
        }
        if (acl.field === 'hdr' && acl.fieldArg === 'host') {
          hostnames.push(...(acl.values ?? []));
          matchedAclNames.push(acl.name);
        }
      }
      if (matchedAclNames.length === 0) {
        return;
      }
      rows.push({
        rowKey: `${fe.id}/${rule.id}`,
        frontendId: fe.id,
        frontendName: fe.name,
        ruleId: rule.id,
        ruleLabel: rule.name ?? rule.id,
        rulePhaseIndex: idx,
        backendId: rule.action.backendId,
        hostnames,
        aclNames: matchedAclNames,
        enabled: rule.enabled !== false,
      });
    });
  }
  return rows;
};
