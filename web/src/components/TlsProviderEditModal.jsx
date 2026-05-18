import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiGet, apiPut } from '../api/client.js';
import { TLS_PROVIDER_REGISTRY } from '../lib/tls-provider-kinds.jsx';

import { stripEmptyFields, TlsCredentialsForm } from './TlsCredentialsForm.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;

const emptyProvider = () => {
  const firstKind = TLS_PROVIDER_REGISTRY.get(TLS_PROVIDER_REGISTRY.firstKindValue);
  return {
    id: '',
    type: firstKind.value,
    credentialsRef: null,
    options: firstKind.emptyOptions(),
  };
};

const upsertProvider = (providers, provider) => {
  const idx = providers.findIndex(p => p.id === provider.id);
  if (idx >= 0) {
    return providers.map(p => (p.id === provider.id ? provider : p));
  }
  return [...providers, provider];
};

const seedDefaultsFromTemplate = template => {
  const out = {};
  for (const field of template?.fields ?? []) {
    if (field.default !== undefined) {
      out[field.key] = field.default;
    }
  }
  return out;
};

const useCredentialsTemplate = (type, isExisting, setCredentialsValues) => {
  const [template, setTemplate] = useState(null);
  const [templateError, setTemplateError] = useState(null);

  useEffect(() => {
    let active = true;
    apiGet(`api/tls-providers/credential-template/${encodeURIComponent(type)}`)
      .then(payload => {
        if (!active) {
          return;
        }
        setTemplate(payload);
        setTemplateError(null);
        if (isExisting) {
          return;
        }
        const defaults = seedDefaultsFromTemplate(payload);
        if (Object.keys(defaults).length === 0) {
          return;
        }
        setCredentialsValues(prev => ({ ...defaults, ...prev }));
      })
      .catch(err => {
        if (active) {
          setTemplateError(err);
        }
      });
    return () => {
      active = false;
    };
  }, [type, isExisting, setCredentialsValues]);

  return { template, templateError };
};

