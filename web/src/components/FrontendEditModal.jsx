// NO MIGRATION. If the schema changes, change it directly. Never write a
// migrator, a v1→v2 helper, a schemaUpgradedAt field, nothing.

import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Col, Form, Modal, Row, Tab, Table, Tabs } from 'react-bootstrap';

import { genKey } from '../utils/keys.js';

import { BindAddressPicker } from './BindAddressPicker.jsx';

const ID_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const SECTION_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;

const ERROR_FILE_CODES = Object.freeze([
  '200',
  '400',
  '401',
  '403',
  '404',
  '405',
  '407',
  '408',
  '410',
  '413',
  '421',
  '422',
  '425',
  '429',
  '500',
  '501',
  '502',
  '503',
  '504',
]);

const isQuicAddress = address =>
  typeof address === 'string' && (address.startsWith('quic4@') || address.startsWith('quic6@'));

const validateFrontend = draft => {
  if (!ID_REGEX.test(draft.id ?? '')) {
    return 'id must match a-z, 0-9, _, - (starting with a letter)';
  }
  if (!SECTION_NAME_REGEX.test(draft.name ?? '')) {
    return 'name must be a valid HAProxy section identifier (letters/digits/_/-, start with letter)';
  }
  if (!draft.fromDefaults?.trim()) {
    return 'a defaults block must be selected (create one on the Defaults page first)';
  }
  if (!draft.binds || draft.binds.length === 0) {
    return 'at least one bind is required';
  }
  for (const bind of draft.binds) {
    if (!bind.address?.trim()) {
      return 'every bind needs an address';
    }
  }
  return null;
};

const updateAtIndex = (list, idx, patch) =>
  list.map((item, i) => (i === idx ? { ...item, ...patch } : item));

const stripInternalKeys = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) {
      out[k] = v;
    }
  }
  return out;
};

const Field = ({ label, children, helpText, md = 6 }) => (
  <Col md={md}>
    <Form.Group className="mb-2">
      <Form.Label>{label}</Form.Label>
      {children}
      {helpText ? <Form.Text className="text-muted">{helpText}</Form.Text> : null}
    </Form.Group>
  </Col>
);

Field.propTypes = {
  label: PropTypes.node.isRequired,
  children: PropTypes.node.isRequired,
  helpText: PropTypes.node,
  md: PropTypes.number,
};

const SwitchField = ({ label, checked, onChange, id, helpText, md = 4 }) => (
  <Col md={md}>
    <Form.Group className="mb-2">
      <Form.Check
        type="switch"
        id={id}
        label={label}
        checked={Boolean(checked)}
        onChange={e => onChange(e.target.checked)}
      />
      {helpText ? <Form.Text className="text-muted d-block">{helpText}</Form.Text> : null}
    </Form.Group>
  </Col>
);

SwitchField.propTypes = {
  label: PropTypes.node.isRequired,
  checked: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  id: PropTypes.string.isRequired,
  helpText: PropTypes.node,
  md: PropTypes.number,
};

const SectionHeading = ({ children }) => (
  <Col xs={12} className="mt-2">
    <strong className="small text-muted text-uppercase">{children}</strong>
  </Col>
);

SectionHeading.propTypes = {
  children: PropTypes.node.isRequired,
};

const parseIntOrUndef = raw => {
  if (raw === '' || raw === null || raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : undefined;
};

const triStateBoolToString = value => {
  if (value === true) {
    return 'on';
  }
  if (value === false) {
    return 'off';
  }
  return '';
};

const triStateStringToBool = value => {
  if (value === 'on') {
    return true;
  }
  if (value === 'off') {
    return false;
  }
  return undefined;
};

// =====================================================================
// Capture-header editor — used by captureRequestHeaders / captureResponseHeaders.
// =====================================================================

const CaptureRow = ({ cap, onChange, onRemove }) => (
  <tr>
    <td>
      <Form.Control
        size="sm"
        value={cap.header ?? ''}
        placeholder="User-Agent"
        onChange={e => onChange({ ...cap, header: e.target.value })}
      />
    </td>
    <td style={{ width: '7rem' }}>
      <Form.Control
        size="sm"
        type="number"
        min={8}
        max={2048}
        value={cap.maxLen ?? 256}
        onChange={e => onChange({ ...cap, maxLen: parseIntOrUndef(e.target.value) ?? 256 })}
      />
    </td>
    <td className="text-end">
      <Button variant="outline-danger" size="sm" onClick={onRemove}>
        ×
      </Button>
    </td>
  </tr>
);

CaptureRow.propTypes = {
  cap: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const CaptureHeadersEditor = ({ items, onChange, addLabel }) => {
  const add = () => onChange([...(items ?? []), { _key: genKey(), header: '', maxLen: 256 }]);
  const remove = idx => {
    const next = items.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const list = items ?? [];
  return (
    <>
      {list.length === 0 ? (
        <p className="text-muted small mb-2">No captures.</p>
      ) : (
        <Table size="sm" bordered className="mb-2">
          <thead>
            <tr>
              <th>Header</th>
              <th>Max length (bytes)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((cap, idx) => (
              <CaptureRow
                key={cap._key}
                cap={cap}
                onChange={next => onChange(updateAtIndex(list, idx, next))}
                onRemove={() => remove(idx)}
              />
            ))}
          </tbody>
        </Table>
      )}
      <Button variant="outline-primary" size="sm" onClick={add}>
        {addLabel}
      </Button>
    </>
  );
};

CaptureHeadersEditor.propTypes = {
  items: PropTypes.array,
  onChange: PropTypes.func.isRequired,
  addLabel: PropTypes.string.isRequired,
};

// =====================================================================
// Stats auth users editor — array of {username, password}.
// =====================================================================

const StatsAuthRow = ({ user, onChange, onRemove }) => (
  <tr>
    <td>
      <Form.Control
        size="sm"
        value={user.username ?? ''}
        onChange={e => onChange({ ...user, username: e.target.value })}
      />
    </td>
    <td>
      <Form.Control
        size="sm"
        type="text"
        value={user.password ?? ''}
        onChange={e => onChange({ ...user, password: e.target.value })}
      />
    </td>
    <td className="text-end">
      <Button variant="outline-danger" size="sm" onClick={onRemove}>
        ×
      </Button>
    </td>
  </tr>
);

StatsAuthRow.propTypes = {
  user: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const StatsAuthUsersEditor = ({ users, onChange }) => {
  const add = () => onChange([...(users ?? []), { _key: genKey(), username: '', password: '' }]);
  const remove = idx => {
    const next = users.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const list = users ?? [];
  return (
    <>
      {list.length === 0 ? (
        <p className="text-muted small mb-2">No stats auth users.</p>
      ) : (
        <Table size="sm" bordered className="mb-2">
          <thead>
            <tr>
              <th>Username</th>
              <th>Password</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((user, idx) => (
              <StatsAuthRow
                key={user._key}
                user={user}
                onChange={next => onChange(updateAtIndex(list, idx, next))}
                onRemove={() => remove(idx)}
              />
            ))}
          </tbody>
        </Table>
      )}
      <Button variant="outline-primary" size="sm" onClick={add}>
        Add stats user
      </Button>
    </>
  );
};

StatsAuthUsersEditor.propTypes = {
  users: PropTypes.array,
  onChange: PropTypes.func.isRequired,
};

// =====================================================================
// Per-status errorfiles editor — stored as record {code: path} in schema,
// edited as Array<{_key, code, path}> in the form.
// =====================================================================

const ErrorFileRow = ({ entry, onChange, onRemove }) => (
  <tr>
    <td style={{ width: '8rem' }}>
      <Form.Select
        size="sm"
        value={entry.code ?? ''}
        onChange={e => onChange({ ...entry, code: e.target.value })}
      >
        <option value="">— code —</option>
        {ERROR_FILE_CODES.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Form.Select>
    </td>
    <td>
      <Form.Control
        size="sm"
        value={entry.path ?? ''}
        placeholder="/etc/haproxy/errors/tpl/503.http"
        onChange={e => onChange({ ...entry, path: e.target.value })}
      />
    </td>
    <td className="text-end">
      <Button variant="outline-danger" size="sm" onClick={onRemove}>
        ×
      </Button>
    </td>
  </tr>
);

ErrorFileRow.propTypes = {
  entry: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

const ErrorFilesEditor = ({ entries, onChange }) => {
  const add = () => onChange([...(entries ?? []), { _key: genKey(), code: '', path: '' }]);
  const remove = idx => {
    const next = entries.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const list = entries ?? [];
  return (
    <>
      {list.length === 0 ? (
        <p className="text-muted small mb-2">No per-status overrides.</p>
      ) : (
        <Table size="sm" bordered className="mb-2">
          <thead>
            <tr>
              <th>Status</th>
              <th>File path</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((entry, idx) => (
              <ErrorFileRow
                key={entry._key}
                entry={entry}
                onChange={next => onChange(updateAtIndex(list, idx, next))}
                onRemove={() => remove(idx)}
              />
            ))}
          </tbody>
        </Table>
      )}
      <Button variant="outline-primary" size="sm" onClick={add}>
        Add errorfile
      </Button>
    </>
  );
};

ErrorFilesEditor.propTypes = {
  entries: PropTypes.array,
  onChange: PropTypes.func.isRequired,
};

// =====================================================================
// Basics tab.
// =====================================================================

const BasicsTab = ({ draft, update, isExisting, doc }) => {
  const sections = doc.httpErrorsSections ?? [];
  const defaultsBlocks = doc.defaultsBlocks ?? [];
  return (
    <Row className="g-2 pt-3">
      <Field
        label="ID"
        helpText="Immutable after creation. Lowercase a-z, digits, _ or -, start with a letter."
      >
        <Form.Control
          type="text"
          value={draft.id ?? ''}
          disabled={isExisting}
          onChange={e => update({ id: e.target.value })}
        />
      </Field>
      <Field label="HAProxy section name" helpText="Rendered as `frontend NAME` in haproxy.cfg.">
        <Form.Control
          type="text"
          value={draft.name ?? ''}
          onChange={e => update({ name: e.target.value })}
        />
      </Field>
      <Field label="Description" md={12}>
        <Form.Control
          as="textarea"
          rows={2}
          value={draft.description ?? ''}
          onChange={e => update({ description: e.target.value || undefined })}
        />
      </Field>
      <Field label="Mode" md={3}>
        <Form.Select value={draft.mode ?? 'http'} onChange={e => update({ mode: e.target.value })}>
          <option value="http">http</option>
          <option value="tcp">tcp</option>
        </Form.Select>
      </Field>
      <Field label="maxconn" md={3} helpText="Per-frontend session cap. Leave blank for default.">
        <Form.Control
          type="number"
          min={1}
          value={draft.maxconn ?? ''}
          onChange={e => update({ maxconn: parseIntOrUndef(e.target.value) })}
        />
      </Field>
      <Field
        label="from (defaults block)"
        md={6}
        helpText="Required. Each frontend inherits from one named defaults block. Define them on the Defaults page."
      >
        <Form.Select
          value={draft.fromDefaults ?? ''}
          onChange={e => update({ fromDefaults: e.target.value || '' })}
          disabled={defaultsBlocks.length === 0}
        >
          <option value="">— choose a defaults block —</option>
          {defaultsBlocks.map(b => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.id})
            </option>
          ))}
        </Form.Select>
      </Field>
      <Field
        label="errorfiles section (frontend-level)"
        md={12}
        helpText="Reference one of the `http-errors NAME` sections (define them on the Error pages tab)."
      >
        <Form.Select
          value={draft.useErrorFilesId ?? ''}
          onChange={e => update({ useErrorFilesId: e.target.value || null })}
          disabled={sections.length === 0}
        >
          <option value="">(none — use defaults or per-status overrides)</option>
          {sections.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.id})
            </option>
          ))}
        </Form.Select>
      </Field>
      <SwitchField
        label="Enabled"
        id="fe-basics-enabled"
        checked={draft.enabled ?? true}
        onChange={v => update({ enabled: v })}
        md={12}
      />
    </Row>
  );
};

BasicsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  isExisting: PropTypes.bool.isRequired,
  doc: PropTypes.object.isRequired,
};

// =====================================================================
// Bind SSL block.
// =====================================================================

const SslIdentityFields = ({ ssl, setSsl }) => (
  <>
    <Field label="crt-list / @store/alias" md={6}>
      <Form.Control
        type="text"
        value={ssl.crtListRef ?? ''}
        placeholder="/etc/haproxy/certs.list or @store/alias"
        onChange={e => setSsl({ crtListRef: e.target.value || null })}
      />
    </Field>
    <Field label="default-crt (fallback when no SNI matches)" md={6}>
      <Form.Control
        type="text"
        value={ssl.defaultCert ?? ''}
        placeholder="/etc/haproxy/certs/fallback.pem"
        onChange={e => setSsl({ defaultCert: e.target.value || null })}
      />
    </Field>
    <Field label="ALPN" md={6} helpText="Comma-separated list (e.g. h2,http/1.1 or h3).">
      <Form.Control
        type="text"
        value={(ssl.alpn ?? []).join(',')}
        placeholder="h2,http/1.1"
        onChange={e =>
          setSsl({
            alpn: e.target.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean),
          })
        }
      />
    </Field>
    <Field label="curves" md={6}>
      <Form.Control
        type="text"
        value={ssl.curves ?? ''}
        placeholder="X25519:secp256r1:secp384r1"
        onChange={e => setSsl({ curves: e.target.value || undefined })}
      />
    </Field>
  </>
);

SslIdentityFields.propTypes = {
  ssl: PropTypes.object.isRequired,
  setSsl: PropTypes.func.isRequired,
};

const SslCipherFields = ({ ssl, setSsl }) => (
  <>
    <Field label="ciphers (TLS < 1.3)" md={12}>
      <Form.Control
        type="text"
        value={ssl.ciphers ?? ''}
        placeholder="ECDHE-ECDSA-AES128-GCM-SHA256:…"
        onChange={e => setSsl({ ciphers: e.target.value || undefined })}
      />
    </Field>
    <Field label="ciphersuites (TLS 1.3)" md={12}>
      <Form.Control
        type="text"
        value={ssl.ciphersuites ?? ''}
        placeholder="TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384"
        onChange={e => setSsl({ ciphersuites: e.target.value || undefined })}
      />
    </Field>
    <Field label="sigalgs (server signature algs)" md={6}>
      <Form.Control
        type="text"
        value={ssl.sigalgs ?? ''}
        onChange={e => setSsl({ sigalgs: e.target.value || undefined })}
      />
    </Field>
    <Field label="client-sigalgs" md={6}>
      <Form.Control
        type="text"
        value={ssl.clientSigalgs ?? ''}
        onChange={e => setSsl({ clientSigalgs: e.target.value || undefined })}
      />
    </Field>
  </>
);

SslCipherFields.propTypes = {
  ssl: PropTypes.object.isRequired,
  setSsl: PropTypes.func.isRequired,
};

const TrustedCaSelect = ({ value, onChange, trustedCas, placeholder = '(none)' }) => (
  <Form.Select value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}>
    <option value="">{placeholder}</option>
    {trustedCas.map(ca => (
      <option key={ca.id} value={ca.id}>
        {ca.name} ({ca.id})
      </option>
    ))}
  </Form.Select>
);

TrustedCaSelect.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  trustedCas: PropTypes.array.isRequired,
  placeholder: PropTypes.string,
};

const TrustedCrlSelect = ({ value, onChange, trustedCrls, placeholder = '(none)' }) => (
  <Form.Select value={value ?? ''} onChange={e => onChange(e.target.value || undefined)}>
    <option value="">{placeholder}</option>
    {trustedCrls.map(crl => (
      <option key={crl.id} value={crl.id}>
        {crl.name} ({crl.id})
      </option>
    ))}
  </Form.Select>
);

TrustedCrlSelect.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  trustedCrls: PropTypes.array.isRequired,
  placeholder: PropTypes.string,
};

const SslMtlsFields = ({ ssl, setSsl, trustedCas, trustedCrls }) => (
  <>
    <Field
      label="ca-file (mTLS client cert validation)"
      md={6}
      helpText={
        trustedCas.length === 0
          ? 'No trusted CAs uploaded yet — add one on the Certificates page.'
          : 'Bundle used to verify client certs presented to this bind.'
      }
    >
      <TrustedCaSelect
        value={ssl.caTrustedCaId}
        onChange={next => setSsl({ caTrustedCaId: next })}
        trustedCas={trustedCas}
      />
    </Field>
    <Field
      label="ca-verify-file (alternate chain for ca-names)"
      md={6}
      helpText="Optional. Lets HAProxy advertise different CA names than the chain it verifies against."
    >
      <TrustedCaSelect
        value={ssl.caVerifyTrustedCaId}
        onChange={next => setSsl({ caVerifyTrustedCaId: next })}
        trustedCas={trustedCas}
      />
    </Field>
    <Field label="verify" md={3}>
      <Form.Select
        value={ssl.verify ?? ''}
        onChange={e => setSsl({ verify: e.target.value || undefined })}
      >
        <option value="">(default)</option>
        <option value="none">none</option>
        <option value="optional">optional</option>
        <option value="required">required</option>
      </Form.Select>
    </Field>
    <Field
      label="crl-file (revocation list)"
      md={3}
      helpText={
        trustedCrls.length === 0
          ? 'No trusted CRLs uploaded yet — add one on the Certificates page.'
          : 'CRL HAProxy uses to reject revoked client certs at the TLS handshake.'
      }
    >
      <TrustedCrlSelect
        value={ssl.crlTrustedCrlId}
        onChange={next => setSsl({ crlTrustedCrlId: next })}
        trustedCrls={trustedCrls}
      />
    </Field>
    <Field label="ocsp-update-uri" md={6}>
      <Form.Control
        type="text"
        value={ssl.ocspUpdateUri ?? ''}
        onChange={e => setSsl({ ocspUpdateUri: e.target.value || undefined })}
      />
    </Field>
  </>
);

