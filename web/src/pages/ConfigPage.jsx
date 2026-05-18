import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';

import { buildUrl } from '../api/client.js';
import { ConfigFieldRenderer } from '../components/ConfigFieldRenderer.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { useConfigDoc } from '../hooks/useConfigDoc.jsx';
import { evaluateConditional, processConfig, t, validateField } from '../lib/config-form.js';

// After the operator clicks "Restart now", the server takes some seconds to
// die and come back up under systemd / the HA addon supervisor. Polling
// /health avoids the prior blind 5 s reload that often hit a still-dead
// server. We give the process up to a minute to come back; after that we
// force a reload anyway so the operator isn't stuck on a permanently-spinning
// page if the restart genuinely failed.
const POLL_INITIAL_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 1000;
const POLL_MAX_WAIT_MS = 60_000;

const pollHealthThenReload = () => {
  const startedAt = Date.now();
  const tick = () => {
    if (Date.now() - startedAt > POLL_MAX_WAIT_MS) {
      window.location.reload();
      return;
    }
    fetch(buildUrl('health'), { credentials: 'same-origin' })
      .then(resp => {
        if (resp.ok) {
          window.location.reload();
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      })
      .catch(() => setTimeout(tick, POLL_INTERVAL_MS));
  };
  setTimeout(tick, POLL_INITIAL_DELAY_MS);
};

// /config — admin-level operator settings, rendered straight from the
// metadata in config.yaml. Layout mirrors GeoIPCard / ProvidersPage: one
// Card per top-level section; subsections render as bordered blocks inside.
// All edits are draft-only until the operator clicks Save; most fields
// require a process restart to take effect, surfaced via the warning
// banner + the Restart button which exits the process so systemd or the
// HA addon supervisor restarts us with the new config loaded.

const FULL_WIDTH_TYPES = new Set(['textarea', 'array']);

const fieldCol = field => (FULL_WIDTH_TYPES.has(field.type) ? 12 : 6);

const FieldsRow = ({ fields, getCurrent, allValues, onChange, errors }) => {
  const visible = fields.filter(f => evaluateConditional(f, allValues));
  if (visible.length === 0) {
    return null;
  }
  return (
    <Row className="g-3">
      {visible.map(field => (
        <Col key={field.path} md={fieldCol(field)}>
          <ConfigFieldRenderer
            field={field}
            currentValue={getCurrent(field.path)}
            onChange={value => onChange(field.path, value)}
            error={errors[field.path]}
          />
        </Col>
      ))}
    </Row>
  );
};

FieldsRow.propTypes = {
  fields: PropTypes.array.isRequired,
  getCurrent: PropTypes.func.isRequired,
  allValues: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object.isRequired,
};

const SubsectionBlock = ({ subsection, getCurrent, allValues, onChange, errors }) => {
  const visible = subsection.fields.filter(f => evaluateConditional(f, allValues));
  if (visible.length === 0) {
    return null;
  }
  return (
    <div className="border rounded p-3 mb-3">
      <h6 className="text-uppercase text-muted small mb-3">
        {t(`config.subsection.${subsection.key}`, subsection.label)}
      </h6>
      <FieldsRow
        fields={subsection.fields}
        getCurrent={getCurrent}
        allValues={allValues}
        onChange={onChange}
        errors={errors}
      />
    </div>
  );
};

SubsectionBlock.propTypes = {
  subsection: PropTypes.object.isRequired,
  getCurrent: PropTypes.func.isRequired,
  allValues: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object.isRequired,
};

const SectionCard = ({ section, getCurrent, allValues, onChange, errors }) => {
  const orderedSubs = Object.values(section.subsections).sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );
  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>
          {section.icon ? <i className={`bi ${section.icon} me-2`} /> : null}
          {t(`config.section.${section.key}`, section.label)}
        </Card.Title>
        {section.description ? (
          <Card.Text className="text-muted small">
            {t(`config.section.${section.key}.description`, section.description)}
          </Card.Text>
        ) : null}
        <FieldsRow
          fields={section.fields}
          getCurrent={getCurrent}
          allValues={allValues}
          onChange={onChange}
          errors={errors}
        />
        {orderedSubs.map(sub => (
          <SubsectionBlock
            key={sub.key}
            subsection={sub}
            getCurrent={getCurrent}
            allValues={allValues}
            onChange={onChange}
            errors={errors}
          />
        ))}
      </Card.Body>
    </Card>
  );
};

SectionCard.propTypes = {
  section: PropTypes.object.isRequired,
  getCurrent: PropTypes.func.isRequired,
  allValues: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object.isRequired,
};

const collectFieldsByPath = organizedSections => {
  const byPath = {};
  for (const section of Object.values(organizedSections)) {
    for (const field of section.fields) {
      byPath[field.path] = field;
    }
    for (const sub of Object.values(section.subsections)) {
      for (const field of sub.fields) {
        byPath[field.path] = field;
      }
    }
  }
  return byPath;
};

const validateAll = (draft, fieldsByPath) => {
  const errors = {};
  for (const [path, value] of Object.entries(draft)) {
    const field = fieldsByPath[path];
    if (!field) {
      continue;
    }
    const err = validateField(field, value);
    if (err) {
      errors[path] = err;
    }
  }
  return errors;
};

