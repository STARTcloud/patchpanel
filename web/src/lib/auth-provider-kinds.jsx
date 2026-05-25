import PropTypes from 'prop-types';
import { Alert, Button, Col, Form, Table } from 'react-bootstrap';

import { ListEditor } from '../components/ListEditor.jsx';
import { stripInternal } from '../utils/entity-naming.js';
import { genKey } from '../utils/keys.js';
import { CIDR_REGEX, LUA_FN_REGEX, TENANT_ID_REGEX } from '../utils/regexes.js';

import { buildKindRegistry } from './provider-kind-registry.jsx';

// v0.2.39 — Auth provider kinds registry. One entry per discriminated-union
// arm of `AuthProviderSchema`. Adding a new auth kind is a single entry
// here + the matching zod schema arm + the rendering hook in render.js.

const AuthRequestBackendIdSelector = ({ value, onChange, doc, label, helpText }) => {
  const backends = doc?.backends ?? [];
  return (
    <Col md={6}>
      <Form.Group>
        <Form.Label>{label}</Form.Label>
        <Form.Select value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">— choose —</option>
          {backends.map(b => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.id})
            </option>
          ))}
        </Form.Select>
        <Form.Text className="text-muted">
          {helpText ?? (
            <>
              Reference to a Backend entity on the Backends tab. The lua auth-intercept directive
              probes the first server of that backend on the configured auth-lookup path.
            </>
          )}
          {backends.length === 0 ? (
            <>
              {' '}
              <strong>No backends defined yet.</strong> Create one on the Backends tab first.
            </>
          ) : null}
        </Form.Text>
      </Form.Group>
    </Col>
  );
};

AuthRequestBackendIdSelector.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
  label: PropTypes.string.isRequired,
  helpText: PropTypes.node,
};

// ---- Authelia (existing) ----

const AutheliaForm = ({ config, onChange, doc }) => {
  const flavor = config.endpointFlavor ?? 'forward-auth';
  const onFlavorChange = nextFlavor => {
    const isLegacy = nextFlavor === 'legacy';
    const defaultPath = isLegacy ? '/api/verify' : '/api/authz/forward-auth';
    const currentPath = config.apiVerifyPath;
    const looksLikeDefault =
      currentPath === '/api/verify' || currentPath === '/api/authz/forward-auth';
    onChange({
      ...config,
      endpointFlavor: nextFlavor,
      apiVerifyPath: looksLikeDefault ? defaultPath : currentPath,
    });
  };
  return (
    <>
      <Col md={6}>
        <Form.Group>
          <Form.Label>Authelia version</Form.Label>
          <Form.Select value={flavor} onChange={e => onFlavorChange(e.target.value)}>
            <option value="forward-auth">4.38+ (/api/authz/forward-auth)</option>
            <option value="legacy">≤ 4.37 (/api/verify)</option>
          </Form.Select>
          <Form.Text className="text-muted">
            Drives which headers HAProxy sets before the auth probe. Modern emits the{' '}
            <code>X-Forwarded-*</code> set; legacy emits a single <code>X-Original-URL</code>.
          </Form.Text>
        </Form.Group>
      </Col>
      <AuthRequestBackendIdSelector
        value={config.authRequestBackendId}
        onChange={v => onChange({ ...config, authRequestBackendId: v })}
        doc={doc}
        label="Auth-lookup Backend"
        helpText={
          <>
            Backend the lua auth-intercept probes for the Authelia authz endpoint. Browser portal
            traffic to the Authelia UI is a separate concern — add a use-backend Rule on https-in to
            route the portal host to a (possibly same) backend.
          </>
        }
      />
      <Col md={6}>
        <Form.Group>
          <Form.Label>Authz endpoint path</Form.Label>
          <Form.Control
            type="text"
            value={config.apiVerifyPath ?? '/api/authz/forward-auth'}
            onChange={e => onChange({ ...config, apiVerifyPath: e.target.value })}
          />
          <Form.Text className="text-muted">
            Auto-filled from the version selector; override only if your Authelia is reverse-mounted
            at a non-default path.
          </Form.Text>
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>Redirect URL template</Form.Label>
          <Form.Control
            type="text"
            value={config.redirectUrlTemplate ?? ''}
            onChange={e => onChange({ ...config, redirectUrlTemplate: e.target.value })}
            placeholder="https://auth.example.com/?rd=%[var(req.scheme)]://%[base]%[var(req.questionmark)]%[query]&rm=%[method]"
          />
          <Form.Text className="text-muted">
            Where browsers get redirected when auth fails. Use HAProxy log-format variables like{' '}
            <code>%[var(req.scheme)]</code> and <code>%[base]</code>. The hostname here must match a
            host ACL you&apos;ve set up to route to the Authelia portal backend. The{' '}
            <code>&amp;rm=%[method]</code> tail is required for 4.38+ so Authelia can replay the
            original HTTP method after sign-in.
          </Form.Text>
        </Form.Group>
      </Col>
      <Col xs={12}>
        <Form.Group>
          <Form.Label>Propagate headers</Form.Label>
          <ListEditor
            items={config.propagateHeaders ?? []}
            onChange={list => onChange({ ...config, propagateHeaders: list })}
            placeholder="lowercase header name (e.g. remote-user)"
          />
          <Form.Text className="text-muted">
            On 2xx, the lua plugin copies these headers from Authelia onto the upstream request.
          </Form.Text>
        </Form.Group>
      </Col>
    </>
  );
};

AutheliaForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
};

const validateAuthelia = config => {
  if (!config.authRequestBackendId?.trim()) {
    return 'authRequestBackendId is required — pick a Backend';
  }
  if (!config.redirectUrlTemplate?.trim()) {
    return 'redirectUrlTemplate is required';
  }
  if (!config.apiVerifyPath?.trim()) {
    return 'apiVerifyPath is required';
  }
  return null;
};

// ---- Basic auth (existing) ----

const newUser = () => ({ _key: genKey(), username: '', passwordHashRef: '' });

const BasicUserRow = ({ user, onChange, onRemove, canRemove }) => (
  <tr>
    <td>
      <Form.Control
        size="sm"
        value={user.username}
        onChange={e => onChange({ ...user, username: e.target.value })}
      />
    </td>
    <td>
      <Form.Control
        size="sm"
        value={user.passwordHashRef}
        placeholder="/data/credentials/basic-auth/alice.hash"
        onChange={e => onChange({ ...user, passwordHashRef: e.target.value })}
      />
    </td>
    <td>
      <Button
        variant="outline-danger"
        size="sm"
        type="button"
        disabled={!canRemove}
        onClick={onRemove}
      >
        ×
      </Button>
    </td>
  </tr>
);

BasicUserRow.propTypes = {
  user: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  canRemove: PropTypes.bool.isRequired,
};

const BasicUsersTable = ({ users, onChange }) => {
  const updateRow = (key, next) =>
    onChange(users.map(u => (u._key === key ? { ...next, _key: key } : u)));
  const removeRow = key => onChange(users.filter(u => u._key !== key));
  const addRow = () => onChange([...users, newUser()]);

  return (
    <>
      <Table size="sm" bordered responsive>
        <thead>
          <tr>
            <th>Username</th>
            <th>passwordHashRef (path to hash file)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <BasicUserRow
              key={user._key}
              user={user}
              onChange={next => updateRow(user._key, next)}
              onRemove={() => removeRow(user._key)}
              canRemove={users.length > 1}
            />
          ))}
        </tbody>
      </Table>
      <Button variant="outline-primary" size="sm" type="button" onClick={addRow}>
        Add user
      </Button>
    </>
  );
};

BasicUsersTable.propTypes = {
  users: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
};

