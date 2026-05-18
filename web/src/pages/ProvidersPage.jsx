import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  OverlayTrigger,
  Popover,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { apiDelete, apiGet, apiPost } from '../api/client.js';
import { AutheliaSetupWizard } from '../components/AutheliaSetupWizard.jsx';
import { AuthProviderEditModal } from '../components/AuthProviderEditModal.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { TlsProviderEditModal } from '../components/TlsProviderEditModal.jsx';
import { AUTH_PROVIDER_REGISTRY } from '../lib/auth-provider-kinds.jsx';
import { TLS_PROVIDER_REGISTRY } from '../lib/tls-provider-kinds.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const summariseAuthProvider = provider => {
  const kind = AUTH_PROVIDER_REGISTRY.get(provider.type);
  if (!kind?.summary) {
    return null;
  }
  try {
    return kind.summary(provider);
  } catch {
    return null;
  }
};

const summariseTlsProvider = provider => {
  const kind = TLS_PROVIDER_REGISTRY.get(provider.type);
  if (!kind?.summary) {
    return null;
  }
  try {
    return kind.summary(provider);
  } catch {
    return null;
  }
};

const useFocusFromQuery = () => {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusedRowRef = useRef(null);
  useEffect(() => {
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId]);
  return { focusId, focusedRowRef };
};