SslMtlsFields.propTypes = {
  ssl: PropTypes.object.isRequired,
  setSsl: PropTypes.func.isRequired,
  trustedCas: PropTypes.array.isRequired,
  trustedCrls: PropTypes.array.isRequired,
};

const SslVersionFields = ({ ssl, setSsl }) => (
  <>
    <Field label="ssl-min-ver" md={3}>
      <Form.Select
        value={ssl.sslMinVersion ?? ''}
        onChange={e => setSsl({ sslMinVersion: e.target.value || undefined })}
      >
        <option value="">(default)</option>
        <option value="TLSv1.2">TLSv1.2</option>
        <option value="TLSv1.3">TLSv1.3</option>
      </Form.Select>
    </Field>
    <Field label="ssl-max-ver" md={3}>
      <Form.Select
        value={ssl.sslMaxVersion ?? ''}
        onChange={e => setSsl({ sslMaxVersion: e.target.value || undefined })}
      >
        <option value="">(default)</option>
        <option value="TLSv1.2">TLSv1.2</option>
        <option value="TLSv1.3">TLSv1.3</option>
      </Form.Select>
    </Field>
  </>
);

SslVersionFields.propTypes = {
  ssl: PropTypes.object.isRequired,
  setSsl: PropTypes.func.isRequired,
};

const SSL_FLAG_TOGGLES = Object.freeze([
  { key: 'strictSni', label: 'strict-sni (reject TLS with no matching cert)' },
  { key: 'noTlsTickets', label: 'no-tls-tickets' },
  { key: 'allow0rtt', label: 'allow-0rtt' },
  { key: 'preferClientCiphers', label: 'prefer-client-ciphers' },
  { key: 'crtIgnoreErrors', label: 'crt-ignore-err all' },
  { key: 'caIgnoreErrors', label: 'ca-ignore-err all' },
  { key: 'noCaNames', label: 'no-ca-names (HAProxy 2.2+)' },
]);

const SslFlagSwitches = ({ ssl, setSsl, bindId }) => (
  <>
    {SSL_FLAG_TOGGLES.map(t => (
      <SwitchField
        key={t.key}
        label={t.label}
        id={`bind-${bindId}-${t.key}`}
        checked={ssl[t.key]}
        onChange={v => setSsl({ [t.key]: v })}
        md={6}
      />
    ))}
  </>
);

SslFlagSwitches.propTypes = {
  ssl: PropTypes.object.isRequired,
  setSsl: PropTypes.func.isRequired,
  bindId: PropTypes.string.isRequired,
};

const BindSslSection = ({ bind, onChange, trustedCas, trustedCrls }) => {
  const ssl = bind.ssl ?? {};
  const setSsl = patch => onChange({ ...bind, ssl: { ...ssl, ...patch } });
  return (
    <Row className="g-2 mt-1">
      <Col xs={12}>
        <Form.Check
          type="switch"
          id={`bind-${bind.id}-ssl-enabled`}
          label="SSL / TLS enabled on this bind"
          checked={Boolean(ssl.enabled)}
          onChange={e => setSsl({ enabled: e.target.checked })}
        />
      </Col>
      {ssl.enabled ? (
        <>
          <SslIdentityFields ssl={ssl} setSsl={setSsl} />
          <SslCipherFields ssl={ssl} setSsl={setSsl} />
          <SslVersionFields ssl={ssl} setSsl={setSsl} />
          <SslMtlsFields
            ssl={ssl}
            setSsl={setSsl}
            trustedCas={trustedCas}
            trustedCrls={trustedCrls}
          />
          <SslFlagSwitches ssl={ssl} setSsl={setSsl} bindId={bind.id} />
        </>
      ) : null}
    </Row>
  );
};

BindSslSection.propTypes = {
  bind: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  trustedCas: PropTypes.array.isRequired,
  trustedCrls: PropTypes.array.isRequired,
};

// =====================================================================
// Bind QUIC block.
// =====================================================================

const BindQuicSection = ({ bind, onChange }) => {
  if (!isQuicAddress(bind.address)) {
    return null;
  }
  const quic = bind.quic ?? {};
  const setQuic = patch => onChange({ ...bind, quic: { ...quic, ...patch } });
  return (
    <Row className="g-2 mt-1">
      <SectionHeading>QUIC (per-bind)</SectionHeading>
      <Field
        label="quic-cc-algo"
        md={3}
        helpText="Congestion control for this listener. `nocc` disables CC (debug only)."
      >
        <Form.Select
          value={quic.ccAlgo ?? ''}
          onChange={e => setQuic({ ccAlgo: e.target.value || undefined })}
        >
          <option value="">(default)</option>
          <option value="cubic">cubic</option>
          <option value="bbr">bbr</option>
          <option value="newreno">newreno</option>
          <option value="nocc">nocc</option>
        </Form.Select>
      </Field>
      <Field
        label="quic-cc-algo window"
        md={3}
        helpText="Optional initial congestion window size (e.g. 1m, 100k)."
      >
        <Form.Control
          type="text"
          value={quic.ccAlgoWindow ?? ''}
          placeholder="1m"
          onChange={e => setQuic({ ccAlgoWindow: e.target.value || undefined })}
        />
      </Field>
      <Field
        label="quic-socket"
        md={3}
        helpText="`connection` = one UDP socket per QUIC connection (better perf, requires SO_REUSEPORT)."
      >
        <Form.Select
          value={quic.socket ?? ''}
          onChange={e => setQuic({ socket: e.target.value || undefined })}
        >
          <option value="">(default)</option>
          <option value="connection">connection</option>
          <option value="listener">listener</option>
        </Form.Select>
      </Field>
      <SwitchField
        label="quic-force-retry"
        id={`bind-${bind.id}-quic-force-retry`}
        checked={quic.forceRetry}
        onChange={v => setQuic({ forceRetry: v })}
        md={3}
      />
    </Row>
  );
};