const BasicForm = ({ config, onChange }) => (
  <>
    <Col md={6}>
      <Form.Group>
        <Form.Label>realm</Form.Label>
        <Form.Control
          type="text"
          value={config.realm ?? 'Restricted'}
          onChange={e => onChange({ ...config, realm: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Label>Users</Form.Label>
      <BasicUsersTable
        users={config.users ?? []}
        onChange={users => onChange({ ...config, users })}
      />
    </Col>
  </>
);

BasicForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const validateBasic = config => {
  if (!config.realm?.trim()) {
    return 'realm is required';
  }
  if (!config.users || config.users.length === 0) {
    return 'at least one user is required for basic auth';
  }
  for (const u of config.users) {
    if (!u.username?.trim() || !u.passwordHashRef?.trim()) {
      return 'every basic-auth user needs a username and passwordHashRef';
    }
  }
  return null;
};

// ---- OIDC (existing) ----

const OidcForm = ({ config, onChange }) => (
  <>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>issuer</Form.Label>
        <Form.Control
          type="url"
          value={config.issuer ?? ''}
          onChange={e => onChange({ ...config, issuer: e.target.value })}
          placeholder="https://auth.example.com/realms/main"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>clientId</Form.Label>
        <Form.Control
          type="text"
          value={config.clientId ?? ''}
          onChange={e => onChange({ ...config, clientId: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>clientSecretRef</Form.Label>
        <Form.Control
          type="text"
          value={config.clientSecretRef ?? ''}
          placeholder="/data/credentials/oidc/main.secret"
          onChange={e => onChange({ ...config, clientSecretRef: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>scopes</Form.Label>
        <ListEditor
          items={config.scopes ?? []}
          onChange={scopes => onChange({ ...config, scopes })}
          placeholder="e.g. openid"
        />
      </Form.Group>
    </Col>
  </>
);

OidcForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const validateOidc = config => {
  if (!URL.canParse(config.issuer ?? '')) {
    return 'issuer must be a valid URL';
  }
  if (!config.clientId?.trim()) {
    return 'clientId is required';
  }
  if (!config.clientSecretRef?.trim()) {
    return 'clientSecretRef is required';
  }
  return null;
};

// ---- LDAP (new in v0.2.39) ----

const LdapForm = ({ config, onChange, doc }) => (
  <>
    <Col md={6}>
      <Form.Group>
        <Form.Label>LDAP URL</Form.Label>
        <Form.Control
          type="text"
          value={config.url ?? ''}
          onChange={e => onChange({ ...config, url: e.target.value })}
          placeholder="ldaps://ldap.example.com:636"
        />
        <Form.Text className="text-muted">Use ldaps:// for TLS-wrapped LDAP.</Form.Text>
      </Form.Group>
    </Col>
    <AuthRequestBackendIdSelector
      value={config.authRequestBackendId}
      onChange={v => onChange({ ...config, authRequestBackendId: v })}
      doc={doc}
      label="LDAP-auth sidecar Backend"
      helpText={
        <>
          Backend pointing at your LDAP-auth proxy (e.g. nginx-ldap-auth, lldap-proxy). Define it on
          the Backends tab.
        </>
      }
    />
    <Col md={6}>
      <Form.Group>
        <Form.Label>bindDn</Form.Label>
        <Form.Control
          type="text"
          value={config.bindDn ?? ''}
          onChange={e => onChange({ ...config, bindDn: e.target.value })}
          placeholder="cn=svc-haproxy,ou=Service Accounts,dc=example,dc=com"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>bindPasswordRef</Form.Label>
        <Form.Control
          type="text"
          value={config.bindPasswordRef ?? ''}
          onChange={e => onChange({ ...config, bindPasswordRef: e.target.value })}
          placeholder="/data/credentials/ldap/bind.pass"
        />
        <Form.Text className="text-muted">Mode 600 file holding the bind password.</Form.Text>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>userSearchBase</Form.Label>
        <Form.Control
          type="text"
          value={config.userSearchBase ?? ''}
          onChange={e => onChange({ ...config, userSearchBase: e.target.value })}
          placeholder="ou=Users,dc=example,dc=com"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>userSearchFilter</Form.Label>
        <Form.Control
          type="text"
          value={config.userSearchFilter ?? '(uid={username})'}
          onChange={e => onChange({ ...config, userSearchFilter: e.target.value })}
        />
        <Form.Text className="text-muted">
          Use <code>{'{username}'}</code> as the placeholder.
        </Form.Text>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>TLS verify</Form.Label>
        <Form.Select
          value={config.tlsVerify ?? 'required'}
          onChange={e => onChange({ ...config, tlsVerify: e.target.value })}
        >
          <option value="required">required</option>
          <option value="none">none (insecure)</option>
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>authRequestPath</Form.Label>
        <Form.Control
          type="text"
          value={config.authRequestPath ?? '/auth'}
          onChange={e => onChange({ ...config, authRequestPath: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>Propagate headers</Form.Label>
        <ListEditor
          items={config.propagateHeaders ?? []}
          onChange={list => onChange({ ...config, propagateHeaders: list })}
          placeholder="lowercase header name (e.g. remote-user)"
        />
      </Form.Group>
    </Col>
  </>
);

LdapForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
};

const validateLdap = config => {
  if (!URL.canParse(config.url ?? '')) {
    return 'LDAP url must be a valid URL (ldap:// or ldaps://)';
  }
  if (!config.authRequestBackendId?.trim()) {
    return 'authRequestBackendId is required — pick a Backend';
  }
  if (!config.bindDn?.trim()) {
    return 'bindDn is required';
  }
  if (!config.bindPasswordRef?.trim()) {
    return 'bindPasswordRef is required';
  }
  if (!config.userSearchBase?.trim()) {
    return 'userSearchBase is required';
  }
  return null;
};

// ---- SAML (new in v0.2.39) ----

const SamlForm = ({ config, onChange, doc }) => (
  <>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>idpMetadataUrl</Form.Label>
        <Form.Control
          type="url"
          value={config.idpMetadataUrl ?? ''}
          onChange={e => onChange({ ...config, idpMetadataUrl: e.target.value })}
          placeholder="https://idp.example.com/metadata.xml"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>spEntityId</Form.Label>
        <Form.Control
          type="text"
          value={config.spEntityId ?? ''}
          onChange={e => onChange({ ...config, spEntityId: e.target.value })}
          placeholder="https://patchpanel.example.com/saml"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>acsUrl</Form.Label>
        <Form.Control
          type="url"
          value={config.acsUrl ?? ''}
          onChange={e => onChange({ ...config, acsUrl: e.target.value })}
          placeholder="https://saml.example.com/acs"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>signingKeyRef</Form.Label>
        <Form.Control
          type="text"
          value={config.signingKeyRef ?? ''}
          onChange={e => onChange({ ...config, signingKeyRef: e.target.value || undefined })}
          placeholder="/data/credentials/saml/sp.key (optional)"
        />
      </Form.Group>
    </Col>
    <AuthRequestBackendIdSelector
      value={config.authRequestBackendId}
      onChange={v => onChange({ ...config, authRequestBackendId: v })}
      doc={doc}
      label="SAML SP sidecar Backend"
      helpText={
        <>
          Backend pointing at your SAML SP sidecar (e.g. saml2aws-proxy, mod_auth_mellon proxy).
          Define it on the Backends tab.
        </>
      }
    />
    <Col md={6}>
      <Form.Group>
        <Form.Label>authRequestPath</Form.Label>
        <Form.Control
          type="text"
          value={config.authRequestPath ?? '/saml/auth'}
          onChange={e => onChange({ ...config, authRequestPath: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>Propagate headers</Form.Label>
        <ListEditor
          items={config.propagateHeaders ?? []}
          onChange={list => onChange({ ...config, propagateHeaders: list })}
          placeholder="lowercase header name (e.g. remote-user)"
        />
      </Form.Group>
    </Col>
  </>
);

SamlForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
};

const validateSaml = config => {
  if (!URL.canParse(config.idpMetadataUrl ?? '')) {
    return 'idpMetadataUrl must be a valid URL';
  }
  if (!URL.canParse(config.acsUrl ?? '')) {
    return 'acsUrl must be a valid URL';
  }
  if (!config.spEntityId?.trim()) {
    return 'spEntityId is required';
  }
  if (!config.authRequestBackendId?.trim()) {
    return 'authRequestBackendId is required — pick a Backend';
  }
  return null;
};

// ---- Microsoft Entra (new in v0.2.39) ----

const EntraForm = ({ config, onChange, doc }) => (
  <>
    <Col xs={12}>
      <Alert variant="info" className="small mb-0">
        Microsoft Entra (Azure AD) preset. The OIDC issuer is auto-derived from the tenant id as
        <code> https://login.microsoftonline.com/&lt;tenantId&gt;/v2.0</code> in the rendered cfg.
      </Alert>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>tenantId</Form.Label>
        <Form.Control
          type="text"
          value={config.tenantId ?? ''}
          onChange={e => onChange({ ...config, tenantId: e.target.value })}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>clientId</Form.Label>
        <Form.Control
          type="text"
          value={config.clientId ?? ''}
          onChange={e => onChange({ ...config, clientId: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>clientSecretRef</Form.Label>
        <Form.Control
          type="text"
          value={config.clientSecretRef ?? ''}
          placeholder="/data/credentials/entra/client.secret"
          onChange={e => onChange({ ...config, clientSecretRef: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>redirectUri</Form.Label>
        <Form.Control
          type="url"
          value={config.redirectUri ?? ''}
          onChange={e => onChange({ ...config, redirectUri: e.target.value })}
          placeholder="https://patchpanel.example.com/oauth2/callback"
        />
      </Form.Group>
    </Col>
    <AuthRequestBackendIdSelector
      value={config.authRequestBackendId}
      onChange={v => onChange({ ...config, authRequestBackendId: v })}
      doc={doc}
      label="OIDC proxy Backend"
      helpText={
        <>
          Backend pointing at your OIDC proxy sidecar (e.g. oauth2-proxy with Entra provider).
          Define it on the Backends tab.
        </>
      }
    />
    <Col md={6}>
      <Form.Group>
        <Form.Label>authRequestPath</Form.Label>
        <Form.Control
          type="text"
          value={config.authRequestPath ?? '/auth'}
          onChange={e => onChange({ ...config, authRequestPath: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>scopes</Form.Label>
        <ListEditor
          items={config.scopes ?? []}
          onChange={scopes => onChange({ ...config, scopes })}
          placeholder="e.g. openid"
        />
      </Form.Group>
    </Col>
  </>
);

EntraForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
};

const validateEntra = config => {
  if (!TENANT_ID_REGEX.test(config.tenantId ?? '')) {
    return 'tenantId must be a valid identifier (letters/digits/-)';
  }
  if (!config.clientId?.trim()) {
    return 'clientId is required';
  }
  if (!config.clientSecretRef?.trim()) {
    return 'clientSecretRef is required';
  }
  if (!URL.canParse(config.redirectUri ?? '')) {
    return 'redirectUri must be a valid URL';
  }
  if (!config.authRequestBackendId?.trim()) {
    return 'authRequestBackendId is required — pick a Backend';
  }
  return null;
};

// ---- JWT verify (new in v0.2.39) ----

const JwtVerifyForm = ({ config, onChange, doc }) => (
  <>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>jwksUrl</Form.Label>
        <Form.Control
          type="url"
          value={config.jwksUrl ?? ''}
          onChange={e => onChange({ ...config, jwksUrl: e.target.value })}
          placeholder="https://idp.example.com/.well-known/jwks.json"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>expectedAudience</Form.Label>
        <Form.Control
          type="text"
          value={config.expectedAudience ?? ''}
          onChange={e => onChange({ ...config, expectedAudience: e.target.value || undefined })}
          placeholder="optional"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>expectedIssuer</Form.Label>
        <Form.Control
          type="text"
          value={config.expectedIssuer ?? ''}
          onChange={e => onChange({ ...config, expectedIssuer: e.target.value || undefined })}
          placeholder="optional"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>headerName</Form.Label>
        <Form.Control
          type="text"
          value={config.headerName ?? 'Authorization'}
          onChange={e => onChange({ ...config, headerName: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>headerPrefix</Form.Label>
        <Form.Control
          type="text"
          value={config.headerPrefix ?? 'Bearer '}
          onChange={e => onChange({ ...config, headerPrefix: e.target.value })}
        />
      </Form.Group>
    </Col>
    <AuthRequestBackendIdSelector
      value={config.authRequestBackendId}
      onChange={v => onChange({ ...config, authRequestBackendId: v })}
      doc={doc}
      label="JWT-verify sidecar Backend"
      helpText={
        <>
          Backend pointing at your JWT-verify sidecar service (validates token signature against the
          JWKS). Define it on the Backends tab.
        </>
      }
    />
    <Col md={6}>
      <Form.Group>
        <Form.Label>authRequestPath</Form.Label>
        <Form.Control
          type="text"
          value={config.authRequestPath ?? '/verify'}
          onChange={e => onChange({ ...config, authRequestPath: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>Propagate headers</Form.Label>
        <ListEditor
          items={config.propagateHeaders ?? []}
          onChange={list => onChange({ ...config, propagateHeaders: list })}
          placeholder="lowercase header name"
        />
      </Form.Group>
    </Col>
  </>
);

JwtVerifyForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  doc: PropTypes.object,
};

const validateJwtVerify = config => {
  if (!URL.canParse(config.jwksUrl ?? '')) {
    return 'jwksUrl must be a valid URL';
  }
  if (!config.authRequestBackendId?.trim()) {
    return 'authRequestBackendId is required — pick a Backend';
  }
  return null;
};

// ---- mTLS-auth (new in v0.2.39) ----

const MtlsAuthForm = ({ config, onChange }) => (
  <>
    <Col xs={12}>
      <Alert variant="info" className="small mb-0">
        Uses the client cert validated by an upstream mTLS frontend (configure that on the{' '}
        <strong>Frontends</strong> tab under Additional frontends with <code>kind: mtls</code>).
        HAProxy denies requests without a presented cert, then sets a header on the upstream request
        so backends can identify the user.
      </Alert>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>trustedAttribute</Form.Label>
        <Form.Select
          value={config.trustedAttribute ?? 'cn'}
          onChange={e => onChange({ ...config, trustedAttribute: e.target.value })}
        >
          <option value="cn">cn (Common Name)</option>
          <option value="san">san (Subject Alt Name)</option>
          <option value="serial">serial (Cert serial number)</option>
        </Form.Select>
      </Form.Group>
    </Col>
    <Col md={4}>
      <Form.Group>
        <Form.Label>userHeaderName</Form.Label>
        <Form.Control
          type="text"
          value={config.userHeaderName ?? 'X-Client-CN'}
          onChange={e => onChange({ ...config, userHeaderName: e.target.value })}
        />
      </Form.Group>
    </Col>
    <Col md={4} className="d-flex align-items-end">
      <Form.Check
        type="switch"
        id="mtls-auth-require-present"
        label="Require cert presence"
        checked={config.requirePresent ?? true}
        onChange={e => onChange({ ...config, requirePresent: e.target.checked })}
      />
    </Col>
  </>
);

MtlsAuthForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

// ---- Header-trust (new in v0.2.39) ----

const HeaderTrustForm = ({ config, onChange }) => (
  <>
    <Col xs={12}>
      <Alert variant="info" className="small mb-0">
        For upstream auth proxies (Cloudflare Access, AWS ALB, Tailscale Funnel, oauth2-proxy)
        already authenticating the user. HAProxy verifies the request comes from a trusted source
        CIDR, then trusts the named header. Optionally strips the header from untrusted sources.
      </Alert>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>headerName</Form.Label>
        <Form.Control
          type="text"
          value={config.headerName ?? ''}
          onChange={e => onChange({ ...config, headerName: e.target.value })}
          placeholder="Cf-Access-Authenticated-User-Email"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>userHeaderName (optional rename)</Form.Label>
        <Form.Control
          type="text"
          value={config.userHeaderName ?? ''}
          onChange={e => onChange({ ...config, userHeaderName: e.target.value || undefined })}
          placeholder="X-Remote-User (rename upstream)"
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>trustedSourceCidrs</Form.Label>
        <ListEditor
          items={config.trustedSourceCidrs ?? []}
          onChange={list => onChange({ ...config, trustedSourceCidrs: list })}
          placeholder="e.g. 103.21.244.0/22"
          validate={value => (CIDR_REGEX.test(value) ? true : 'expected CIDR notation')}
        />
        <Form.Text className="text-muted">
          CIDR ranges of the upstream proxy. Cloudflare publishes their ranges at{' '}
          <code>cloudflare.com/ips/</code>.
        </Form.Text>
      </Form.Group>
    </Col>
    <Col md={6} className="d-flex align-items-end">
      <Form.Check
        type="switch"
        id="header-trust-strip"
        label="Strip header from untrusted sources (recommended)"
        checked={config.stripFromUntrusted ?? true}
        onChange={e => onChange({ ...config, stripFromUntrusted: e.target.checked })}
      />
    </Col>
  </>
);

HeaderTrustForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const validateHeaderTrust = config => {
  if (!config.headerName?.trim()) {
    return 'headerName is required';
  }
  if (!config.trustedSourceCidrs || config.trustedSourceCidrs.length === 0) {
    return 'at least one trustedSourceCidrs entry is required';
  }
  return null;
};

// ---- Lua-auth (new in v0.2.39) ----

const LuaAuthForm = ({ config, onChange }) => (
  <>
    <Col xs={12}>
      <Alert variant="warning" className="small mb-0">
        Raw escape hatch for bespoke auth requirements. patchpanel adds your Lua script to the
        global <code>lua-load</code> list and emits{' '}
        <code>http-request lua.&lt;functionName&gt; [args] if &lt;protected-acl&gt;</code> per
        protected route. You&apos;re responsible for the script&apos;s correctness.
      </Alert>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>pluginPath</Form.Label>
        <Form.Control
          type="text"
          value={config.pluginPath ?? ''}
          onChange={e => onChange({ ...config, pluginPath: e.target.value })}
          placeholder="/etc/haproxy/lua/my-auth.lua"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>prependPath (optional)</Form.Label>
        <Form.Control
          type="text"
          value={config.prependPath ?? ''}
          onChange={e => onChange({ ...config, prependPath: e.target.value || undefined })}
          placeholder="/etc/haproxy"
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>functionName</Form.Label>
        <Form.Control
          type="text"
          value={config.functionName ?? ''}
          onChange={e => onChange({ ...config, functionName: e.target.value })}
          placeholder="my_auth_check"
        />
      </Form.Group>
    </Col>
    <Col xs={12}>
      <Form.Group>
        <Form.Label>args (passed positionally to the Lua action)</Form.Label>
        <ListEditor
          items={config.args ?? []}
          onChange={list => onChange({ ...config, args: list })}
          placeholder="positional argument"
        />
      </Form.Group>
    </Col>
  </>
);

LuaAuthForm.propTypes = {
  config: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const validateLuaAuth = config => {
  if (!config.pluginPath?.trim()) {
    return 'pluginPath is required';
  }
  if (!LUA_FN_REGEX.test(config.functionName ?? '')) {
    return 'functionName must be a valid Lua identifier (letters/digits/_, start with letter or _)';
  }
  return null;
};

// ---- Helpers used by the modal for `basic` user-row internal keys ----

const withBasicInternalKeys = provider => {
  if (provider.type !== 'basic') {
    return provider;
  }
  return {
    ...provider,
    config: {
      ...provider.config,
      users: (provider.config?.users ?? []).map(u => ({ ...u, _key: u._key ?? genKey() })),
    },
  };
};

const stripBasicInternalKeys = provider => {
  if (provider.type !== 'basic') {
    return provider;
  }
  return {
    ...provider,
    config: {
      ...provider.config,
      users: (provider.config.users ?? []).map(stripInternal),
    },
  };
};

// ---- Registry ----

const summariseAuthelia = p =>
  `authelia (${p.config.endpointFlavor ?? 'forward-auth'}) → backend ${p.config.authRequestBackendId ?? '?'}`;
const summariseBasic = p => `${p.config.users?.length ?? 0} user(s), realm "${p.config.realm}"`;
const summariseOidc = p => p.config.issuer;
const summariseLdap = p => `${p.config.url} → backend ${p.config.authRequestBackendId ?? '?'}`;
const summariseSaml = p =>
  `${p.config.idpMetadataUrl} → backend ${p.config.authRequestBackendId ?? '?'}`;
const summariseEntra = p =>
  `tenant ${p.config.tenantId} → backend ${p.config.authRequestBackendId ?? '?'}`;
const summariseJwtVerify = p =>
  `JWKS ${p.config.jwksUrl} → backend ${p.config.authRequestBackendId ?? '?'}`;
const summariseMtls = p =>
  `attr=${p.config.trustedAttribute ?? 'cn'} → header ${p.config.userHeaderName ?? 'X-Client-CN'}`;
const summariseHeaderTrust = p =>
  `header ${p.config.headerName} trusted from ${p.config.trustedSourceCidrs?.length ?? 0} CIDR(s)`;
const summariseLuaAuth = p => `${p.config.pluginPath} → lua.${p.config.functionName}`;

const AUTH_KINDS = Object.freeze([
  {
    value: 'none',
    label: 'none (passthrough)',
    emptyConfig: () => ({}),
    ConfigForm: () => (
      <Col xs={12}>
        <Alert variant="info" className="mb-0">
          <code>none</code> providers have no config. Routes that reference this provider will not
          be auth-gated.
        </Alert>
      </Col>
    ),
    validate: () => null,
    summary: () => '(no-op)',
  },
  {
    value: 'authelia',
    label: 'authelia (auth-request)',
    emptyConfig: () => ({
      endpointFlavor: 'forward-auth',
      authRequestBackendId: '',
      redirectUrlTemplate:
        'https://[PORTAL]/?rd=%[var(req.scheme)]://%[base]%[var(req.questionmark)]%[query]&rm=%[method]',
      apiVerifyPath: '/api/authz/forward-auth',
      propagateHeaders: ['remote-user', 'remote-groups', 'remote-name', 'remote-email'],
    }),
    ConfigForm: AutheliaForm,
    validate: draft => validateAuthelia(draft.config ?? {}),
    summary: summariseAuthelia,
  },
  {
    value: 'basic',
    label: 'basic (HTTP basic auth)',
    emptyConfig: () => ({ realm: 'Restricted', users: [newUser()] }),
    ConfigForm: BasicForm,
    validate: draft => validateBasic(draft.config ?? {}),
    summary: summariseBasic,
  },
  {
    value: 'oidc',
    label: 'oidc (OpenID Connect)',
    emptyConfig: () => ({
      issuer: '',
      clientId: '',
      clientSecretRef: '',
      scopes: ['openid', 'profile', 'email'],
    }),
    ConfigForm: OidcForm,
    validate: draft => validateOidc(draft.config ?? {}),
    summary: summariseOidc,
  },
  {
    value: 'ldap',
    label: 'LDAP (via sidecar proxy)',
    emptyConfig: () => ({
      url: '',
      bindDn: '',
      bindPasswordRef: '',
      userSearchBase: '',
      userSearchFilter: '(uid={username})',
      tlsVerify: 'required',
      authRequestBackendId: '',
      authRequestPath: '/auth',
      propagateHeaders: ['remote-user', 'remote-groups'],
    }),
    ConfigForm: LdapForm,
    validate: draft => validateLdap(draft.config ?? {}),
    summary: summariseLdap,
  },
  {
    value: 'saml',
    label: 'SAML 2.0 (via SP sidecar)',
    emptyConfig: () => ({
      idpMetadataUrl: '',
      spEntityId: '',
      acsUrl: '',
      authRequestBackendId: '',
      authRequestPath: '/saml/auth',
      propagateHeaders: ['remote-user', 'remote-groups'],
    }),
    ConfigForm: SamlForm,
    validate: draft => validateSaml(draft.config ?? {}),
    summary: summariseSaml,
  },
  {
    value: 'entra',
    label: 'Microsoft Entra (Azure AD)',
    emptyConfig: () => ({
      tenantId: '',
      clientId: '',
      clientSecretRef: '',
      redirectUri: '',
      scopes: ['openid', 'profile', 'email', 'User.Read'],
      authRequestBackendId: '',
      authRequestPath: '/auth',
      propagateHeaders: ['remote-user', 'remote-groups', 'remote-email'],
    }),
    ConfigForm: EntraForm,
    validate: draft => validateEntra(draft.config ?? {}),
    summary: summariseEntra,
  },
  {
    value: 'jwt-verify',
    label: 'JWT verify (JWKS-based)',
    emptyConfig: () => ({
      jwksUrl: '',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
      authRequestBackendId: '',
      authRequestPath: '/verify',
      propagateHeaders: ['x-jwt-sub', 'x-jwt-scope'],
    }),
    ConfigForm: JwtVerifyForm,
    validate: draft => validateJwtVerify(draft.config ?? {}),
    summary: summariseJwtVerify,
  },
  {
    value: 'mtls-auth',
    label: 'mTLS-as-auth (client cert identity)',
    emptyConfig: () => ({
      trustedAttribute: 'cn',
      userHeaderName: 'X-Client-CN',
      requirePresent: true,
    }),
    ConfigForm: MtlsAuthForm,
    validate: () => null,
    summary: summariseMtls,
  },
  {
    value: 'header-trust',
    label: 'header-trust (upstream proxy)',
    emptyConfig: () => ({
      headerName: '',
      trustedSourceCidrs: [],
      stripFromUntrusted: true,
    }),
    ConfigForm: HeaderTrustForm,
    validate: draft => validateHeaderTrust(draft.config ?? {}),
    summary: summariseHeaderTrust,
  },
  {
    value: 'lua-auth',
    label: 'lua-auth (raw escape hatch)',
    emptyConfig: () => ({
      pluginPath: '',
      functionName: '',
      args: [],
    }),
    ConfigForm: LuaAuthForm,
    validate: draft => validateLuaAuth(draft.config ?? {}),
    summary: summariseLuaAuth,
  },
]);

export const AUTH_PROVIDER_REGISTRY = buildKindRegistry({
  kinds: AUTH_KINDS,
  discriminator: 'type',
  subFieldName: 'config',
});

export { withBasicInternalKeys, stripBasicInternalKeys };