const UsageBadge = ({ count, refs, kind, variant = 'secondary' }) => {
  const { t } = useTranslation(['cert']);
  if (count === 0) {
    return (
      <Badge bg="secondary" className="bg-opacity-25 text-body-secondary border">
        {t('cert:providersPage.usage.unused', 'unused')}
      </Badge>
    );
  }
  const popover = (
    <Popover>
      <Popover.Header as="h6">
        {t('cert:providersPage.usage.popoverHeader', 'Used by {{count}} {{kind}}', {
          count,
          kind,
        })}
      </Popover.Header>
      <Popover.Body className="small">
        {refs.length === 0 ? (
          <em>{t('cert:providersPage.usage.noDetails', '(no details)')}</em>
        ) : (
          <ul className="mb-0 ps-3">
            {refs.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </Popover.Body>
    </Popover>
  );
  return (
    <OverlayTrigger placement="left" overlay={popover} trigger={['hover', 'focus']}>
      <Badge bg={variant} style={{ cursor: 'help' }}>
        {t('cert:providersPage.usage.badge', '{{count}} {{kind}}', { count, kind })}
      </Badge>
    </OverlayTrigger>
  );
};

UsageBadge.propTypes = {
  count: PropTypes.number.isRequired,
  refs: PropTypes.arrayOf(PropTypes.string).isRequired,
  kind: PropTypes.string.isRequired,
  variant: PropTypes.string,
};

const TestButton = ({ path, onResult }) => {
  const { t } = useTranslation(['common']);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const result = await apiPost(path);
      onResult({ ok: result.ok !== false, payload: result });
    } catch (err) {
      onResult({ ok: false, payload: { error: err.message } });
    } finally {
      setRunning(false);
    }
  };
  return (
    <Button variant="outline-info" size="sm" className="me-1" onClick={run} disabled={running}>
      {running ? (
        <Spinner as="span" animation="border" size="sm" />
      ) : (
        t('common:buttons.test', 'Test')
      )}
    </Button>
  );
};

TestButton.propTypes = {
  path: PropTypes.string.isRequired,
  onResult: PropTypes.func.isRequired,
};

const TestResultAlert = ({ result, onDismiss }) => {
  const { t } = useTranslation(['cert']);
  if (!result) {
    return null;
  }
  const { ok, payload, id, kind } = result;
  return (
    <Alert variant={ok ? 'success' : 'danger'} dismissible onClose={onDismiss}>
      <strong>
        {t('cert:providersPage.testResult.summary', '{{kind}} test for {{id}}: {{status}}', {
          kind,
          id,
          status: ok
            ? t('cert:providersPage.testResult.ok', 'OK')
            : t('cert:providersPage.testResult.failed', 'FAILED'),
        })}
      </strong>
      <details className="mt-2">
        <summary className="small">
          {t('cert:providersPage.testResult.showRaw', 'Show raw response')}
        </summary>
        <pre
          className="mt-2 mb-0 small"
          style={{ whiteSpace: 'pre-wrap', maxHeight: '20rem', overflow: 'auto' }}
        >
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </Alert>
  );
};

TestResultAlert.propTypes = {
  result: PropTypes.shape({
    ok: PropTypes.bool,
    payload: PropTypes.object,
    id: PropTypes.string,
    kind: PropTypes.string,
  }),
  onDismiss: PropTypes.func.isRequired,
};

const collectAuthProviderRefs = doc => {
  const refsByProviderId = new Map();
  for (const provider of doc.authProviders ?? []) {
    refsByProviderId.set(provider.id, []);
  }
  for (const fe of doc.frontends ?? []) {
    for (const rule of fe.rulePhases?.httpRequest ?? []) {
      if (rule.action?.type === 'apply-auth-provider') {
        const list = refsByProviderId.get(rule.action.providerId);
        if (list) {
          list.push(`${fe.name} · ${rule.name ?? rule.id}`);
        }
      }
    }
  }
  return refsByProviderId;
};

const AuthProvidersCard = ({ doc, onSave }) => {
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showAutheliaWizard, setShowAutheliaWizard] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const { focusId, focusedRowRef } = useFocusFromQuery();

  const refsByProvider = useMemo(() => collectAuthProviderRefs(doc), [doc]);
  const isInUse = id => (refsByProvider.get(id)?.length ?? 0) > 0;

  const persist = async nextProviders => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...doc, authProviders: nextProviders });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const persistDoc = async nextDoc => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nextDoc);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = entity => {
    setShowNew(false);
    persist([...doc.authProviders, entity]);
  };
  const handleUpdate = entity => {
    setEditing(null);
    persist(doc.authProviders.map(e => (e.id === entity.id ? entity : e)));
  };
  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(doc.authProviders.filter(e => e.id !== id));
  };
  const handleAutheliaWizardComplete = async nextDoc => {
    setShowAutheliaWizard(false);
    await persistDoc(nextDoc);
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3">
          <Card.Title className="mb-0">Authentication providers</Card.Title>
          <div className="d-flex gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              onClick={() => setShowAutheliaWizard(true)}
              disabled={saving || !onSave}
              title="Wizard: creates Backend + ACL + use-backend Rule + AuthProvider in one shot."
            >
              <i className="bi bi-stars me-1" />
              Authelia setup wizard
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setShowNew(true)}
              disabled={saving || !onSave}
            >
              Add provider
            </Button>
          </div>
        </div>
        <Card.Text className="text-muted small">
          Apply via an <code>apply-auth-provider</code> rule action (sugar) or compose explicit
          rules referencing the provider&apos;s sidecar backend. The Test button probes the provider
          per-kind. The Authelia wizard creates the Backend + portal ACL + use-backend Rule + the
          AuthProvider entity together — all editable afterwards.
        </Card.Text>
        {saveError ? <p className="text-danger">Save failed: {saveError.message}</p> : null}
        <TestResultAlert result={testResult} onDismiss={() => setTestResult(null)} />
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>ID</th>
              <th>Type</th>
              <th>Summary</th>
              <th>Used by</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {doc.authProviders.map(provider => {
              const refs = refsByProvider.get(provider.id) ?? [];
              const isFocused = focusId === provider.id;
              return (
                <tr
                  key={provider.id}
                  ref={isFocused ? focusedRowRef : null}
                  className={isFocused ? 'table-warning' : undefined}
                >
                  <td>
                    <code>{provider.id}</code>
                  </td>
                  <td>
                    <Badge bg="warning" className="text-dark">
                      {provider.type}
                    </Badge>
                  </td>
                  <td className="small text-muted">{summariseAuthProvider(provider)}</td>
                  <td>
                    <UsageBadge count={refs.length} refs={refs} kind="rule" variant="warning" />
                  </td>
                  <td className="text-end text-nowrap">
                    {provider.type !== 'none' ? (
                      <TestButton
                        path={`api/auth-providers/${encodeURIComponent(provider.id)}/test`}
                        onResult={r =>
                          setTestResult({ ...r, id: provider.id, kind: provider.type })
                        }
                      />
                    ) : null}
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="me-1"
                      onClick={() => setEditing(provider)}
                      disabled={saving || !onSave}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setDeleting(provider)}
                      disabled={saving || !onSave || isInUse(provider.id)}
                      title={isInUse(provider.id) ? 'Referenced by at least one rule.' : ''}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card.Body>
      {showNew ? (
        <AuthProviderEditModal
          show
          doc={doc}
          onSave={handleAdd}
          onCancel={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <AuthProviderEditModal
          show
          doc={doc}
          provider={editing}
          onSave={handleUpdate}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {showAutheliaWizard ? (
        <AutheliaSetupWizard
          show
          doc={doc}
          onComplete={handleAutheliaWizardComplete}
          onCancel={() => setShowAutheliaWizard(false)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title="Delete auth provider?"
          body={
            <>
              Delete <strong>{deleting.id}</strong> ({deleting.type})?
            </>
          }
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

AuthProvidersCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType,
};

const CREDENTIALS_NA_TYPES = new Set(['http-01', 'byo']);

const StoredBadge = () => {
  const { t } = useTranslation(['cert']);
  return (
    <Badge bg="success">
      <i className="bi bi-lock-fill me-1" />
      {t('cert:tlsProviders.credentials.stored', 'stored')}
    </Badge>
  );
};

const MissingBadge = () => {
  const { t } = useTranslation(['cert']);
  return (
    <Badge bg="warning" text="dark">
      <i className="bi bi-exclamation-circle me-1" />
      {t('cert:tlsProviders.credentials.missing', 'missing')}
    </Badge>
  );
};

const CredentialsStatusBadge = ({ providerId, providerType, version }) => {
  const { t } = useTranslation(['cert']);
  const isNa = CREDENTIALS_NA_TYPES.has(providerType);
  const [state, setState] = useState({ loading: !isNa, exists: false });

  useEffect(() => {
    if (isNa) {
      return undefined;
    }
    let active = true;
    apiGet(`api/tls-providers/${encodeURIComponent(providerId)}/credentials`)
      .then(payload => {
        if (active) {
          setState({ loading: false, exists: payload.exists === true });
        }
      })
      .catch(() => {
        if (active) {
          setState({ loading: false, exists: false });
        }
      });
    return () => {
      active = false;
    };
  }, [providerId, isNa, version]);

  if (isNa) {
    return (
      <Badge bg="secondary" className="bg-opacity-25 text-body-secondary border">
        {t('cert:tlsProviders.credentials.na', 'n/a')}
      </Badge>
    );
  }
  if (state.loading) {
    return <Spinner as="span" animation="border" size="sm" />;
  }
  return state.exists ? <StoredBadge /> : <MissingBadge />;
};

CredentialsStatusBadge.propTypes = {
  providerId: PropTypes.string.isRequired,
  providerType: PropTypes.string.isRequired,
  version: PropTypes.number.isRequired,
};

const TlsProvidersCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [credBumper, setCredBumper] = useState(0);
  const { focusId, focusedRowRef } = useFocusFromQuery();

  const refsByProvider = useMemo(() => {
    const map = new Map();
    for (const p of doc.tls.providers) {
      map.set(
        p.id,
        doc.tls.certs.filter(c => c.providerId === p.id).map(c => c.certName)
      );
    }
    return map;
  }, [doc.tls.providers, doc.tls.certs]);

  const isInUse = id => doc.tls.certs.some(c => c.providerId === id);

  const saveDocAndBump = async nextDoc => {
    setSaveError(null);
    try {
      const persisted = await onSave(nextDoc);
      setCredBumper(v => v + 1);
      return persisted;
    } catch (err) {
      setSaveError(err);
      throw err;
    }
  };

  const handleDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) {
      return;
    }
    setSaveError(null);
    try {
      // Credentials DELETE is best-effort — file may not exist or the
      // provider type doesn't use one. Either is non-fatal.
      try {
        await apiDelete(`api/tls-providers/${encodeURIComponent(target.id)}/credentials`);
      } catch {
        // ignore
      }
      await onSave({
        ...doc,
        tls: { ...doc.tls, providers: doc.tls.providers.filter(p => p.id !== target.id) },
      });
      setCredBumper(v => v + 1);
    } catch (err) {
      setSaveError(err);
    }
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3">
          <Card.Title className="mb-0">
            {t('cert:tlsProviders.title', 'TLS / ACME providers')}
          </Card.Title>
          <Button variant="primary" size="sm" onClick={() => setShowNew(true)} disabled={!onSave}>
            {t('cert:tlsProviders.add', 'Add provider')}
          </Button>
        </div>
        <Card.Text className="text-muted small">
          {t(
            'cert:tlsProviders.description',
            "Certbot challenge providers (DNS-01 per registrar, HTTP-01, BYO). Certificates pick one of these to satisfy the ACME challenge. Credentials are stored as mode-600 files in patchpanel's credentials directory — the per-provider form below collects them."
          )}
        </Card.Text>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            {t('cert:tlsProviders.saveFailed', 'Save failed: {{message}}', {
              message: saveError.message,
            })}
          </Alert>
        ) : null}
        <TestResultAlert result={testResult} onDismiss={() => setTestResult(null)} />
        <Table striped bordered hover responsive size="sm">
          <thead>
            <tr>
              <th>{t('cert:tlsProviders.columns.id', 'ID')}</th>
              <th>{t('cert:tlsProviders.columns.type', 'Type')}</th>
              <th>{t('cert:tlsProviders.columns.credentials', 'Credentials')}</th>
              <th>{t('cert:tlsProviders.columns.usedBy', 'Used by')}</th>
              <th className="text-end">{t('cert:tlsProviders.columns.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {doc.tls.providers.map(provider => {
              const refs = refsByProvider.get(provider.id) ?? [];
              const isFocused = focusId === provider.id;
              const summary = summariseTlsProvider(provider);
              return (
                <tr
                  key={provider.id}
                  ref={isFocused ? focusedRowRef : null}
                  className={isFocused ? 'table-warning' : undefined}
                >
                  <td>
                    <code>{provider.id}</code>
                  </td>
                  <td>
                    <Badge bg="info">{provider.type}</Badge>
                    {summary ? <div className="small text-muted mt-1">{summary}</div> : null}
                  </td>
                  <td>
                    <CredentialsStatusBadge
                      providerId={provider.id}
                      providerType={provider.type}
                      version={credBumper}
                    />
                  </td>
                  <td>
                    <UsageBadge count={refs.length} refs={refs} kind="cert" variant="info" />
                  </td>
                  <td className="text-end text-nowrap">
                    <TestButton
                      path={`api/tls-providers/${encodeURIComponent(provider.id)}/test`}
                      onResult={r => setTestResult({ ...r, id: provider.id, kind: provider.type })}
                    />
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      className="me-1"
                      onClick={() => setEditing(provider)}
                      disabled={!onSave}
                    >
                      {t('common:buttons.edit', 'Edit')}
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setDeleting(provider)}
                      disabled={!onSave || isInUse(provider.id)}
                      title={
                        isInUse(provider.id)
                          ? t(
                              'cert:tlsProviders.referencedTitle',
                              'Referenced by at least one certificate.'
                            )
                          : ''
                      }
                    >
                      {t('common:buttons.delete', 'Delete')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card.Body>
      {showNew ? (
        <TlsProviderEditModal
          show
          doc={doc}
          onSave={saveDocAndBump}
          onClose={() => setShowNew(false)}
        />
      ) : null}
      {editing ? (
        <TlsProviderEditModal
          show
          doc={doc}
          provider={editing}
          onSave={saveDocAndBump}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          show
          title={t('cert:tlsProviders.confirmDelete.title', 'Delete TLS provider?')}
          body={
            <>
              {t('cert:tlsProviders.confirmDelete.prefix', 'Delete')} <strong>{deleting.id}</strong>{' '}
              ({deleting.type}){' '}
              {t(
                'cert:tlsProviders.confirmDelete.suffix',
                '? The stored credentials file (if any) is also removed from disk.'
              )}
            </>
          }
          confirmLabel={t('common:buttons.delete', 'Delete')}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

TlsProvidersCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType,
};

export const ProvidersPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  return (
    <>
      <AuthProvidersCard doc={doc} onSave={onSave} />
      <TlsProvidersCard doc={doc} onSave={onSave} />
    </>
  );
};

ProvidersPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
