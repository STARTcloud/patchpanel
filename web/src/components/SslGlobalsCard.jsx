import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Tab, Tabs } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { useConfirmation } from '../hooks/useConfirmation.jsx';
import { useSslCapabilities } from '../hooks/useSslCapabilities.jsx';
import {
  countOverrides,
  effectiveSideValue,
  PROFILE_OPTIONS,
  presetSideFor,
  sideHasOverride,
  SIDE_FIELD_KEYS,
  TLS_VERSIONS,
  VERSION as PROFILE_VERSION,
} from '../lib/ssl-profiles.js';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

import { ListEditor } from './ListEditor.jsx';

const FIELD_LABEL = Object.freeze({
  enabledVersions: 'Enabled TLS versions',
  ciphers: 'Ciphers (TLS ≤ 1.2)',
  ciphersuites: 'Ciphersuites (TLS 1.3)',
  curves: 'Curves / key-exchange groups',
  sigalgs: 'Signature algorithms (server)',
  clientSigalgs: 'Signature algorithms (client cert verification)',
  options: 'Bind / server options',
});

const FIELD_HELP = Object.freeze({
  enabledVersions:
    'Empty = HAProxy / OpenSSL defaults. Non-contiguous selections (e.g. 1.0 + 1.2) render as ssl-min-ver + ssl-max-ver + no-tlsv<n> for the gap.',
  ciphers:
    'TLS ≤ 1.2 cipher list. Order matters when prefer-server-ciphers is on — first match wins.',
  ciphersuites: 'TLS 1.3 ciphersuites. Order matters.',
  curves:
    'ECDHE / FFDHE / hybrid groups offered for key exchange (rendered as ssl-default-*-curves).',
  sigalgs: 'Signature algorithms the server offers / accepts.',
  clientSigalgs: 'Signature algorithms accepted on client certificates (mTLS).',
  options:
    'Free-form bind/server option tokens (e.g. no-tls-tickets, prefer-client-ciphers, strict-sni).',
});

const KNOWN_BIND_OPTIONS = Object.freeze([
  'no-tls-tickets',
  'prefer-client-ciphers',
  'no-renegotiation',
  'strict-sni',
  'no-ca-names',
  'allow-0rtt',
  'crt-ignore-err all',
  'ca-ignore-err all',
]);

const blankSide = () => ({
  enabledVersions: undefined,
  ciphers: undefined,
  ciphersuites: undefined,
  curves: undefined,
  sigalgs: undefined,
  clientSigalgs: undefined,
  options: undefined,
});

const cloneSsl = ssl => {
  const source = ssl ?? {};
  return {
    profile: {
      name: source.profile?.name ?? 'intermediate',
      basedOnVersion: source.profile?.basedOnVersion ?? PROFILE_VERSION,
    },
    bind: { ...blankSide(), ...(source.bind ?? {}) },
    server: { ...blankSide(), ...(source.server ?? {}) },
    tune: { defaultDhParam: 4096, keylog: false, ...(source.tune ?? {}) },
    providers: {
      loaded: [...(source.providers?.loaded ?? [])],
      defaultProperties: source.providers?.defaultProperties ?? null,
    },
    loadExtraFiles: {
      extraFiles: [...(source.loadExtraFiles?.extraFiles ?? [])],
      deleteExtensions: source.loadExtraFiles?.deleteExtensions ?? false,
    },
  };
};

const sanitizeSideForSave = side => {
  const out = {};
  for (const key of SIDE_FIELD_KEYS) {
    if (side[key] !== undefined) {
      out[key] = side[key];
    }
  }
  return out;
};

const sanitizeSslForSave = (draft, currentVersion) => ({
  profile: {
    name: draft.profile.name,
    basedOnVersion: currentVersion,
  },
  bind: sanitizeSideForSave(draft.bind),
  server: sanitizeSideForSave(draft.server),
  tune: { ...draft.tune },
  providers: { ...draft.providers },
  loadExtraFiles: { ...draft.loadExtraFiles },
});

const arraysShallowEqual = (a, b) => {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};