BindQuicSection.propTypes = {
  bind: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

// =====================================================================
// Bind row (per-bind base + tuning + SSL + QUIC).
// =====================================================================

const BindBaseFields = ({ bind, onChange, floatingIps, savedAddresses }) => (
  <Row className="g-2">
    <Field
      label="Address"
      md={6}
      helpText="*:443, [::]:443, 127.0.0.1:5432, quic4@*:443, /var/run/haproxy.sock, etc."
    >
      <BindAddressPicker
        value={bind.address ?? ''}
        floatingIpInstanceId={bind.floatingIpInstanceId ?? null}
        floatingIps={floatingIps}
        savedAddresses={savedAddresses}
        onChange={({ address, floatingIpInstanceId }) =>
          onChange({ ...bind, address, floatingIpInstanceId })
        }
      />
    </Field>
    <Field label="bind name (shows in stats)" md={3}>
      <Form.Control
        type="text"
        value={bind.name ?? ''}
        onChange={e => onChange({ ...bind, name: e.target.value || undefined })}
      />
    </Field>
    <Field label="label (UX-only)" md={3}>
      <Form.Control
        type="text"
        value={bind.label ?? ''}
        onChange={e => onChange({ ...bind, label: e.target.value || undefined })}
      />
    </Field>
    <Field label="IP family" md={3}>
      <Form.Select
        value={bind.ipFamily ?? ''}
        onChange={e => onChange({ ...bind, ipFamily: e.target.value || undefined })}
      >
        <option value="">(default)</option>
        <option value="v4">v4v6</option>
        <option value="v6">v6only</option>
        <option value="dual">dual</option>
      </Form.Select>
    </Field>
    <Field label="interface" md={3}>
      <Form.Control
        type="text"
        value={bind.interface ?? ''}
        onChange={e => onChange({ ...bind, interface: e.target.value || undefined })}
      />
    </Field>
    <Field label="namespace" md={3}>
      <Form.Control
        type="text"
        value={bind.namespace ?? ''}
        onChange={e => onChange({ ...bind, namespace: e.target.value || undefined })}
      />
    </Field>
    <Field label="thread (e.g. g1/1-4)" md={3}>
      <Form.Control
        type="text"
        value={bind.thread ?? ''}
        onChange={e => onChange({ ...bind, thread: e.target.value || undefined })}
      />
    </Field>
  </Row>
);

BindBaseFields.propTypes = {
  bind: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  floatingIps: PropTypes.array.isRequired,
  savedAddresses: PropTypes.array.isRequired,
};

const BindTuningFields = ({ bind, onChange }) => (
  <Row className="g-2 mt-1">
    <SectionHeading>Listener tuning</SectionHeading>
    <Field label="shards" md={3} helpText="HAProxy 2.5+: by-thread / by-group / number">
      <Form.Control
        type="text"
        value={bind.shards ?? ''}
        placeholder="by-thread"
        onChange={e => {
          const v = e.target.value;
          if (v === '') {
            onChange({ ...bind, shards: undefined });
            return;
          }
          const n = Number.parseInt(v, 10);
          if (Number.isInteger(n) && String(n) === v) {
            onChange({ ...bind, shards: n });
            return;
          }
          onChange({ ...bind, shards: v });
        }}
      />
    </Field>
    <Field label="backlog" md={3}>
      <Form.Control
        type="number"
        min={1}
        value={bind.backlog ?? ''}
        onChange={e => onChange({ ...bind, backlog: parseIntOrUndef(e.target.value) })}
      />
    </Field>
    <Field label="maxconn (per-listener)" md={3}>
      <Form.Control
        type="number"
        min={1}
        value={bind.maxconn ?? ''}
        onChange={e => onChange({ ...bind, maxconn: parseIntOrUndef(e.target.value) })}
      />
    </Field>
    <Field label="nice (-20..19)" md={3}>
      <Form.Control
        type="number"
        min={-20}
        max={19}
        value={bind.nice ?? ''}
        onChange={e => {
          const v = e.target.value;
          if (v === '') {
            onChange({ ...bind, nice: undefined });
            return;
          }
          const n = Number.parseInt(v, 10);
          onChange({ ...bind, nice: Number.isInteger(n) ? n : undefined });
        }}
      />
    </Field>
    <Field label="mss" md={3} helpText="TCP MSS clamp">
      <Form.Control
        type="number"
        min={1}
        value={bind.mss ?? ''}
        onChange={e => onChange({ ...bind, mss: parseIntOrUndef(e.target.value) })}
      />
    </Field>
    <Field label="tcp-ut (TCP_USER_TIMEOUT)" md={3}>
      <Form.Control
        type="text"
        value={bind.tcpUt ?? ''}
        placeholder="e.g. 30s"
        onChange={e => onChange({ ...bind, tcpUt: e.target.value || undefined })}
      />
    </Field>
    <Field label="tcp-quickack" md={2} helpText="Three-state: default / on / off">
      <Form.Select
        value={triStateBoolToString(bind.tcpQuickAck)}
        onChange={e => onChange({ ...bind, tcpQuickAck: triStateStringToBool(e.target.value) })}
      >
        <option value="">(default)</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </Form.Select>
    </Field>
    <SwitchField
      label="defer-accept"
      id={`bind-${bind.id}-defer-accept`}
      checked={bind.deferAccept}
      onChange={v => onChange({ ...bind, deferAccept: v ? true : undefined })}
      md={2}
    />
    <SwitchField
      label="tfo (TCP Fast Open)"
      id={`bind-${bind.id}-tfo`}
      checked={bind.tfo}
      onChange={v => onChange({ ...bind, tfo: v ? true : undefined })}
      md={2}
    />
    <SwitchField
      label="accept-proxy"
      id={`bind-${bind.id}-accept-proxy`}
      checked={bind.acceptProxy}
      onChange={v => onChange({ ...bind, acceptProxy: v })}
      md={3}
    />
    <SwitchField
      label="transparent"
      id={`bind-${bind.id}-transparent`}
      checked={bind.transparent}
      onChange={v => onChange({ ...bind, transparent: v })}
      md={3}
    />
  </Row>
);

BindTuningFields.propTypes = {
  bind: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const BindRow = ({
  bind,
  idx,
  onChange,
  onRemove,
  canRemove,
  trustedCas,
  trustedCrls,
  floatingIps,
  savedAddresses,
}) => (
  <div className="border rounded p-3 mb-2">
    <div className="d-flex justify-content-between align-items-center mb-2">
      <Badge bg="secondary">Bind #{idx + 1}</Badge>
      <Button
        variant="outline-danger"
        size="sm"
        disabled={!canRemove}
        onClick={onRemove}
        title={canRemove ? 'Remove this bind' : 'A frontend needs at least one bind'}
      >
        Remove bind
      </Button>
    </div>
    <BindBaseFields
      bind={bind}
      onChange={onChange}
      floatingIps={floatingIps}
      savedAddresses={savedAddresses}
    />
    <BindTuningFields bind={bind} onChange={onChange} />
    <BindSslSection
      bind={bind}
      onChange={onChange}
      trustedCas={trustedCas}
      trustedCrls={trustedCrls}
    />
    <BindQuicSection bind={bind} onChange={onChange} />
  </div>
);

BindRow.propTypes = {
  bind: PropTypes.object.isRequired,
  idx: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  canRemove: PropTypes.bool.isRequired,
  trustedCas: PropTypes.array.isRequired,
  trustedCrls: PropTypes.array.isRequired,
  floatingIps: PropTypes.array.isRequired,
  savedAddresses: PropTypes.array.isRequired,
};

const BindsTab = ({ draft, update, trustedCas, trustedCrls, floatingIps, savedAddresses }) => {
  const binds = draft.binds ?? [];
  const updateBind = (idx, next) => update({ binds: binds.map((b, i) => (i === idx ? next : b)) });
  const removeBind = idx => {
    const next = binds.slice();
    next.splice(idx, 1);
    update({ binds: next });
  };
  const addBind = () =>
    update({
      binds: [
        ...binds,
        {
          id: `b${genKey()}`,
          address: '',
          floatingIpInstanceId: null,
          ssl: { enabled: false },
          quic: {},
        },
      ],
    });
  return (
    <div className="pt-3">
      {binds.map((bind, idx) => (
        <BindRow
          key={bind.id}
          bind={bind}
          idx={idx}
          onChange={next => updateBind(idx, next)}
          onRemove={() => removeBind(idx)}
          canRemove={binds.length > 1}
          trustedCas={trustedCas}
          trustedCrls={trustedCrls}
          floatingIps={floatingIps}
          savedAddresses={savedAddresses}
        />
      ))}
      <Button variant="outline-primary" size="sm" onClick={addBind}>
        <i className="bi bi-plus-lg me-1" />
        Add bind
      </Button>
    </div>
  );
};

BindsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  trustedCas: PropTypes.array.isRequired,
  trustedCrls: PropTypes.array.isRequired,
  floatingIps: PropTypes.array.isRequired,
  savedAddresses: PropTypes.array.isRequired,
};

// =====================================================================
// HTTP options — Routing, default backend, ACME, monitor, rate-limit.
// =====================================================================

const HttpRoutingFields = ({ httpOpts, setHttpOpts, backends }) => (
  <Row className="g-2">
    <Field label="Default backend" md={6}>
      <Form.Select
        value={httpOpts.defaultBackendId ?? ''}
        onChange={e => setHttpOpts({ defaultBackendId: e.target.value || null })}
      >
        <option value="">(none)</option>
        {backends.map(b => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.id})
          </option>
        ))}
      </Form.Select>
    </Field>
    <Field label="rate-limit sessions (per second)" md={4}>
      <Form.Control
        type="number"
        min={1}
        value={httpOpts.rateLimitSessions ?? ''}
        onChange={e => setHttpOpts({ rateLimitSessions: parseIntOrUndef(e.target.value) })}
      />
    </Field>
    <Field label="monitor-uri" md={4}>
      <Form.Control
        type="text"
        value={httpOpts.monitorUri ?? ''}
        placeholder="/healthz"
        onChange={e => setHttpOpts({ monitorUri: e.target.value || undefined })}
      />
    </Field>
    <Field label="monitor fail (HAProxy expression)" md={4}>
      <Form.Control
        type="text"
        value={httpOpts.monitorFail ?? ''}
        placeholder="!nbsrv lt 1"
        onChange={e => setHttpOpts({ monitorFail: e.target.value || undefined })}
      />
    </Field>
  </Row>
);

HttpRoutingFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
};