const SettingsHeader = ({ hasDraft, saving, restarting, onSave, onAskRestart }) => (
  <Card className="mb-3">
    <Card.Body className="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div>
        <Card.Title className="mb-1">{t('config.page.title', 'Settings')}</Card.Title>
        <Card.Text className="text-muted small mb-0">
          {t(
            'config.page.subtitle',
            'Operator configuration (/etc/patchpanel/config.yaml). Saves persist immediately but most fields require a process restart to take effect.'
          )}
        </Card.Text>
      </div>
      <div className="d-flex gap-2">
        <Button variant="primary" onClick={onSave} disabled={!hasDraft || saving || restarting}>
          {saving ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-1" />
              {t('config.page.saving', 'Saving…')}
            </>
          ) : (
            t('config.page.save', 'Save')
          )}
        </Button>
        <Button variant="warning" onClick={onAskRestart} disabled={restarting}>
          {restarting ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-1" />
              {t('config.page.restarting', 'Restarting…')}
            </>
          ) : (
            <>
              <i className="bi bi-arrow-clockwise me-1" />
              {t('config.page.restart', 'Restart now')}
            </>
          )}
        </Button>
      </div>
    </Card.Body>
  </Card>
);

SettingsHeader.propTypes = {
  hasDraft: PropTypes.bool.isRequired,
  saving: PropTypes.bool.isRequired,
  restarting: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onAskRestart: PropTypes.func.isRequired,
};

export const ConfigPage = () => {
  const { raw, loading, error, saving, save, restart } = useConfigDoc();
  const [draft, setDraft] = useState({});
  const [savedNote, setSavedNote] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [errors, setErrors] = useState({});
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Memoize the schema-walking work so a single keystroke doesn't re-walk the
  // entire config tree. processConfig handles a null/empty raw safely; the
  // early-return guards below cover the loading / error UI before any of
  // these memoized values are inspected.
  const { extractedValues, organizedSections } = useMemo(
    () => (raw ? processConfig(raw) : { extractedValues: {}, organizedSections: {} }),
    [raw]
  );
  const fieldsByPath = useMemo(() => collectFieldsByPath(organizedSections), [organizedSections]);
  const allCurrentValues = useMemo(
    () => ({ ...extractedValues, ...draft }),
    [extractedValues, draft]
  );
  const sortedSections = useMemo(
    () => Object.values(organizedSections).sort((a, b) => (a.order || 999) - (b.order || 999)),
    [organizedSections]
  );
  const getCurrent = useCallback(
    path => (Object.hasOwn(draft, path) ? draft[path] : extractedValues[path]),
    [draft, extractedValues]
  );

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-4">
        <Spinner animation="border" role="status" />
      </div>
    );
  }
  if (error) {
    return (
      <Alert variant="danger">
        {error.payload?.error ??
          error.message ??
          t('config.page.loadFailed', 'failed to load config')}
      </Alert>
    );
  }
  if (!raw) {
    return null;
  }

  const handleChange = (path, value) => {
    setSavedNote(false);
    setSaveError(null);
    setDraft(prev => ({ ...prev, [path]: value }));
    setErrors(prev => {
      if (!prev[path]) {
        return prev;
      }
      const next = { ...prev };
      delete next[path];
      return next;
    });
  };

  const handleSave = async () => {
    const validationErrors = validateAll(draft, fieldsByPath);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setSaveError(null);
    try {
      await save(draft);
      setDraft({});
      setSavedNote(true);
    } catch (err) {
      setSaveError(err.payload?.error ?? err.message ?? 'save failed');
    }
  };

  const handleRestart = async () => {
    setRestartConfirm(false);
    setRestarting(true);
    try {
      await restart();
    } catch {
      // Restart endpoint kills the process partway through — request errors
      // are expected and we treat them as success.
    }
    // Poll /health until the server is back, then reload — beats a blind
    // setTimeout that might hit a still-dead server.
    pollHealthThenReload();
  };

  const hasDraft = Object.keys(draft).length > 0;

  return (
    <div>
      <SettingsHeader
        hasDraft={hasDraft}
        saving={saving}
        restarting={restarting}
        onSave={handleSave}
        onAskRestart={() => setRestartConfirm(true)}
      />

      {savedNote ? (
        <Alert variant="info" onClose={() => setSavedNote(false)} dismissible>
          {t(
            'config.page.saved',
            'Saved to disk. Click Restart now to apply, or restart manually later.'
          )}
        </Alert>
      ) : null}
      {saveError ? (
        <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
          {saveError}
        </Alert>
      ) : null}

      <Form onSubmit={e => e.preventDefault()}>
        {sortedSections.map(section => (
          <SectionCard
            key={section.key}
            section={section}
            getCurrent={getCurrent}
            allValues={allCurrentValues}
            onChange={handleChange}
            errors={errors}
          />
        ))}
      </Form>

      {restartConfirm ? (
        <ConfirmDialog
          show
          title={t('config.restart.title', 'Restart patchpanel?')}
          body={
            <>
              <p>
                {t(
                  'config.restart.body',
                  'This exits the process. systemd (or the HA addon supervisor) restarts it within seconds.'
                )}
              </p>
              <p className="mb-0 small text-muted">
                {t('config.restart.note', 'The browser tab will auto-reload after a few seconds.')}
              </p>
            </>
          }
          confirmLabel={t('config.restart.confirm', 'Restart')}
          confirmVariant="warning"
          onConfirm={handleRestart}
          onCancel={() => setRestartConfirm(false)}
        />
      ) : null}
    </div>
  );
};