const TlsVersionField = ({ profileName, side, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const overridden = sideHasOverride(side, 'enabledVersions');
  const effective = effectiveSideValue(profileName, side, 'enabledVersions');
  const selected = new Set(effective);
  const toggle = version => {
    const next = TLS_VERSIONS.filter(v => (v === version ? !selected.has(v) : selected.has(v)));
    onChange(next);
  };
  return (
    <Form.Group className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">
          {FIELD_LABEL.enabledVersions}
          {overridden ? (
            <Badge bg="warning" text="dark" className="ms-2">
              {t('haproxy:ssl.override', 'override')}
            </Badge>
          ) : null}
        </Form.Label>
        {overridden ? (
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={() => onChange(undefined)}
            title={t('haproxy:ssl.revertTitle', 'Revert to the preset value')}
          >
            {t('haproxy:ssl.resetToPreset', 'Reset to preset')}
          </Button>
        ) : null}
      </div>
      <div className="d-flex flex-wrap gap-3">
        {TLS_VERSIONS.map(v => (
          <Form.Check
            key={v}
            type="checkbox"
            id={`ssl-tlsver-${v}`}
            label={v}
            checked={selected.has(v)}
            onChange={() => toggle(v)}
          />
        ))}
      </div>
      <Form.Text className="text-muted">{FIELD_HELP.enabledVersions}</Form.Text>
    </Form.Group>
  );
};

TlsVersionField.propTypes = {
  profileName: PropTypes.string.isRequired,
  side: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const CapabilityCheckboxList = ({ field, profileName, side, available, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const overridden = sideHasOverride(side, field);
  const effective = effectiveSideValue(profileName, side, field);
  const selectedSet = new Set(effective);
  const knownItems = available;
  const orderedSelected = effective.filter(item => selectedSet.has(item));
  const extras = orderedSelected.filter(item => !knownItems.includes(item));
  const renderRows = [...knownItems, ...extras];

  const toggle = item => {
    if (selectedSet.has(item)) {
      onChange(orderedSelected.filter(x => x !== item));
    } else {
      onChange([...orderedSelected, item]);
    }
  };

  const isEmpty = effective.length === 0;

  return (
    <Form.Group className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">
          {FIELD_LABEL[field]}
          {overridden ? (
            <Badge bg="warning" text="dark" className="ms-2">
              {t('haproxy:ssl.overrideCount', 'override · {{count}} selected', {
                count: effective.length,
              })}
            </Badge>
          ) : (
            <Badge bg="secondary" className="ms-2">
              {t('haproxy:ssl.presetCount', 'preset · {{count}} selected', {
                count: effective.length,
              })}
            </Badge>
          )}
        </Form.Label>
        {overridden ? (
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={() => onChange(undefined)}
            title={t('haproxy:ssl.revertTitle', 'Revert to the preset value')}
          >
            {t('haproxy:ssl.resetToPreset', 'Reset to preset')}
          </Button>
        ) : null}
      </div>
      {renderRows.length === 0 ? (
        <p className="text-muted small mb-1">
          {t(
            'haproxy:ssl.noCapability',
            'No items reported by this HAProxy / OpenSSL build for this field.'
          )}
        </p>
      ) : (
        <div
          className="border rounded p-2"
          style={{ maxHeight: '16rem', overflowY: 'auto', background: 'var(--bs-body-bg)' }}
        >
          <div className="d-flex flex-wrap column-gap-3 row-gap-1">
            {renderRows.map(item => (
              <Form.Check
                key={item}
                type="checkbox"
                id={`ssl-${field}-${item}`}
                label={
                  <code className="small">
                    {item}
                    {extras.includes(item) ? ` (${t('haproxy:ssl.custom', 'custom')})` : ''}
                  </code>
                }
                checked={selectedSet.has(item)}
                onChange={() => toggle(item)}
                style={{ minWidth: '18rem' }}
              />
            ))}
          </div>
        </div>
      )}
      {isEmpty ? (
        <div className="small text-warning-emphasis mt-1">
          <i className="bi bi-exclamation-triangle me-1" />
          {t(
            'haproxy:ssl.emptyWarning',
            "No items selected — HAProxy will not emit a ssl-default-* directive for this field. OpenSSL's built-in defaults will apply at runtime."
          )}
        </div>
      ) : null}
      <Form.Text className="text-muted">{FIELD_HELP[field]}</Form.Text>
    </Form.Group>
  );
};

CapabilityCheckboxList.propTypes = {
  field: PropTypes.string.isRequired,
  profileName: PropTypes.string.isRequired,
  side: PropTypes.object.isRequired,
  available: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
};

const OptionsField = ({ profileName, side, onChange }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const overridden = sideHasOverride(side, 'options');
  const effective = effectiveSideValue(profileName, side, 'options');
  return (
    <Form.Group className="mb-3">
      <div className="d-flex justify-content-between align-items-center mb-1">
        <Form.Label className="mb-0">
          {FIELD_LABEL.options}
          {overridden ? (
            <Badge bg="warning" text="dark" className="ms-2">
              {t('haproxy:ssl.override', 'override')}
            </Badge>
          ) : null}
        </Form.Label>
        {overridden ? (
          <Button
            variant="link"
            size="sm"
            className="p-0"
            onClick={() => onChange(undefined)}
            title={t('haproxy:ssl.revertTitle', 'Revert to the preset value')}
          >
            {t('haproxy:ssl.resetToPreset', 'Reset to preset')}
          </Button>
        ) : null}
      </div>
      <ListEditor items={effective} onChange={onChange} placeholder="e.g. no-tls-tickets" />
      <Form.Text className="text-muted">
        {FIELD_HELP.options} {t('haproxy:ssl.knownTokens', 'Known tokens:')}{' '}
        {KNOWN_BIND_OPTIONS.join(', ')}.
      </Form.Text>
    </Form.Group>
  );
};

OptionsField.propTypes = {
  profileName: PropTypes.string.isRequired,
  side: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const SidePanel = ({ profileName, draftSide, capsBySide, onUpdate }) => {
  const updateField = (field, value) => {
    onUpdate({ ...draftSide, [field]: value });
  };
  return (
    <div className="pt-3">
      <TlsVersionField
        profileName={profileName}
        side={draftSide}
        onChange={value => updateField('enabledVersions', value)}
      />
      <CapabilityCheckboxList
        field="ciphers"
        profileName={profileName}
        side={draftSide}
        available={capsBySide.ciphers}
        onChange={value => updateField('ciphers', value)}
      />
      <CapabilityCheckboxList
        field="ciphersuites"
        profileName={profileName}
        side={draftSide}
        available={capsBySide.ciphersuites}
        onChange={value => updateField('ciphersuites', value)}
      />
      <CapabilityCheckboxList
        field="curves"
        profileName={profileName}
        side={draftSide}
        available={capsBySide.curves}
        onChange={value => updateField('curves', value)}
      />
      <CapabilityCheckboxList
        field="sigalgs"
        profileName={profileName}
        side={draftSide}
        available={capsBySide.sigalgs}
        onChange={value => updateField('sigalgs', value)}
      />
      <CapabilityCheckboxList
        field="clientSigalgs"
        profileName={profileName}
        side={draftSide}
        available={capsBySide.sigalgs}
        onChange={value => updateField('clientSigalgs', value)}
      />
      <OptionsField
        profileName={profileName}
        side={draftSide}
        onChange={value => updateField('options', value)}
      />
    </div>
  );
};

SidePanel.propTypes = {
  profileName: PropTypes.string.isRequired,
  draftSide: PropTypes.object.isRequired,
  capsBySide: PropTypes.shape({
    ciphers: PropTypes.arrayOf(PropTypes.string).isRequired,
    ciphersuites: PropTypes.arrayOf(PropTypes.string).isRequired,
    curves: PropTypes.arrayOf(PropTypes.string).isRequired,
    sigalgs: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  onUpdate: PropTypes.func.isRequired,
};

const TuneTab = ({ tune, onUpdate, requestKeylogConfirm }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const setField = (field, value) => onUpdate({ ...tune, [field]: value });
  const numericOrUndef = raw => {
    if (raw === '' || raw === null || raw === undefined) {
      return undefined;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  return (
    <div className="pt-3">
      <Row className="g-3">
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.default-dh-param</Form.Label>
            <Form.Control
              type="number"
              min={1024}
              value={tune.defaultDhParam ?? 4096}
              onChange={e => setField('defaultDhParam', numericOrUndef(e.target.value) ?? 4096)}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.dhParamHelp', 'DH params bit size. 2048 min; 4096 default.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.cachesize</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={tune.cachesize ?? ''}
              onChange={e => setField('cachesize', numericOrUndef(e.target.value))}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.cachesizeHelp', 'SSL session cache entries. Default 20000.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.lifetime (s)</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={tune.lifetime ?? ''}
              onChange={e => setField('lifetime', numericOrUndef(e.target.value))}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.lifetimeHelp', 'Session cache TTL. Default 300.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.maxrecord</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={tune.maxrecord ?? ''}
              onChange={e => setField('maxrecord', numericOrUndef(e.target.value))}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.maxrecordHelp', 'TLS record size; 0 = auto.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.capture-buffer-size</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={tune.captureBufferSize ?? ''}
              onChange={e => setField('captureBufferSize', numericOrUndef(e.target.value))}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.captureBufferHelp', 'ClientHello capture buffer.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3}>
          <Form.Group>
            <Form.Label>tune.ssl.async</Form.Label>
            <Form.Control
              type="number"
              min={0}
              value={tune.numAsync ?? ''}
              onChange={e => setField('numAsync', numericOrUndef(e.target.value))}
            />
            <Form.Text className="text-muted">
              {t('haproxy:ssl.tune.asyncHelp', 'Async engine threads.')}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col md={3} className="d-flex align-items-end">
          <Form.Check
            type="switch"
            id="ssl-tune-force-private-cache"
            label="force-private-cache"
            checked={tune.forcePrivateCache === true}
            onChange={e => setField('forcePrivateCache', e.target.checked ? true : undefined)}
          />
        </Col>
        <Col md={3} className="d-flex align-items-end">
          <Form.Check
            type="switch"
            id="ssl-tune-keylog"
            label={
              <span>
                keylog{' '}
                <Badge bg="danger" className="ms-1">
                  {t('haproxy:ssl.danger', 'danger')}
                </Badge>
              </span>
            }
            checked={tune.keylog === true}
            onChange={e => {
              const next = e.target.checked;
              if (next) {
                requestKeylogConfirm(confirmed => {
                  if (confirmed) {
                    setField('keylog', true);
                  }
                });
              } else {
                setField('keylog', false);
              }
            }}
          />
        </Col>
      </Row>
      {tune.keylog === true ? (
        <Alert variant="danger" className="small mt-3 mb-0">
          <i className="bi bi-shield-slash me-1" />
          <strong>{t('haproxy:ssl.keylogOnTitle', 'tune.ssl.keylog is ON.')}</strong>{' '}
          {t(
            'haproxy:ssl.keylogOnBody',
            'Session keys are written to the HAProxy log, allowing anyone with log access to decrypt past TLS traffic captured on the wire. Turn off before going live; this is a debugging-only flag.'
          )}
        </Alert>
      ) : null}
    </div>
  );
};

TuneTab.propTypes = {
  tune: PropTypes.shape({
    defaultDhParam: PropTypes.number,
    cachesize: PropTypes.number,
    lifetime: PropTypes.number,
    maxrecord: PropTypes.number,
    captureBufferSize: PropTypes.number,
    numAsync: PropTypes.number,
    forcePrivateCache: PropTypes.bool,
    keylog: PropTypes.bool,
  }).isRequired,
  onUpdate: PropTypes.func.isRequired,
  requestKeylogConfirm: PropTypes.func.isRequired,
};

const ExtrasTab = ({ providers, loadExtraFiles, onUpdateProviders, onUpdateLoadExtraFiles }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <div className="pt-3">
      <Row className="g-3">
        <Col xs={12}>
          <Form.Group>
            <Form.Label>
              {t('haproxy:ssl.providersLabel', 'OpenSSL providers loaded (reference / hint only)')}
            </Form.Label>
            <ListEditor
              items={providers.loaded}
              onChange={list => onUpdateProviders({ ...providers, loaded: list })}
              placeholder="e.g. default, fips, oqs"
            />
            <Form.Text className="text-muted">
              {t(
                'haproxy:ssl.providersHelp',
                'Tracked in state for documentation. Actual provider availability is reported by openssl list -providers and shown read-only above this card.'
              )}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Group>
            <Form.Label>
              {t('haproxy:ssl.providerDefaultProps', 'Provider default properties')}
            </Form.Label>
            <Form.Control
              type="text"
              value={providers.defaultProperties ?? ''}
              placeholder="e.g. fips=yes"
              onChange={e =>
                onUpdateProviders({
                  ...providers,
                  defaultProperties: e.target.value.trim() === '' ? null : e.target.value,
                })
              }
            />
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Group>
            <Form.Label>ssl-load-extra-files</Form.Label>
            <ListEditor
              items={loadExtraFiles.extraFiles}
              onChange={list => onUpdateLoadExtraFiles({ ...loadExtraFiles, extraFiles: list })}
              placeholder="e.g. ocsp, sctl, issuer"
            />
            <Form.Text className="text-muted">
              {t(
                'haproxy:ssl.extraFilesHelp',
                'Extra cert sidecar files to load alongside each PEM. Common values: ocsp, sctl, issuer.'
              )}
            </Form.Text>
          </Form.Group>
        </Col>
        <Col xs={12}>
          <Form.Check
            type="switch"
            id="ssl-load-extra-del-ext"
            label={t(
              'haproxy:ssl.loadExtraDelExt',
              'ssl-load-extra-del-ext (strip extension when matching siblings)'
            )}
            checked={loadExtraFiles.deleteExtensions === true}
            onChange={e =>
              onUpdateLoadExtraFiles({ ...loadExtraFiles, deleteExtensions: e.target.checked })
            }
          />
        </Col>
      </Row>
    </div>
  );
};

ExtrasTab.propTypes = {
  providers: PropTypes.shape({
    loaded: PropTypes.arrayOf(PropTypes.string).isRequired,
    defaultProperties: PropTypes.string,
  }).isRequired,
  loadExtraFiles: PropTypes.shape({
    extraFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
    deleteExtensions: PropTypes.bool,
  }).isRequired,
  onUpdateProviders: PropTypes.func.isRequired,
  onUpdateLoadExtraFiles: PropTypes.func.isRequired,
};

const RuntimeCapabilitiesBanner = ({ caps, loading, error }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  if (loading) {
    return (
      <Alert variant="light" className="border small mb-3 d-flex align-items-center gap-2">
        <Spinner size="sm" animation="border" />
        <span>
          {t(
            'haproxy:ssl.probing',
            'Probing installed HAProxy + OpenSSL for available ciphers / curves / sigalgs…'
          )}
        </span>
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert variant="warning" className="small mb-3">
        {t('haproxy:ssl.probeFailed', 'Capability probe failed')}: {error.message}.{' '}
        {t(
          'haproxy:ssl.probeFailedNote',
          'The cipher / curve / sigalg checkbox lists fall back to whatever is already in state. You can still save.'
        )}
      </Alert>
    );
  }
  if (!caps) {
    return null;
  }
  return (
    <Alert variant="light" className="border small mb-3">
      <div className="d-flex flex-wrap gap-3 align-items-center">
        <span>
          <i className="bi bi-cpu me-1" />
          <strong>HAProxy</strong> <code>{caps.haproxy?.version ?? '?'}</code> ·{' '}
          <strong>OpenSSL</strong> <code>{caps.haproxy?.opensslRunning ?? '?'}</code>
        </span>
        <span>
          {t(
            'haproxy:ssl.capsSummary',
            '{{c}} ciphers · {{cs}} ciphersuites · {{cv}} curves · {{sa}} sigalgs',
            {
              c: (caps.ciphers ?? []).length,
              cs: (caps.ciphersuites ?? []).length,
              cv: (caps.curves ?? []).length,
              sa: (caps.sigalgs ?? []).length,
            }
          )}
        </span>
        <span>
          {t('haproxy:ssl.providersLoaded', 'Providers loaded:')}{' '}
          {(caps.haproxy?.providersLoaded ?? []).length === 0
            ? `(${t('haproxy:ssl.noneReported', 'none reported')})`
            : (caps.haproxy?.providersLoaded ?? []).map(p => (
                <Badge key={p} bg="info" className="me-1">
                  {p}
                </Badge>
              ))}
        </span>
      </div>
    </Alert>
  );
};

RuntimeCapabilitiesBanner.propTypes = {
  caps: PropTypes.object,
  loading: PropTypes.bool.isRequired,
  error: PropTypes.object,
};

export const SslGlobalsCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const liveSsl = doc.globalSettings.ssl ?? {};
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const { caps, loading: capsLoading, error: capsError } = useSslCapabilities();
  const { confirm, ConfirmationDialog } = useConfirmation();

  const current = draft ?? cloneSsl(liveSsl);
  const dirty = draft !== null;

  const update = next => {
    setStatus(null);
    setDraft(next);
  };

  const profileName = current.profile.name;
  const presetVersion = current.profile.basedOnVersion ?? 0;
  const presetStale = profileName !== 'custom' && presetVersion < PROFILE_VERSION;

  const overrideCount = useMemo(
    () => countOverrides(current.bind) + countOverrides(current.server),
    [current.bind, current.server]
  );

  const capsBySide = useMemo(() => {
    const sigalgNames = (caps?.sigalgs ?? [])
      .map(raw => {
        const inner = typeof raw === 'string' ? raw : '';
        const inside = inner.match(/\{\s*(?<body>[^}]+)\s*\}/u);
        const body = inside ? inside.groups.body : inner;
        const names = body
          .split(',')
          .map(p => p.trim())
          .filter(Boolean)
          .filter(p => !p.startsWith('@'));
        return names.length > 0 ? names[names.length - 1] : null;
      })
      .filter(Boolean);
    const uniq = arr => [...new Set(arr)];
    return {
      ciphers: uniq((caps?.ciphers ?? []).map(c => c.name)),
      ciphersuites: uniq((caps?.ciphersuites ?? []).map(c => c.name)),
      curves: uniq(caps?.curves ?? []),
      sigalgs: uniq(sigalgNames),
    };
  }, [caps]);

  const setProfile = nextName => {
    if (nextName === profileName) {
      return;
    }
    update({
      ...current,
      profile: { name: nextName, basedOnVersion: PROFILE_VERSION },
    });
  };

  const requestKeylogConfirm = onResult => {
    confirm({
      title: t('haproxy:ssl.keylogConfirm.title', 'Enable tune.ssl.keylog?'),
      body: (
        <>
          {t(
            'haproxy:ssl.keylogConfirm.body',
            'Turning tune.ssl.keylog on writes session keys to the HAProxy log. Anyone with log access can decrypt TLS traffic captured on the wire. Use only for short-lived Wireshark debugging on a controlled environment. Never leave on in production.'
          )}
        </>
      ),
      confirmLabel: t('haproxy:ssl.keylogConfirm.confirm', 'Enable keylog'),
      confirmVariant: 'danger',
    })
      .then(onResult)
      .catch(() => onResult(false));
  };

  const refreshFromPreset = sideKey => {
    const presetSide = presetSideFor(profileName);
    const sanitized = { ...current[sideKey] };
    for (const key of SIDE_FIELD_KEYS) {
      if (sanitized[key] !== undefined && arraysShallowEqual(sanitized[key], presetSide[key])) {
        sanitized[key] = undefined;
      }
    }
    update({
      ...current,
      profile: { ...current.profile, basedOnVersion: PROFILE_VERSION },
      [sideKey]: sanitized,
    });
  };

  const refreshFromPresetBoth = () => {
    const presetSide = presetSideFor(profileName);
    const cleaned = sideObj => {
      const out = { ...sideObj };
      for (const key of SIDE_FIELD_KEYS) {
        if (out[key] !== undefined && arraysShallowEqual(out[key], presetSide[key])) {
          out[key] = undefined;
        }
      }
      return out;
    };
    update({
      ...current,
      profile: { ...current.profile, basedOnVersion: PROFILE_VERSION },
      bind: cleaned(current.bind),
      server: cleaned(current.server),
    });
  };

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    const next = {
      ...doc,
      globalSettings: {
        ...doc.globalSettings,
        ssl: sanitizeSslForSave(current, PROFILE_VERSION),
      },
    };
    onSave(next)
      .then(() => {
        setStatus({ kind: 'success', message: t('haproxy:common.saved', 'Saved.') });
        setDraft(null);
      })
      .catch(err => setStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start mb-2 gap-2 flex-wrap">
            <div>
              <Card.Title className="mb-1">
                {t('haproxy:ssl.title', 'SSL / TLS Globals')}
              </Card.Title>
              <Card.Text className="text-muted small mb-0">
                {t(
                  'haproxy:ssl.description',
                  'Mozilla profile + per-cipher/curve/suite overrides. Frontend and Backend are configured here. Empty array on any field means HAProxy will not emit the corresponding ssl-default-* directive — OpenSSL built-in defaults apply at runtime.'
                )}
              </Card.Text>
            </div>
            <div className="d-flex gap-2">
              <Badge bg={overrideCount === 0 ? 'success' : 'warning'} text="dark">
                {t('haproxy:ssl.overrideCountBadge', '{{count}} override', {
                  count: overrideCount,
                })}
              </Badge>
              {presetStale ? (
                <Badge bg="info">{t('haproxy:ssl.presetUpdated', 'preset updated')}</Badge>
              ) : null}
            </div>
          </div>
          <RuntimeCapabilitiesBanner caps={caps} loading={capsLoading} error={capsError} />
          {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
          {presetStale ? (
            <Alert
              variant="info"
              className="small d-flex justify-content-between align-items-center"
            >
              <span>
                {t(
                  'haproxy:ssl.presetStale',
                  'The {{name}} preset was based on version {{old}} when last saved. Current preset version is {{current}}.',
                  { name: profileName, old: presetVersion, current: PROFILE_VERSION }
                )}
              </span>
              <Button variant="outline-primary" size="sm" onClick={refreshFromPresetBoth}>
                {t('haproxy:ssl.refreshFromPreset', 'Refresh from current preset')}
              </Button>
            </Alert>
          ) : null}
          <Form onSubmit={submit}>
            <Row className="g-3 mb-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>{t('haproxy:ssl.profile', 'Profile')}</Form.Label>
                  <Form.Select value={profileName} onChange={e => setProfile(e.target.value)}>
                    {PROFILE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Text className="text-muted">
                    {t('haproxy:ssl.profileHelpPart1', 'Mozilla reference values from')}{' '}
                    <a
                      href="https://ssl-config.mozilla.org/"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      ssl-config.mozilla.org
                    </a>
                    .{' '}
                    {t(
                      'haproxy:ssl.profileHelpPart2',
                      'custom = no preset overlay; every field is explicit.'
                    )}
                  </Form.Text>
                </Form.Group>
              </Col>
              <Col md={6} className="d-flex align-items-end gap-2">
                {profileName !== 'custom' ? (
                  <>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => refreshFromPreset('bind')}
                      title={t(
                        'haproxy:ssl.resetBindTitle',
                        'Drop any bind-side override that already matches the preset value'
                      )}
                    >
                      {t('haproxy:ssl.resetBind', 'Reset bind overrides to preset')}
                    </Button>
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      onClick={() => refreshFromPreset('server')}
                      title={t(
                        'haproxy:ssl.resetServerTitle',
                        'Drop any server-side override that already matches the preset value'
                      )}
                    >
                      {t('haproxy:ssl.resetServer', 'Reset server overrides to preset')}
                    </Button>
                  </>
                ) : null}
              </Col>
            </Row>
            <Tabs defaultActiveKey="bind" id="ssl-globals-tabs" className="mb-1">
              <Tab eventKey="bind" title={t('haproxy:ssl.tabs.frontend', 'Frontend')}>
                <SidePanel
                  profileName={profileName}
                  draftSide={current.bind}
                  capsBySide={capsBySide}
                  onUpdate={next => update({ ...current, bind: next })}
                />
              </Tab>
              <Tab eventKey="server" title={t('haproxy:ssl.tabs.backend', 'Backend')}>
                <SidePanel
                  profileName={profileName}
                  draftSide={current.server}
                  capsBySide={capsBySide}
                  onUpdate={next => update({ ...current, server: next })}
                />
              </Tab>
              <Tab eventKey="tune" title={t('haproxy:ssl.tabs.tune', 'Tune')}>
                <TuneTab
                  tune={current.tune}
                  onUpdate={next => update({ ...current, tune: next })}
                  requestKeylogConfirm={requestKeylogConfirm}
                />
              </Tab>
              <Tab
                eventKey="extras"
                title={t('haproxy:ssl.tabs.extras', 'Providers + extra files')}
              >
                <ExtrasTab
                  providers={current.providers}
                  loadExtraFiles={current.loadExtraFiles}
                  onUpdateProviders={next => update({ ...current, providers: next })}
                  onUpdateLoadExtraFiles={next => update({ ...current, loadExtraFiles: next })}
                />
              </Tab>
            </Tabs>
            <div className="mt-3 d-flex gap-2">
              <Button type="submit" variant="primary" disabled={!dirty}>
                {t('haproxy:ssl.save', 'Save SSL / TLS settings')}
              </Button>
              {dirty ? (
                <Button variant="outline-secondary" onClick={() => setDraft(null)}>
                  {t('haproxy:common.discard', 'Discard changes')}
                </Button>
              ) : null}
            </div>
          </Form>
        </Card.Body>
      </Card>
      <ConfirmationDialog />
    </>
  );
};

SslGlobalsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