// =====================================================================
// HTTP response policy — HSTS / CORS / compression.
// =====================================================================

const HstsFields = ({ hsts, setHsts }) => (
  <>
    <SectionHeading>HSTS</SectionHeading>
    <SwitchField
      label="HSTS enabled"
      id="hsts-enabled"
      checked={hsts.enabled}
      onChange={v => setHsts({ ...hsts, enabled: v })}
      md={4}
    />
    <Field label="max-age (seconds)" md={4}>
      <Form.Control
        type="number"
        value={hsts.maxAge ?? 16000000}
        disabled={!hsts.enabled}
        onChange={e => setHsts({ ...hsts, maxAge: parseIntOrUndef(e.target.value) ?? 0 })}
      />
    </Field>
    <SwitchField
      label="includeSubDomains"
      id="hsts-subdomains"
      checked={hsts.includeSubdomains}
      onChange={v => setHsts({ ...hsts, includeSubdomains: v })}
      md={2}
    />
    <SwitchField
      label="preload"
      id="hsts-preload"
      checked={hsts.preload}
      onChange={v => setHsts({ ...hsts, preload: v })}
      md={2}
    />
  </>
);

HstsFields.propTypes = {
  hsts: PropTypes.object.isRequired,
  setHsts: PropTypes.func.isRequired,
};

const CorsFields = ({ cors, setCors }) => (
  <>
    <SectionHeading>CORS</SectionHeading>
    <SwitchField
      label="CORS enabled"
      id="cors-enabled"
      checked={cors.enabled}
      onChange={v => setCors({ ...cors, enabled: v })}
      md={4}
    />
    <Field label="frame-ancestors" md={8}>
      <Form.Control
        type="text"
        value={cors.frameAncestors ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, frameAncestors: e.target.value || null })}
      />
    </Field>
    <Field label="Allow-Origin" md={6}>
      <Form.Control
        type="text"
        value={cors.allowOrigin ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, allowOrigin: e.target.value || null })}
      />
    </Field>
    <Field label="Expose-Headers" md={6}>
      <Form.Control
        type="text"
        value={cors.exposeHeaders ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, exposeHeaders: e.target.value || null })}
      />
    </Field>
    <Field label="Allow-Headers" md={6}>
      <Form.Control
        type="text"
        value={cors.allowHeaders ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, allowHeaders: e.target.value || null })}
      />
    </Field>
    <Field label="Allow-Methods" md={6}>
      <Form.Control
        type="text"
        value={cors.allowMethods ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, allowMethods: e.target.value || null })}
      />
    </Field>
    <SwitchField
      label="Allow-Credentials"
      id="cors-creds"
      checked={cors.allowCredentials}
      onChange={v => setCors({ ...cors, allowCredentials: v })}
      md={4}
    />
    <Field label="max-age" md={4}>
      <Form.Control
        type="number"
        value={cors.maxAge ?? ''}
        disabled={!cors.enabled}
        onChange={e => setCors({ ...cors, maxAge: parseIntOrUndef(e.target.value) })}
      />
    </Field>
  </>
);

CorsFields.propTypes = {
  cors: PropTypes.object.isRequired,
  setCors: PropTypes.func.isRequired,
};

const CompressionFields = ({ compression, setCompression }) => (
  <>
    <SectionHeading>Compression</SectionHeading>
    <SwitchField
      label="Compression enabled"
      id="comp-enabled"
      checked={compression.enabled}
      onChange={v => setCompression({ ...compression, enabled: v })}
      md={4}
    />
    <Field label="Algorithm" md={4}>
      <Form.Select
        value={compression.algorithm ?? 'gzip'}
        disabled={!compression.enabled}
        onChange={e => setCompression({ ...compression, algorithm: e.target.value })}
      >
        <option value="gzip">gzip</option>
        <option value="deflate">deflate</option>
        <option value="raw-deflate">raw-deflate</option>
      </Form.Select>
    </Field>
    <SwitchField
      label="offload"
      id="comp-offload"
      checked={compression.offload}
      onChange={v => setCompression({ ...compression, offload: v })}
      md={4}
    />
    <Field label="MIME types (one per line)" md={12}>
      <Form.Control
        as="textarea"
        rows={3}
        value={(compression.types ?? []).join('\n')}
        disabled={!compression.enabled}
        onChange={e =>
          setCompression({
            ...compression,
            types: e.target.value
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean),
          })
        }
      />
    </Field>
  </>
);

CompressionFields.propTypes = {
  compression: PropTypes.object.isRequired,
  setCompression: PropTypes.func.isRequired,
};

const HttpResponseFields = ({ httpOpts, setHttpOpts }) => {
  const hsts = httpOpts.hsts ?? {};
  const cors = httpOpts.cors ?? {};
  const compression = httpOpts.compression ?? {};
  return (
    <Row className="g-2">
      <HstsFields hsts={hsts} setHsts={v => setHttpOpts({ hsts: v })} />
      <CorsFields cors={cors} setCors={v => setHttpOpts({ cors: v })} />
      <CompressionFields
        compression={compression}
        setCompression={v => setHttpOpts({ compression: v })}
      />
    </Row>
  );
};

HttpResponseFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// forwardFor + Capture + originalto.
// =====================================================================

const HttpForwardForFields = ({ httpOpts, setHttpOpts }) => {
  const ff = httpOpts.forwardFor ?? {};
  const setFf = patch => setHttpOpts({ forwardFor: { ...ff, ...patch } });
  return (
    <Row className="g-2">
      <SectionHeading>option forwardfor</SectionHeading>
      <SwitchField
        label="forwardfor enabled"
        id="ff-enabled"
        checked={ff.enabled}
        onChange={v => setFf({ enabled: v })}
        md={4}
      />
      <Field label="header (override default X-Forwarded-For)" md={4}>
        <Form.Control
          type="text"
          value={ff.header ?? ''}
          disabled={!ff.enabled}
          onChange={e => setFf({ header: e.target.value || undefined })}
        />
      </Field>
      <Field label="except (CIDR to skip)" md={4}>
        <Form.Control
          type="text"
          value={ff.except ?? ''}
          disabled={!ff.enabled}
          placeholder="10.0.0.0/8"
          onChange={e => setFf({ except: e.target.value || undefined })}
        />
      </Field>
      <SwitchField
        label="if-none (don't overwrite existing header)"
        id="ff-ifnone"
        checked={ff.ifNone}
        onChange={v => setFf({ ifNone: v })}
        md={6}
      />
    </Row>
  );
};

HttpForwardForFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

const HttpOriginalToFields = ({ httpOpts, setHttpOpts }) => {
  const o = httpOpts.optionOriginalto ?? {};
  const setO = patch => setHttpOpts({ optionOriginalto: { ...o, ...patch } });
  return (
    <Row className="g-2">
      <SectionHeading>option originalto</SectionHeading>
      <SwitchField
        label="originalto enabled"
        id="orig-enabled"
        checked={o.enabled}
        onChange={v => setO({ enabled: v })}
        md={4}
      />
      <Field label="header" md={4}>
        <Form.Control
          type="text"
          value={o.header ?? ''}
          disabled={!o.enabled}
          onChange={e => setO({ header: e.target.value || undefined })}
        />
      </Field>
      <Field label="except (CIDR)" md={4}>
        <Form.Control
          type="text"
          value={o.except ?? ''}
          disabled={!o.enabled}
          onChange={e => setO({ except: e.target.value || undefined })}
        />
      </Field>
    </Row>
  );
};

HttpOriginalToFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

const HttpCaptureFields = ({ httpOpts, setHttpOpts }) => {
  const cookie = httpOpts.captureCookie ?? {};
  const setCookie = patch => setHttpOpts({ captureCookie: { ...cookie, ...patch } });
  return (
    <div className="d-flex flex-column gap-3">
      <div>
        <strong className="small text-muted text-uppercase d-block mb-1">
          Capture request headers
        </strong>
        <CaptureHeadersEditor
          items={httpOpts.captureRequestHeaders}
          addLabel="Add request capture"
          onChange={list => setHttpOpts({ captureRequestHeaders: list })}
        />
      </div>
      <div>
        <strong className="small text-muted text-uppercase d-block mb-1">
          Capture response headers
        </strong>
        <CaptureHeadersEditor
          items={httpOpts.captureResponseHeaders}
          addLabel="Add response capture"
          onChange={list => setHttpOpts({ captureResponseHeaders: list })}
        />
      </div>
      <Row className="g-2">
        <SectionHeading>Capture cookie</SectionHeading>
        <SwitchField
          label="Capture cookie"
          id="cap-cookie-enabled"
          checked={cookie.enabled}
          onChange={v => setCookie({ enabled: v })}
          md={4}
        />
        <Field label="Cookie name" md={4}>
          <Form.Control
            type="text"
            value={cookie.name ?? ''}
            disabled={!cookie.enabled}
            onChange={e => setCookie({ name: e.target.value || undefined })}
          />
        </Field>
        <Field label="Max length" md={4}>
          <Form.Control
            type="number"
            min={8}
            max={2048}
            value={cookie.maxLen ?? 256}
            disabled={!cookie.enabled}
            onChange={e => setCookie({ maxLen: parseIntOrUndef(e.target.value) ?? 256 })}
          />
        </Field>
      </Row>
    </div>
  );
};

HttpCaptureFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// Timeouts + Logging.
// =====================================================================

const HttpTimeoutsAndLoggingFields = ({ httpOpts, setHttpOpts }) => (
  <Row className="g-2">
    <SectionHeading>Per-frontend timeouts (override defaults)</SectionHeading>
    <Field label="timeout client" md={3}>
      <Form.Control
        type="text"
        value={httpOpts.timeoutClient ?? ''}
        placeholder="e.g. 1m"
        onChange={e => setHttpOpts({ timeoutClient: e.target.value || undefined })}
      />
    </Field>
    <Field label="timeout http-request" md={3}>
      <Form.Control
        type="text"
        value={httpOpts.timeoutHttpRequest ?? ''}
        placeholder="e.g. 60s"
        onChange={e => setHttpOpts({ timeoutHttpRequest: e.target.value || undefined })}
      />
    </Field>
    <Field label="timeout http-keep-alive" md={3}>
      <Form.Control
        type="text"
        value={httpOpts.timeoutHttpKeepAlive ?? ''}
        placeholder="e.g. 30s"
        onChange={e => setHttpOpts({ timeoutHttpKeepAlive: e.target.value || undefined })}
      />
    </Field>
    <Field label="timeout client-fin" md={3}>
      <Form.Control
        type="text"
        value={httpOpts.timeoutClientFin ?? ''}
        placeholder="e.g. 30s"
        onChange={e => setHttpOpts({ timeoutClientFin: e.target.value || undefined })}
      />
    </Field>

    <SectionHeading>Logging</SectionHeading>
    <SwitchField
      label="httplog"
      id="opt-httplog"
      checked={httpOpts.httpLog !== false}
      onChange={v => setHttpOpts({ httpLog: v })}
      md={3}
    />
    <SwitchField
      label="dontlognull"
      id="opt-dontlognull"
      checked={httpOpts.dontlogNull}
      onChange={v => setHttpOpts({ dontlogNull: v })}
      md={3}
    />
    <SwitchField
      label="dontlog-normal"
      id="opt-dontlog-normal"
      checked={httpOpts.dontlogNormal}
      onChange={v => setHttpOpts({ dontlogNormal: v })}
      md={3}
    />
    <SwitchField
      label="log-separate-errors"
      id="opt-log-sep"
      checked={httpOpts.logSeparateErrors}
      onChange={v => setHttpOpts({ logSeparateErrors: v })}
      md={3}
    />
    <Field label="log-tag" md={6}>
      <Form.Control
        type="text"
        value={httpOpts.logTag ?? ''}
        onChange={e => setHttpOpts({ logTag: e.target.value || undefined })}
      />
    </Field>
    <Field label="Custom log-format" md={12}>
      <Form.Control
        type="text"
        value={httpOpts.customLogFormat ?? ''}
        onChange={e => setHttpOpts({ customLogFormat: e.target.value || undefined })}
      />
    </Field>
  </Row>
);

HttpTimeoutsAndLoggingFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// option toggles (13 switches).
// =====================================================================

const HTTP_OPTION_TOGGLES = Object.freeze([
  { key: 'optionHttpKeepAlive', label: 'http-keep-alive (default: on)', defaultsTrue: true },
  { key: 'optionHttpServerClose', label: 'http-server-close' },
  { key: 'optionHttpTunnel', label: 'http-tunnel' },
  { key: 'optionHttpIgnoreProbes', label: 'http-ignore-probes' },
  { key: 'optionHttpBufferRequest', label: 'http-buffer-request' },
  { key: 'optionHttpProxy', label: 'http-proxy' },
  { key: 'optionHttpPretendKeepalive', label: 'http-pretend-keepalive' },
  { key: 'optionHttpNoDelay', label: 'http-no-delay' },
  { key: 'optionLogasap', label: 'logasap' },
  { key: 'optionContstats', label: 'contstats' },
  { key: 'optionCliTcpKa', label: 'clitcpka (client-side TCP keepalive)' },
  { key: 'optionSrvTcpKa', label: 'srvtcpka (server-side TCP keepalive)' },
]);

const HttpOptionTogglesFields = ({ httpOpts, setHttpOpts }) => (
  <Row className="g-2">
    <SectionHeading>option toggles</SectionHeading>
    {HTTP_OPTION_TOGGLES.map(t => {
      const current = httpOpts[t.key];
      const checked = t.defaultsTrue ? current !== false : Boolean(current);
      return (
        <SwitchField
          key={t.key}
          label={t.label}
          id={`opt-${t.key}`}
          checked={checked}
          onChange={v => setHttpOpts({ [t.key]: v })}
          md={4}
        />
      );
    })}
  </Row>
);

HttpOptionTogglesFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// Request-smuggling defense.
// =====================================================================

const HttpSmugglingDefenseFields = ({ httpOpts, setHttpOpts }) => (
  <Row className="g-2">
    <SectionHeading>Request-smuggling / path-traversal defense</SectionHeading>
    <Field
      label="option http-restrict-req-hdr-names"
      md={4}
      helpText="HAProxy 2.7+. `delete` recommended."
    >
      <Form.Select
        value={httpOpts.restrictReqHdrNames ?? ''}
        onChange={e => setHttpOpts({ restrictReqHdrNames: e.target.value || undefined })}
      >
        <option value="">(default — off)</option>
        <option value="preserve">preserve</option>
        <option value="delete">delete</option>
        <option value="reject">reject</option>
      </Form.Select>
    </Field>
    <Field
      label="http-request strict-mode"
      md={4}
      helpText="On = malformed → 400. Off = malformed → 503."
    >
      <Form.Select
        value={triStateBoolToString(httpOpts.strictMode)}
        onChange={e => setHttpOpts({ strictMode: triStateStringToBool(e.target.value) })}
      >
        <option value="">(default)</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </Form.Select>
    </Field>
    <Field
      label="http-request normalize-uri (args, one per line)"
      md={12}
      helpText="e.g. path-merge-slashes, dotdot-collapse, percent-decode-unreserved, fragment-encode"
    >
      <Form.Control
        as="textarea"
        rows={3}
        value={(httpOpts.normalizeUri ?? []).join('\n')}
        onChange={e =>
          setHttpOpts({
            normalizeUri: e.target.value
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean),
          })
        }
      />
    </Field>
  </Row>
);

HttpSmugglingDefenseFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// H2 tunables.
// =====================================================================

const H2_NUMERIC_FIELDS = Object.freeze([
  { key: 'maxConcurrentStreams', label: 'fe.max-concurrent-streams' },
  { key: 'maxHeaderListSize', label: 'header-list-size' },
  { key: 'initialWindowSize', label: 'fe.initial-window-size' },
  { key: 'maxRstAtOnce', label: 'fe.max-rst-at-once (rapid-reset defense)' },
  { key: 'glitchesThreshold', label: 'fe.glitches-threshold' },
  { key: 'maxTotalStreams', label: 'fe.max-total-streams' },
  { key: 'headerTableSize', label: 'header-table-size' },
  { key: 'maxFrameSize', label: 'max-frame-size' },
]);

const HttpH2TunablesFields = ({ httpOpts, setHttpOpts }) => {
  const h2 = httpOpts.h2 ?? {};
  const setH2 = patch => setHttpOpts({ h2: { ...h2, ...patch } });
  return (
    <Row className="g-2">
      <SectionHeading>
        H2 tunables (per-frontend; CVE-2023-44487 rapid-reset defense)
      </SectionHeading>
      {H2_NUMERIC_FIELDS.map(f => (
        <Field key={f.key} label={f.label} md={3}>
          <Form.Control
            type="number"
            min={1}
            value={h2[f.key] ?? ''}
            onChange={e => setH2({ [f.key]: parseIntOrUndef(e.target.value) })}
          />
        </Field>
      ))}
      <SwitchField
        label="tune.h2.log-errors"
        id="h2-log-errors"
        checked={h2.logErrors}
        onChange={v => setH2({ logErrors: v ? true : undefined })}
        md={4}
      />
    </Row>
  );
};