const useStoredCredentials = (providerId, isExisting, show) => {
  const [values, setValues] = useState({});
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(isExisting);

  useEffect(() => {
    if (!isExisting || !show) {
      return undefined;
    }
    let active = true;
    apiGet(`api/tls-providers/${encodeURIComponent(providerId)}/credentials`)
      .then(payload => {
        if (!active) {
          return;
        }
        setValues(payload.fields ?? {});
        setExists(payload.exists === true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isExisting, show, providerId]);

  return { values, setValues, exists, loading };
};

const validateDraft = (draft, currentKind, t) => {
  if (!ID_REGEX.test(draft.id)) {
    return t(
      'cert:tlsProviderEdit.validate.idFormat',
      'id must match a-z, 0-9, _, - (starting with a letter)'
    );
  }
  if (!currentKind) {
    return t('cert:tlsProviderEdit.validate.unknownType', 'unknown TLS provider type: {{type}}', {
      type: draft.type,
    });
  }
  return currentKind.validate(draft);
};

const persistProviderAndCredentials = async ({
  draft,
  doc,
  onSave,
  filledCredentials,
  hasCredentialFields,
}) => {
  const nextProviders1 = upsertProvider(doc.tls.providers, draft);
  const nextDoc1 = { ...doc, tls: { ...doc.tls, providers: nextProviders1 } };
  const persisted1 = await onSave(nextDoc1);

  const hasInput = Object.keys(filledCredentials).length > 0;
  if (!hasCredentialFields || !hasInput) {
    return;
  }

  const result = await apiPut(`api/tls-providers/${encodeURIComponent(draft.id)}/credentials`, {
    fields: filledCredentials,
  });
  if (!result?.path || result.path === draft.credentialsRef) {
    return;
  }

  const baseDoc = persisted1 ?? nextDoc1;
  const providerWithPath = { ...draft, credentialsRef: result.path };
  const nextProviders2 = upsertProvider(baseDoc.tls.providers, providerWithPath);
  await onSave({
    ...baseDoc,
    tls: { ...baseDoc.tls, providers: nextProviders2 },
  });
};

const CredentialsHeaderBadge = ({ loading, isExisting, exists }) => {
  const { t } = useTranslation(['cert']);
  if (loading || !isExisting) {
    return null;
  }
  if (exists) {
    return <Badge bg="success">{t('cert:tlsProviderEdit.badge.stored', 'stored')}</Badge>;
  }
  return (
    <Badge bg="warning" text="dark">
      {t('cert:tlsProviderEdit.badge.notWritten', 'not yet written')}
    </Badge>
  );
};

CredentialsHeaderBadge.propTypes = {
  loading: PropTypes.bool.isRequired,
  isExisting: PropTypes.bool.isRequired,
  exists: PropTypes.bool.isRequired,
};

const SaveButtonContent = ({ saving, isExisting }) => {
  const { t } = useTranslation(['common']);
  if (saving) {
    return (
      <>
        <Spinner as="span" animation="border" size="sm" /> {t('common:status.saving', 'Saving…')}
      </>
    );
  }
  if (isExisting) {
    return t('common:buttons.update', 'Update');
  }
  return t('common:buttons.add', 'Add');
};

SaveButtonContent.propTypes = {
  saving: PropTypes.bool.isRequired,
  isExisting: PropTypes.bool.isRequired,
};

const IdField = ({ value, isExisting, onChange }) => {
  const { t } = useTranslation(['cert']);
  return (
    <Col md={6}>
      <Form.Group>
        <Form.Label>{t('cert:tlsProviderEdit.idLabel', 'ID')}</Form.Label>
        <Form.Control
          type="text"
          value={value}
          disabled={isExisting}
          onChange={e => onChange(e.target.value)}
          placeholder={t('cert:tlsProviderEdit.idPlaceholder', 'e.g. cloudflare')}
        />
        {!isExisting ? (
          <Form.Text className="text-muted">
            {t(
              'cert:tlsProviderEdit.idHelp',
              'Lowercase a-z, digits, _ or -. Used as the on-disk credentials filename.'
            )}
          </Form.Text>
        ) : null}
      </Form.Group>
    </Col>
  );
};

IdField.propTypes = {
  value: PropTypes.string.isRequired,
  isExisting: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

const TypeField = ({ value, isExisting, onChange }) => {
  const { t } = useTranslation(['cert']);
  return (
    <Col md={6}>
      <Form.Group>
        <Form.Label>{t('cert:tlsProviderEdit.typeLabel', 'Type')}</Form.Label>
        <Form.Select value={value} disabled={isExisting} onChange={e => onChange(e.target.value)}>
          {TLS_PROVIDER_REGISTRY.typeOptions
            .filter(opt => opt.value !== 'byo')
            .map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
        </Form.Select>
        {isExisting ? (
          <Form.Text className="text-muted">
            {t(
              'cert:tlsProviderEdit.typeHelp',
              'Type cannot change after creation. Delete and recreate to switch.'
            )}
          </Form.Text>
        ) : null}
      </Form.Group>
    </Col>
  );
};

TypeField.propTypes = {
  value: PropTypes.string.isRequired,
  isExisting: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
};

const NoCredentialsHint = () => {
  const { t } = useTranslation(['cert']);
  return (
    <Col xs={12}>
      <Form.Text className="text-muted">
        <i className="bi bi-info-circle me-1" />
        {t(
          'cert:tlsProviderEdit.noCredentials',
          'This provider type does not use a credentials file.'
        )}
      </Form.Text>
    </Col>
  );
};

const CredentialsSection = ({ template, values, setValues, loading, exists, isExisting }) => {
  const { t } = useTranslation(['cert']);
  const hasFields = (template?.fields ?? []).length > 0;
  if (!hasFields && !loading) {
    if (!template) {
      return null;
    }
    return <NoCredentialsHint />;
  }
  return (
    <Col xs={12}>
      <hr className="my-1" />
      <div className="d-flex align-items-center justify-content-between mb-2">
        <strong className="small text-muted text-uppercase">
          {t('cert:tlsProviderEdit.credentialsHeading', 'Credentials')}
        </strong>
        <CredentialsHeaderBadge loading={loading} isExisting={isExisting} exists={exists} />
      </div>
      <Row className="g-3">
        <TlsCredentialsForm
          template={template}
          values={values}
          onChange={setValues}
          loading={loading}
          exists={exists}
        />
      </Row>
    </Col>
  );
};

CredentialsSection.propTypes = {
  template: PropTypes.object,
  values: PropTypes.object.isRequired,
  setValues: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  exists: PropTypes.bool.isRequired,
  isExisting: PropTypes.bool.isRequired,
};

export const TlsProviderEditModal = ({ show, provider = null, doc, onSave, onClose }) => {
  const { t } = useTranslation(['cert', 'common']);
  const isExisting = Boolean(provider?.id);
  const [draft, setDraft] = useState(() => provider ?? emptyProvider());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const stored = useStoredCredentials(provider?.id, isExisting, show);
  const { template, templateError } = useCredentialsTemplate(
    draft.type,
    isExisting,
    stored.setValues
  );

  const update = patch => setDraft(prev => ({ ...prev, ...patch }));
  const updateOptions = next => setDraft(prev => ({ ...prev, options: next }));

  const onTypeChange = nextType => {
    const nextKind = TLS_PROVIDER_REGISTRY.get(nextType);
    if (!nextKind) {
      return;
    }
    setDraft(prev => ({ ...prev, type: nextType, options: nextKind.emptyOptions() }));
    stored.setValues({});
  };

  const currentKind = TLS_PROVIDER_REGISTRY.get(draft.type);
  const OptionsForm = currentKind?.OptionsForm ?? null;
  const templateFields = template?.fields ?? [];
  const hasCredentialFields = templateFields.length > 0;
  const filledCredentials = useMemo(() => stripEmptyFields(stored.values), [stored.values]);

  const handleSave = async () => {
    const validationError = validateDraft(draft, currentKind, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persistProviderAndCredentials({
        draft,
        doc,
        onSave,
        filledCredentials,
        hasCredentialFields,
      });
      onClose();
    } catch (err) {
      setError(err.message ?? t('cert:tlsProviderEdit.saveFailed', 'save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          {isExisting
            ? t('cert:tlsProviderEdit.editTitle', 'Edit TLS provider: {{id}}', {
                id: provider.id,
              })
            : t('cert:tlsProviderEdit.newTitle', 'New TLS provider')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        {templateError ? (
          <Alert variant="warning" className="small">
            {t(
              'cert:tlsProviderEdit.templateUnavailable',
              'Credentials template unavailable: {{message}}. You can still save the provider; add credentials later via Edit.',
              { message: templateError.message }
            )}
          </Alert>
        ) : null}
        <Row className="g-3">
          <IdField
            value={draft.id}
            isExisting={isExisting}
            onChange={next => update({ id: next })}
          />
          <TypeField value={draft.type} isExisting={isExisting} onChange={onTypeChange} />
          {OptionsForm ? (
            <OptionsForm options={draft.options ?? {}} onChange={updateOptions} />
          ) : null}
          <CredentialsSection
            template={template}
            values={stored.values}
            setValues={stored.setValues}
            loading={stored.loading}
            exists={stored.exists}
            isExisting={isExisting}
          />
        </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {t('common:buttons.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          <SaveButtonContent saving={saving} isExisting={isExisting} />
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

TlsProviderEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  provider: PropTypes.shape({ id: PropTypes.string, type: PropTypes.string }),
  doc: PropTypes.object.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