HttpH2TunablesFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
};

// =====================================================================
// HTTP errorfiles section.
// =====================================================================

const HttpErrorFilesFields = ({ httpOpts, setHttpOpts, sections }) => (
  <Row className="g-2">
    <SectionHeading>Error pages</SectionHeading>
    <Field
      label="errorfiles section (httpOpts-level)"
      md={12}
      helpText="Reference an `http-errors NAME` section. Define them on the Error pages tab."
    >
      <Form.Select
        value={httpOpts.useErrorFilesId ?? ''}
        onChange={e => setHttpOpts({ useErrorFilesId: e.target.value || null })}
        disabled={sections.length === 0}
      >
        <option value="">(none)</option>
        {sections.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.id})
          </option>
        ))}
      </Form.Select>
    </Field>
    <Col xs={12}>
      <strong className="small text-muted text-uppercase d-block mb-1">
        Per-status errorfile overrides
      </strong>
      <ErrorFilesEditor
        entries={httpOpts.errorFiles}
        onChange={list => setHttpOpts({ errorFiles: list })}
      />
    </Col>
  </Row>
);

HttpErrorFilesFields.propTypes = {
  httpOpts: PropTypes.object.isRequired,
  setHttpOpts: PropTypes.func.isRequired,
  sections: PropTypes.array.isRequired,
};

// =====================================================================
// Stats sub-section.
// =====================================================================

const HttpStatsFields = ({ stats, setStats }) => {
  const setF = patch => setStats({ ...stats, ...patch });
  return (
    <Row className="g-2">
      <SectionHeading>Stats sub-section (HAProxy native stats GUI)</SectionHeading>
      <SwitchField
        label="Stats enabled on this frontend"
        id="stats-enabled"
        checked={stats.enabled}
        onChange={v => setF({ enabled: v })}
        md={6}
      />
      {stats.enabled ? (
        <>
          <Field label="URI" md={3}>
            <Form.Control
              type="text"
              value={stats.uri ?? '/'}
              onChange={e => setF({ uri: e.target.value })}
            />
          </Field>
          <Field label="Realm" md={3}>
            <Form.Control
              type="text"
              value={stats.realm ?? 'HAProxy Statistics'}
              onChange={e => setF({ realm: e.target.value })}
            />
          </Field>
          <Field label="refresh (auto-reload, seconds)" md={3}>
            <Form.Control
              type="number"
              min={1}
              value={stats.refresh ?? ''}
              onChange={e => setF({ refresh: parseIntOrUndef(e.target.value) })}
            />
          </Field>
          <Field label="admin ACL expression" md={6}>
            <Form.Control
              type="text"
              value={stats.adminAclExpression ?? ''}
              placeholder="TRUE"
              onChange={e => setF({ adminAclExpression: e.target.value || null })}
            />
          </Field>
          <Field label="show-node" md={3}>
            <Form.Control
              type="text"
              value={stats.showNodename ?? ''}
              onChange={e => setF({ showNodename: e.target.value || undefined })}
            />
          </Field>
          <Field label="show-desc" md={9}>
            <Form.Control
              type="text"
              value={stats.showDescription ?? ''}
              onChange={e => setF({ showDescription: e.target.value || undefined })}
            />
          </Field>
          <SwitchField
            label="show-legends (default: on)"
            id="stats-legends"
            checked={stats.showLegends !== false}
            onChange={v => setF({ showLegends: v })}
            md={4}
          />
          <SwitchField
            label="show-modules"
            id="stats-modules"
            checked={stats.showModules}
            onChange={v => setF({ showModules: v })}
            md={4}
          />
          <SwitchField
            label="Prometheus exporter"
            id="stats-prom"
            checked={stats.prometheusExporter}
            onChange={v => setF({ prometheusExporter: v })}
            md={4}
          />
          <Field label="Prometheus path" md={4}>
            <Form.Control
              type="text"
              value={stats.prometheusPath ?? '/metrics'}
              disabled={!stats.prometheusExporter}
              onChange={e => setF({ prometheusPath: e.target.value })}
            />
          </Field>
          <SwitchField
            label="prometheus extra-counters"
            id="stats-extra"
            checked={stats.prometheusExtraCounters}
            onChange={v => setF({ prometheusExtraCounters: v })}
            md={4}
          />
          <Col xs={12}>
            <strong className="small text-muted text-uppercase d-block mb-1">
              Stats auth users
            </strong>
            <StatsAuthUsersEditor users={stats.auth} onChange={list => setF({ auth: list })} />
          </Col>
        </>
      ) : null}
    </Row>
  );
};

HttpStatsFields.propTypes = {
  stats: PropTypes.object.isRequired,
  setStats: PropTypes.func.isRequired,
};

// =====================================================================
// HTTP Options tab — composes everything.
// =====================================================================

const HttpOptionsTab = ({ draft, update, backends, sections }) => {
  const httpOpts = draft.httpOpts ?? {};
  const stats = draft.stats ?? {};
  const setHttpOpts = patch => update({ httpOpts: { ...httpOpts, ...patch } });
  const setStats = next => update({ stats: next });
  return (
    <div className="pt-3 d-flex flex-column gap-3">
      <HttpRoutingFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} backends={backends} />
      <hr className="my-0" />
      <HttpResponseFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpForwardForFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpOriginalToFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <div>
        <h6 className="text-muted text-uppercase small mb-2">Capture</h6>
        <HttpCaptureFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      </div>
      <hr className="my-0" />
      <HttpTimeoutsAndLoggingFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpOptionTogglesFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpSmugglingDefenseFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpH2TunablesFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} />
      <hr className="my-0" />
      <HttpErrorFilesFields httpOpts={httpOpts} setHttpOpts={setHttpOpts} sections={sections} />
      <hr className="my-0" />
      <HttpStatsFields stats={stats} setStats={setStats} />
    </div>
  );
};

HttpOptionsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
  sections: PropTypes.array.isRequired,
};

// =====================================================================
// SNI router map editor (TCP mode passthrough).
// =====================================================================

const SniMapEditor = ({ sniMap, onChange, backends }) => {
  const add = () =>
    onChange([...(sniMap ?? []), { sniPattern: '', backendId: '', _key: genKey() }]);
  const remove = idx => {
    const next = sniMap.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  return (
    <>
      {(sniMap ?? []).length === 0 ? (
        <p className="text-muted small mb-2">No SNI mappings.</p>
      ) : (
        <Table size="sm" bordered>
          <thead>
            <tr>
              <th>SNI pattern</th>
              <th>Backend</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sniMap.map((row, idx) => (
              <tr key={row._key}>
                <td>
                  <Form.Control
                    size="sm"
                    value={row.sniPattern}
                    onChange={e =>
                      onChange(updateAtIndex(sniMap, idx, { sniPattern: e.target.value }))
                    }
                  />
                </td>
                <td>
                  <Form.Select
                    size="sm"
                    value={row.backendId}
                    onChange={e =>
                      onChange(updateAtIndex(sniMap, idx, { backendId: e.target.value }))
                    }
                  >
                    <option value="">— choose —</option>
                    {backends.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.id})
                      </option>
                    ))}
                  </Form.Select>
                </td>
                <td className="text-end">
                  <Button variant="outline-danger" size="sm" onClick={() => remove(idx)}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Button variant="outline-primary" size="sm" onClick={add}>
        Add SNI mapping
      </Button>
    </>
  );
};

SniMapEditor.propTypes = {
  sniMap: PropTypes.array,
  onChange: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
};

// =====================================================================
// TCP Options tab.
// =====================================================================

const TcpBasicFields = ({ tcpOpts, setTcpOpts, backends }) => (
  <Row className="g-2">
    <Field label="Default backend" md={6}>
      <Form.Select
        value={tcpOpts.defaultBackendId ?? ''}
        onChange={e => setTcpOpts({ defaultBackendId: e.target.value || null })}
      >
        <option value="">(none)</option>
        {backends.map(b => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.id})
          </option>
        ))}
      </Form.Select>
    </Field>
    <SwitchField
      label="tcplog (default: on)"
      id="tcp-tcplog"
      checked={tcpOpts.tcpLog !== false}
      onChange={v => setTcpOpts({ tcpLog: v })}
      md={3}
    />
    <Field label="timeout client" md={3}>
      <Form.Control
        type="text"
        value={tcpOpts.timeoutClient ?? ''}
        placeholder="e.g. 1m"
        onChange={e => setTcpOpts({ timeoutClient: e.target.value || undefined })}
      />
    </Field>
    <Field label="tcp-request inspect-delay" md={3}>
      <Form.Control
        type="text"
        value={tcpOpts.inspectDelay ?? ''}
        placeholder="e.g. 5s"
        onChange={e => setTcpOpts({ inspectDelay: e.target.value || undefined })}
      />
    </Field>
  </Row>
);

TcpBasicFields.propTypes = {
  tcpOpts: PropTypes.object.isRequired,
  setTcpOpts: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
};

const TcpSniRouterFields = ({ tcpOpts, setTcpOpts, backends }) => {
  const sniRouter = tcpOpts.sniRouter ?? {};
  const setSniRouter = patch => setTcpOpts({ sniRouter: { ...sniRouter, ...patch } });
  return (
    <Row className="g-2">
      <SectionHeading>SNI passthrough router</SectionHeading>
      <SwitchField
        label="SNI router enabled"
        id="tcp-sni-enabled"
        checked={sniRouter.enabled}
        onChange={v => setSniRouter({ enabled: v })}
        md={4}
      />
      <Col xs={12}>
        <SniMapEditor
          sniMap={sniRouter.sniMap ?? []}
          onChange={list => setSniRouter({ sniMap: list })}
          backends={backends}
        />
      </Col>
    </Row>
  );
};

TcpSniRouterFields.propTypes = {
  tcpOpts: PropTypes.object.isRequired,
  setTcpOpts: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
};

const TcpTrackScFields = ({ tcpOpts, setTcpOpts }) => {
  const track = tcpOpts.trackSc0 ?? null;
  const enable = checked => {
    if (checked) {
      setTcpOpts({ trackSc0: track ?? { tableName: '', key: 'src' } });
    } else {
      setTcpOpts({ trackSc0: undefined });
    }
  };
  return (
    <Row className="g-2">
      <SectionHeading>track-sc0 (stick-table tracker)</SectionHeading>
      <SwitchField
        label="track-sc0 enabled"
        id="tcp-track-sc0"
        checked={Boolean(track)}
        onChange={enable}
        md={4}
      />
      {track ? (
        <>
          <Field label="key (sample expression)" md={4}>
            <Form.Control
              type="text"
              value={track.key ?? ''}
              placeholder="src"
              onChange={e => setTcpOpts({ trackSc0: { ...track, key: e.target.value } })}
            />
          </Field>
          <Field label="table name" md={4}>
            <Form.Control
              type="text"
              value={track.tableName ?? ''}
              onChange={e => setTcpOpts({ trackSc0: { ...track, tableName: e.target.value } })}
            />
          </Field>
        </>
      ) : null}
    </Row>
  );
};

TcpTrackScFields.propTypes = {
  tcpOpts: PropTypes.object.isRequired,
  setTcpOpts: PropTypes.func.isRequired,
};

const TcpOptionsTab = ({ draft, update, backends }) => {
  const tcpOpts = draft.tcpOpts ?? {};
  const setTcpOpts = patch => update({ tcpOpts: { ...tcpOpts, ...patch } });
  return (
    <div className="pt-3 d-flex flex-column gap-3">
      <TcpBasicFields tcpOpts={tcpOpts} setTcpOpts={setTcpOpts} backends={backends} />
      <hr className="my-0" />
      <TcpSniRouterFields tcpOpts={tcpOpts} setTcpOpts={setTcpOpts} backends={backends} />
      <hr className="my-0" />
      <TcpTrackScFields tcpOpts={tcpOpts} setTcpOpts={setTcpOpts} />
    </div>
  );
};

TcpOptionsTab.propTypes = {
  draft: PropTypes.object.isRequired,
  update: PropTypes.func.isRequired,
  backends: PropTypes.array.isRequired,
};

// =====================================================================
// Hydrator + serializer — manage the _key markers React needs for stable
// list rendering and the record↔array conversion for errorFiles.
// =====================================================================

const ensureArrayKeys = list =>
  (list ?? []).map(item => ({ ...item, _key: item._key ?? genKey() }));

const errorFilesRecordToArray = record =>
  Object.entries(record ?? {}).map(([code, path]) => ({ _key: genKey(), code, path }));

const errorFilesArrayToRecord = list => {
  const out = {};
  for (const entry of list ?? []) {
    if (entry.code && entry.path) {
      out[entry.code] = entry.path;
    }
  }
  return out;
};

const ensureFormKeys = fe => {
  if (!fe) {
    return fe;
  }
  const httpOpts = fe.httpOpts ?? {};
  const tcpOpts = fe.tcpOpts ?? {};
  const stats = fe.stats ?? {};
  return {
    ...fe,
    httpOpts: {
      ...httpOpts,
      captureRequestHeaders: ensureArrayKeys(httpOpts.captureRequestHeaders),
      captureResponseHeaders: ensureArrayKeys(httpOpts.captureResponseHeaders),
      errorFiles: Array.isArray(httpOpts.errorFiles)
        ? ensureArrayKeys(httpOpts.errorFiles)
        : errorFilesRecordToArray(httpOpts.errorFiles),
    },
    tcpOpts: {
      ...tcpOpts,
      sniRouter: {
        ...(tcpOpts.sniRouter ?? {}),
        sniMap: ensureArrayKeys(tcpOpts.sniRouter?.sniMap),
      },
    },
    stats: {
      ...stats,
      auth: ensureArrayKeys(stats.auth),
    },
  };
};

const stripArrayKeys = list => (list ?? []).map(stripInternalKeys);

const serializeForSave = draft => {
  const httpOpts = draft.httpOpts ?? {};
  const tcpOpts = draft.tcpOpts ?? {};
  const stats = draft.stats ?? {};
  return {
    ...draft,
    httpOpts: {
      ...httpOpts,
      captureRequestHeaders: stripArrayKeys(httpOpts.captureRequestHeaders),
      captureResponseHeaders: stripArrayKeys(httpOpts.captureResponseHeaders),
      errorFiles: Array.isArray(httpOpts.errorFiles)
        ? errorFilesArrayToRecord(httpOpts.errorFiles)
        : (httpOpts.errorFiles ?? {}),
    },
    tcpOpts: {
      ...tcpOpts,
      sniRouter: tcpOpts.sniRouter
        ? {
            ...tcpOpts.sniRouter,
            sniMap: stripArrayKeys(tcpOpts.sniRouter.sniMap),
          }
        : tcpOpts.sniRouter,
    },
    stats: {
      ...stats,
      auth: stripArrayKeys(stats.auth),
    },
  };
};

const emptyFrontend = () => ({
  id: '',
  name: '',
  enabled: true,
  mode: 'http',
  binds: [{ id: `b${genKey()}`, address: '', ssl: { enabled: false }, quic: {} }],
  fromDefaults: '',
  httpOpts: {},
  tcpOpts: {},
  stats: {},
  rulePhases: {},
});

// =====================================================================
// Top-level modal.
// =====================================================================

export const FrontendEditModal = ({ show, frontend = null, doc, onSave, onCancel }) => {
  const [draft, setDraft] = useState(() => ensureFormKeys(frontend ?? emptyFrontend()));
  const [error, setError] = useState(null);

  const isExisting = Boolean(frontend?.id) && (doc.frontends ?? []).some(f => f.id === frontend.id);

  const update = patch => {
    setError(null);
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    const message = validateFrontend(draft);
    if (message) {
      setError(message);
      return;
    }
    onSave(serializeForSave(draft));
  };

  const backends = doc.backends ?? [];
  const sections = doc.httpErrorsSections ?? [];

  return (
    <Modal show={show} onHide={onCancel} size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>{isExisting ? `Edit frontend: ${frontend.name}` : 'New frontend'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? <Alert variant="danger">{error}</Alert> : null}
        <Tabs defaultActiveKey="basics" id="fe-edit-tabs" className="mb-1">
          <Tab eventKey="basics" title="Basics">
            <BasicsTab draft={draft} update={update} isExisting={isExisting} doc={doc} />
          </Tab>
          <Tab eventKey="binds" title="Binds">
            <BindsTab
              draft={draft}
              update={update}
              trustedCas={doc.trustedCas ?? []}
              trustedCrls={doc.trustedCrls ?? []}
              floatingIps={doc.keepalived?.instances ?? []}
              savedAddresses={doc.ui?.savedBindAddresses ?? []}
            />
          </Tab>
          <Tab eventKey="options" title="Options">
            {draft.mode === 'tcp' ? (
              <TcpOptionsTab draft={draft} update={update} backends={backends} />
            ) : (
              <HttpOptionsTab
                draft={draft}
                update={update}
                backends={backends}
                sections={sections}
              />
            )}
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {isExisting ? 'Update frontend' : 'Add frontend'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

FrontendEditModal.propTypes = {
  show: PropTypes.bool.isRequired,
  frontend: PropTypes.object,
  doc: PropTypes.object.isRequired,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
