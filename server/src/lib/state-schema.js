import { z } from 'zod';

const idPattern = /^[a-z][a-z0-9_-]{0,62}$/;
const aclNamePattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const hostnamePattern = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;
const cidrPattern = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const addrPortPattern = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/;
const serverAddrPattern = /^(?:quic[46]@)?(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/;
const quicSizePattern = /^\d+[kmgKMG]?$/;
const durationPattern = /^\d+(?:ms|s|m|h|d)$/;
const cronPattern = /^[\d*,/\s-]+$/;

const IdSchema = z.string().regex(idPattern, 'lowercase ascii id');
const AclNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(aclNamePattern, 'HAProxy ACL identifier (letter-start, letters/digits/_/./-)');
const HostnameSchema = z.string().regex(hostnamePattern, 'invalid hostname');
const CidrSchema = z.string().regex(cidrPattern, 'expected CIDR notation');
const AddrPortSchema = z.string().regex(addrPortPattern, 'expected host:port');
const ServerAddrSchema = z
  .string()
  .regex(serverAddrPattern, 'expected host:port (optionally prefixed with quic4@ or quic6@)');
const QuicSizeSchema = z.string().regex(quicSizePattern, 'expected size like "100k" or "1m"');
const DurationSchema = z.string().regex(durationPattern, 'expected duration like "30s" or "5m"');
const TimestampSchema = z.string().datetime({ offset: true });

export const ServerSchema = z.object({
  name: z.string().min(1).max(64),
  address: ServerAddrSchema,
  check: z.boolean().default(true),
  ssl: z.boolean().default(false),
  sslVerify: z.enum(['required', 'none']).optional(),
  caTrustedCaId: IdSchema.optional(),
  sni: z.string().optional(),
  cookie: z.string().optional(),
  weight: z.number().int().min(0).max(256).optional(),
  backup: z.boolean().default(false),
  maxconn: z.number().int().positive().optional(),
  initAddr: z.array(z.enum(['last', 'libc', 'none', 'ip'])).optional(),
  sendProxy: z.enum(['none', 'v1', 'v2', 'v2-ssl', 'v2-ssl-cn']).default('none'),
  advancedDirectives: z.array(z.string()).default([]),
});

export const StickTableSchema = z.object({
  type: z.enum(['ip', 'ipv6', 'integer', 'string', 'binary']),
  size: z.string().regex(/^\d+[kmgKMG]?$/),
  expire: DurationSchema,
  stickOn: z.string().min(1),
});

export const BackendSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(64),
  mode: z.enum(['http', 'tcp']).default('http'),
  balance: z
    .enum([
      'roundrobin',
      'static-rr',
      'leastconn',
      'first',
      'source',
      'uri',
      'url_param',
      'hdr',
      'random',
    ])
    .default('random'),
  servers: z.array(ServerSchema).min(1),
  options: z.array(z.string()).default([]),
  stickTable: StickTableSchema.optional(),
  timeouts: z
    .object({
      connect: DurationSchema.optional(),
      server: DurationSchema.optional(),
      queue: DurationSchema.optional(),
      tunnel: DurationSchema.optional(),
      check: DurationSchema.optional(),
    })
    .default({}),
  httpReuse: z.enum(['never', 'safe', 'aggressive', 'always']).optional(),
  forwardFor: z.boolean().default(false),
  retries: z.number().int().min(0).max(10).optional(),
  advancedDirectives: z.array(z.string()).default([]),
});

export const AutheliaConfigSchema = z.object({
  endpointFlavor: z.enum(['legacy', 'forward-auth']).default('forward-auth'),
  authRequestBackendId: IdSchema,
  redirectUrlTemplate: z.string().min(1),
  apiVerifyPath: z.string().min(1).default('/api/authz/forward-auth'),
  propagateHeaders: z
    .array(z.string().min(1))
    .default(['remote-user', 'remote-groups', 'remote-name', 'remote-email']),
});

export const BasicAuthConfigSchema = z.object({
  realm: z.string().min(1).default('Restricted'),
  users: z
    .array(
      z.object({
        username: z.string().min(1),
        passwordHashRef: z.string().min(1),
      })
    )
    .min(1),
});

export const OidcConfigSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecretRef: z.string().min(1),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email']),
});

export const LdapConfigSchema = z.object({
  url: z.string().url(),
  bindDn: z.string().min(1),
  bindPasswordRef: z.string().min(1),
  userSearchBase: z.string().min(1),
  userSearchFilter: z.string().min(1).default('(uid={username})'),
  groupSearchBase: z.string().min(1).optional(),
  groupSearchFilter: z.string().min(1).optional(),
  tlsVerify: z.enum(['required', 'none']).default('required'),
  authRequestBackendId: IdSchema,
  authRequestPath: z.string().min(1).default('/auth'),
  propagateHeaders: z.array(z.string().min(1)).default(['remote-user', 'remote-groups']),
});

export const SamlConfigSchema = z.object({
  idpMetadataUrl: z.string().url(),
  spEntityId: z.string().min(1),
  acsUrl: z.string().url(),
  signingKeyRef: z.string().min(1).optional(),
  authRequestBackendId: IdSchema,
  authRequestPath: z.string().min(1).default('/saml/auth'),
  propagateHeaders: z.array(z.string().min(1)).default(['remote-user', 'remote-groups']),
});

export const EntraConfigSchema = z.object({
  tenantId: z.string().regex(/^[a-zA-Z0-9-]+$/u, 'Entra tenant id'),
  clientId: z.string().min(1),
  clientSecretRef: z.string().min(1),
  redirectUri: z.string().url(),
  scopes: z.array(z.string()).default(['openid', 'profile', 'email', 'User.Read']),
  authRequestBackendId: IdSchema,
  authRequestPath: z.string().min(1).default('/auth'),
  propagateHeaders: z
    .array(z.string().min(1))
    .default(['remote-user', 'remote-groups', 'remote-email']),
});

export const JwtVerifyConfigSchema = z.object({
  jwksUrl: z.string().url(),
  expectedAudience: z.string().min(1).optional(),
  expectedIssuer: z.string().min(1).optional(),
  headerName: z.string().min(1).default('Authorization'),
  headerPrefix: z.string().default('Bearer '),
  authRequestBackendId: IdSchema,
  authRequestPath: z.string().min(1).default('/verify'),
  propagateHeaders: z.array(z.string().min(1)).default(['x-jwt-sub', 'x-jwt-scope']),
});

export const MtlsAuthConfigSchema = z.object({
  trustedAttribute: z.enum(['cn', 'san', 'serial']).default('cn'),
  userHeaderName: z.string().min(1).default('X-Client-CN'),
  requirePresent: z.boolean().default(true),
});

export const HeaderTrustConfigSchema = z.object({
  headerName: z.string().min(1),
  trustedSourceCidrs: z.array(CidrSchema).min(1),
  stripFromUntrusted: z.boolean().default(true),
  userHeaderName: z.string().min(1).optional(),
});

export const LuaAuthConfigSchema = z.object({
  pluginPath: z.string().min(1),
  prependPath: z.string().min(1).optional(),
  functionName: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'Lua function identifier (letters/digits/_)'),
  args: z.array(z.string()).default([]),
});

export const AuthProviderSchema = z.discriminatedUnion('type', [
  z.object({ id: IdSchema, type: z.literal('none'), config: z.object({}).default({}) }),
  z.object({ id: IdSchema, type: z.literal('authelia'), config: AutheliaConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('basic'), config: BasicAuthConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('oidc'), config: OidcConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('ldap'), config: LdapConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('saml'), config: SamlConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('entra'), config: EntraConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('jwt-verify'), config: JwtVerifyConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('mtls-auth'), config: MtlsAuthConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('header-trust'), config: HeaderTrustConfigSchema }),
  z.object({ id: IdSchema, type: z.literal('lua-auth'), config: LuaAuthConfigSchema }),
]);

// =====================================================================
// ACL primitives + condition expression. An ACL is a single fetch +
// matcher + values list rendered as a literal `acl NAME FETCH[(arg)]
// [-m MATCHER] [-i] VALUE...` line at the top of every frontend body
// that references it. A condition (used by Rules) is a flat array of
// terms; each term is either an aclRef (by name) or an inline anonymous
// match. `combineWithNext` joins terms with AND (space) or OR (`||`);
// `negate` prefixes with `!`.
// =====================================================================

export const ACL_OPERATORS = Object.freeze([
  'str',
  'sub',
  'beg',
  'end',
  'reg',
  'dir',
  'dom',
  'len',
  'bin',
  'found',
  'ip',
  'int',
  'gt',
  'lt',
  'ge',
  'le',
  'eq',
  'ne',
  'bool',
]);

const AclOperatorSchema = z.enum(ACL_OPERATORS);

export const AclSchema = z.object({
  id: IdSchema,
  name: AclNameSchema,
  description: z.string().max(256).optional(),
  field: z.string().min(1).max(128),
  fieldArg: z.string().max(256).optional(),
  operator: AclOperatorSchema.optional(),
  values: z.array(z.string()).default([]),
  caseInsensitive: z.boolean().default(false),
  noDnsLookup: z.boolean().default(false),
});

const ConditionAclRefSchema = z.object({
  kind: z.literal('aclRef'),
  aclName: AclNameSchema,
  negate: z.boolean().default(false),
  combineWithNext: z.enum(['and', 'or']).default('and'),
});

const ConditionInlineSchema = z.object({
  kind: z.literal('inline'),
  field: z.string().min(1).max(128),
  fieldArg: z.string().max(256).optional(),
  operator: AclOperatorSchema.optional(),
  values: z.array(z.string()).default([]),
  caseInsensitive: z.boolean().default(false),
  noDnsLookup: z.boolean().default(false),
  negate: z.boolean().default(false),
  combineWithNext: z.enum(['and', 'or']).default('and'),
});

export const ConditionTermSchema = z.discriminatedUnion('kind', [
  ConditionAclRefSchema,
  ConditionInlineSchema,
]);

export const ConditionSchema = z.array(ConditionTermSchema).default([]);

// =====================================================================
// Rule action vocabularies, per phase. Each phase's RuleSchema picks
// its action from a discriminated union shaped to that phase's HAProxy
// directive grammar. Adding a new action = a new arm + a renderer case.
// =====================================================================

const RuleStatusCodeSchema = z.number().int().min(400).max(599);

const ReturnBodySchema = z.object({
  kind: z.enum(['string', 'lf-string', 'file', 'lf-file']),
  content: z.string(),
});

const ReturnHeaderSchema = z.object({
  name: z.string().min(1).max(128),
  value: z.string(),
});

const setHeaderShape = { name: z.string().min(1).max(128), value: z.string() };
const addHeaderShape = { name: z.string().min(1).max(128), value: z.string() };
const delHeaderShape = { name: z.string().min(1).max(128) };
const replaceHeaderShape = {
  name: z.string().min(1).max(128),
  matchRegex: z.string().min(1),
  replacement: z.string(),
};
const replaceValueShape = {
  name: z.string().min(1).max(128),
  matchRegex: z.string().min(1),
  replacement: z.string(),
};
const VarScopeSchema = z.enum(['proc', 'sess', 'txn', 'req', 'res']);
const setVarShape = {
  scope: VarScopeSchema,
  name: z.string().min(1).max(128),
  expression: z.string().min(1),
};
const unsetVarShape = { scope: VarScopeSchema, name: z.string().min(1).max(128) };
const trackScShape = {
  scIndex: z.number().int().min(0).max(31),
  key: z.string().min(1),
  table: z.string().min(1),
};
const captureShape = {
  expression: z.string().min(1),
  len: z.number().int().positive(),
};
const luaShape = {
  function: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/u, 'lua function identifier'),
  args: z.array(z.string()).default([]),
};
const setLogLevelShape = {
  level: z.enum(['silent', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']),
};
const returnShape = {
  statusCode: z.number().int().min(100).max(599).optional(),
  contentType: z.string().optional(),
  body: ReturnBodySchema.optional(),
  headers: z.array(ReturnHeaderSchema).default([]),
};
const redirectShape = {
  redirectType: z.enum(['location', 'prefix', 'scheme']),
  target: z.string().min(1),
  code: z.number().int().min(301).max(308).optional(),
  dropQueryString: z.boolean().default(false),
  appendSlash: z.boolean().default(false),
  setCookie: z.string().optional(),
  clearCookie: z.string().optional(),
};
const doResolveShape = {
  varScope: VarScopeSchema,
  varName: z.string().min(1).max(128),
  resolvers: z.string().min(1),
  family: z.enum(['ipv4', 'ipv6']).optional(),
  expression: z.string().min(1),
};
const scIncGpcShape = {
  gpcIndex: z.number().int().min(0).max(2),
  scIndex: z.number().int().min(0).max(31),
};

// ----- httpRequest -----
export const HttpRequestActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('allow') }),
  z.object({ type: z.literal('deny'), statusCode: RuleStatusCodeSchema.optional() }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('tarpit'), statusCode: RuleStatusCodeSchema.optional() }),
  z.object({ type: z.literal('redirect'), ...redirectShape }),
  z.object({ type: z.literal('use-backend'), backendId: IdSchema }),
  z.object({ type: z.literal('use-service'), serviceName: z.string().min(1) }),
  z.object({ type: z.literal('set-header'), ...setHeaderShape }),
  z.object({ type: z.literal('add-header'), ...addHeaderShape }),
  z.object({ type: z.literal('del-header'), ...delHeaderShape }),
  z.object({ type: z.literal('replace-header'), ...replaceHeaderShape }),
  z.object({ type: z.literal('replace-value'), ...replaceValueShape }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('set-path'), expression: z.string().min(1) }),
  z.object({ type: z.literal('set-uri'), expression: z.string().min(1) }),
  z.object({ type: z.literal('set-query'), expression: z.string().min(1) }),
  z.object({ type: z.literal('set-method'), expression: z.string().min(1) }),
  z.object({ type: z.literal('set-log-level'), ...setLogLevelShape }),
  z.object({ type: z.literal('silent-drop') }),
  z.object({ type: z.literal('track-sc'), ...trackScShape }),
  z.object({ type: z.literal('capture'), ...captureShape }),
  z.object({ type: z.literal('lua'), ...luaShape }),
  z.object({ type: z.literal('auth'), realm: z.string().min(1).optional() }),
  z.object({ type: z.literal('return'), ...returnShape }),
  z.object({
    type: z.literal('normalize-uri'),
    method: z.enum([
      'path-merge-slashes',
      'path-strip-dot',
      'path-strip-dotdot',
      'fragment-encode',
      'fragment-strip',
      'percent-decode-unreserved',
      'percent-to-uppercase',
      'query-sort-by-name',
    ]),
  }),
  z.object({ type: z.literal('wait-for-body'), time: DurationSchema }),
  z.object({
    type: z.literal('early-hint'),
    name: z.string().min(1).max(128),
    value: z.string(),
  }),
  z.object({ type: z.literal('do-resolve'), ...doResolveShape }),
  z.object({ type: z.literal('sc-inc-gpc'), ...scIncGpcShape }),
  // SUGAR ACTIONS — both `apply-security-profile` and `apply-auth-provider`
  // expand at render-time into multi-line directive chains (deny + track-sc +
  // lua.auth-intercept + redirect + del-header + etc.). They satisfy the
  // "no orphan render lines" rule because every emitted line traces back to
  // a single user-created Rule entity, but the expansion isn't visible in
  // state. If users prefer to compose the chains as primitive Rules
  // (multiple `del-header` + `lua` + `deny` + `redirect` rules gated by
  // their own ACLs), these two actions can be removed in a future cycle.
  z.object({ type: z.literal('apply-security-profile'), profileId: IdSchema }),
  z.object({ type: z.literal('apply-auth-provider'), providerId: IdSchema }),
]);

// ----- httpResponse -----
export const HttpResponseActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('allow') }),
  z.object({ type: z.literal('deny'), statusCode: RuleStatusCodeSchema.optional() }),
  z.object({
    type: z.literal('set-status'),
    statusCode: z.number().int().min(100).max(599),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('set-header'), ...setHeaderShape }),
  z.object({ type: z.literal('add-header'), ...addHeaderShape }),
  z.object({ type: z.literal('del-header'), ...delHeaderShape }),
  z.object({ type: z.literal('replace-header'), ...replaceHeaderShape }),
  z.object({ type: z.literal('replace-value'), ...replaceValueShape }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('set-log-level'), ...setLogLevelShape }),
  z.object({ type: z.literal('silent-drop') }),
  z.object({ type: z.literal('lua'), ...luaShape }),
  z.object({ type: z.literal('return'), ...returnShape }),
  z.object({ type: z.literal('redirect'), ...redirectShape }),
  z.object({
    type: z.literal('capture'),
    id: z.number().int().min(0),
    expression: z.string().min(1),
  }),
]);

// ----- httpAfterResponse -----
export const HttpAfterResponseActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('allow') }),
  z.object({ type: z.literal('deny') }),
  z.object({
    type: z.literal('set-status'),
    statusCode: z.number().int().min(100).max(599),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('set-header'), ...setHeaderShape }),
  z.object({ type: z.literal('add-header'), ...addHeaderShape }),
  z.object({ type: z.literal('del-header'), ...delHeaderShape }),
  z.object({ type: z.literal('replace-header'), ...replaceHeaderShape }),
  z.object({ type: z.literal('replace-value'), ...replaceValueShape }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('set-log-level'), ...setLogLevelShape }),
  z.object({ type: z.literal('lua'), ...luaShape }),
]);

// ----- tcpRequestConnection -----
const setMarkShape = { mark: z.string().min(1) };
const setTosShape = { tos: z.string().min(1) };
const setPriorityClassShape = { value: z.number().int() };
const setPriorityOffsetShape = { value: z.number().int() };

export const TcpRequestConnectionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('track-sc'), ...trackScShape }),
  z.object({ type: z.literal('silent-drop') }),
  z.object({ type: z.literal('set-mark'), ...setMarkShape }),
  z.object({ type: z.literal('set-tos'), ...setTosShape }),
  z.object({ type: z.literal('sc-inc-gpc'), ...scIncGpcShape }),
]);

// ----- tcpRequestSession -----
export const TcpRequestSessionActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('track-sc'), ...trackScShape }),
  z.object({ type: z.literal('silent-drop') }),
]);

// ----- tcpRequestContent -----
export const TcpRequestContentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('track-sc'), ...trackScShape }),
  z.object({ type: z.literal('silent-drop') }),
  z.object({ type: z.literal('lua'), ...luaShape }),
  z.object({ type: z.literal('use-service'), serviceName: z.string().min(1) }),
  z.object({ type: z.literal('do-resolve'), ...doResolveShape }),
  z.object({ type: z.literal('set-priority-class'), ...setPriorityClassShape }),
  z.object({ type: z.literal('set-priority-offset'), ...setPriorityOffsetShape }),
  z.object({ type: z.literal('set-mark'), ...setMarkShape }),
  z.object({ type: z.literal('set-tos'), ...setTosShape }),
]);

// ----- tcpResponseContent -----
export const TcpResponseContentActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept') }),
  z.object({ type: z.literal('reject') }),
  z.object({ type: z.literal('close') }),
  z.object({ type: z.literal('set-var'), ...setVarShape }),
  z.object({ type: z.literal('unset-var'), ...unsetVarShape }),
  z.object({ type: z.literal('lua'), ...luaShape }),
  z.object({ type: z.literal('silent-drop') }),
]);

const ruleBaseShape = {
  id: IdSchema,
  name: z.string().max(128).optional(),
  enabled: z.boolean().default(true),
  condition: ConditionSchema,
};

export const HttpRequestRuleSchema = z.object({
  ...ruleBaseShape,
  action: HttpRequestActionSchema,
});
export const HttpResponseRuleSchema = z.object({
  ...ruleBaseShape,
  action: HttpResponseActionSchema,
});
export const HttpAfterResponseRuleSchema = z.object({
  ...ruleBaseShape,
  action: HttpAfterResponseActionSchema,
});
export const TcpRequestConnectionRuleSchema = z.object({
  ...ruleBaseShape,
  action: TcpRequestConnectionActionSchema,
});
export const TcpRequestSessionRuleSchema = z.object({
  ...ruleBaseShape,
  action: TcpRequestSessionActionSchema,
});
export const TcpRequestContentRuleSchema = z.object({
  ...ruleBaseShape,
  action: TcpRequestContentActionSchema,
});
export const TcpResponseContentRuleSchema = z.object({
  ...ruleBaseShape,
  action: TcpResponseContentActionSchema,
});

// Phase order here is the HAProxy evaluation order. UI tabs are presented
// in this order so users see "early to late" from left to right.
export const RulePhasesSchema = z.object({
  tcpRequestConnection: z.array(TcpRequestConnectionRuleSchema).default([]),
  tcpRequestSession: z.array(TcpRequestSessionRuleSchema).default([]),
  tcpRequestContent: z.array(TcpRequestContentRuleSchema).default([]),
  httpRequest: z.array(HttpRequestRuleSchema).default([]),
  httpResponse: z.array(HttpResponseRuleSchema).default([]),
  httpAfterResponse: z.array(HttpAfterResponseRuleSchema).default([]),
  tcpResponseContent: z.array(TcpResponseContentRuleSchema).default([]),
});

const tlsProviderCommonShape = {
  id: IdSchema,
  credentialsRef: z.string().min(1).nullable().default(null),
};

const DnsCloudflareOptionsSchema = z
  .object({ propagationSeconds: z.number().int().min(30).max(600).optional() })
  .default({});

const DnsRoute53OptionsSchema = z
  .object({
    awsRegion: z.string().min(1).optional(),
    propagationSeconds: z.number().int().min(30).max(600).optional(),
  })
  .default({});

const DnsGoogleOptionsSchema = z
  .object({ propagationSeconds: z.number().int().min(30).max(600).optional() })
  .default({});

const DnsDigitaloceanOptionsSchema = z
  .object({ propagationSeconds: z.number().int().min(30).max(600).optional() })
  .default({});

const DnsOvhOptionsSchema = z
  .object({
    endpoint: z.enum(['ovh-eu', 'ovh-ca', 'kimsufi-eu', 'soyoustart-eu']).optional(),
    propagationSeconds: z.number().int().min(30).max(600).optional(),
  })
  .default({});

const DnsRfc2136OptionsSchema = z
  .object({
    server: AddrPortSchema.optional(),
    tsigName: z.string().min(1).optional(),
    tsigAlgorithm: z.enum(['HMAC-SHA256', 'HMAC-SHA512', 'HMAC-SHA384', 'HMAC-MD5']).optional(),
    propagationSeconds: z.number().int().min(30).max(600).optional(),
  })
  .default({});

const DnsMultiOptionsSchema = z
  .object({
    provider: z.string().min(1).optional(),
    propagationSeconds: z.number().int().min(30).max(600).optional(),
  })
  .default({});

const Http01OptionsSchema = z.object({}).default({});
const ByoOptionsSchema = z.object({}).default({});

export const TLSProviderSchema = z.discriminatedUnion('type', [
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-cloudflare'),
    options: DnsCloudflareOptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-route53'),
    options: DnsRoute53OptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-google'),
    options: DnsGoogleOptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-digitalocean'),
    options: DnsDigitaloceanOptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-ovh'),
    options: DnsOvhOptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-rfc2136'),
    options: DnsRfc2136OptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('dns-multi'),
    options: DnsMultiOptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('http-01'),
    options: Http01OptionsSchema,
  }),
  z.object({
    ...tlsProviderCommonShape,
    type: z.literal('byo'),
    options: ByoOptionsSchema,
  }),
]);

export const TLSCertSchema = z.object({
  id: IdSchema,
  certName: z.string().min(1).max(128),
  domains: z.array(HostnameSchema).min(1),
  providerId: IdSchema,
  acmeAccountId: IdSchema.optional(),
  expanding: z.boolean().default(true),
  keyType: z.enum(['rsa', 'ecdsa']).default('ecdsa'),
  rsaKeySize: z.number().int().min(2048).max(8192).optional(),
});

export const LuaPluginSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  prependPath: z.string().min(1).optional(),
});

const QuicSideSharedSchema = z.object({
  maxIdleTimeout: DurationSchema.optional(),
  ccCubicMinLosses: z.number().int().min(0).optional(),
  ccHystart: z.boolean().optional(),
  ccMaxFrameLoss: z.number().int().min(0).optional(),
  ccMaxWinSize: QuicSizeSchema.optional(),
  ccReorderRatio: z.number().int().min(0).max(100).optional(),
  secGlitchesThreshold: z.number().int().min(0).optional(),
  streamDataRatio: z.number().int().min(0).optional(),
  streamMaxConcurrent: z.number().int().min(0).optional(),
  streamRxbuf: QuicSizeSchema.optional(),
  txPacing: z.boolean().optional(),
  txUdpGso: z.boolean().optional(),
});

export const QuicFeSchema = QuicSideSharedSchema.extend({
  sockPerConn: z.number().int().min(1).optional(),
  secRetryThreshold: z.number().int().min(0).optional(),
});

export const QuicBeSchema = QuicSideSharedSchema;

export const QuicTunablesSchema = z.object({
  listen: z.boolean().optional(),
  memTxMax: QuicSizeSchema.optional(),
  zeroCopyFwdSend: z.boolean().optional(),
  fe: QuicFeSchema.default({}),
  be: QuicBeSchema.default({}),
});

const TlsVersionSchema = z.enum(['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);

export const SslSideSchema = z.object({
  enabledVersions: z.array(TlsVersionSchema).optional(),
  ciphers: z.array(z.string().min(1)).optional(),
  ciphersuites: z.array(z.string().min(1)).optional(),
  curves: z.array(z.string().min(1)).optional(),
  sigalgs: z.array(z.string().min(1)).optional(),
  clientSigalgs: z.array(z.string().min(1)).optional(),
  options: z.array(z.string().min(1)).optional(),
});

export const SslTuneSchema = z.object({
  cachesize: z.number().int().min(0).optional(),
  lifetime: z.number().int().min(0).optional(),
  maxrecord: z.number().int().min(0).optional(),
  defaultDhParam: z.number().int().min(1024).default(4096),
  forcePrivateCache: z.boolean().optional(),
  captureBufferSize: z.number().int().min(0).optional(),
  numAsync: z.number().int().min(0).optional(),
  keylog: z.boolean().default(false),
});

export const SslProvidersSchema = z.object({
  loaded: z.array(z.string().min(1)).default([]),
  defaultProperties: z.string().min(1).nullable().default(null),
});

export const SslLoadExtraFilesSchema = z.object({
  extraFiles: z.array(z.string().min(1)).default([]),
  deleteExtensions: z.boolean().default(false),
});

export const SslProfileSchema = z.object({
  name: z.enum(['modern', 'intermediate', 'old', 'custom']).default('intermediate'),
  basedOnVersion: z.number().int().min(1).default(1),
});

export const SslGlobalSchema = z.object({
  profile: SslProfileSchema.default({}),
  bind: SslSideSchema.default({}),
  server: SslSideSchema.default({}),
  tune: SslTuneSchema.default({}),
  providers: SslProvidersSchema.default({}),
  loadExtraFiles: SslLoadExtraFilesSchema.default({}),
});

export const GlobalSettingsSchema = z.object({
  maxconn: z.number().int().min(1).max(2_000_000).default(500_000),
  fdHardLimit: z.number().int().min(1024).max(2_000_000).default(524_288),
  tuneBufsize: z.number().int().min(8192).default(64_768),
  ssl: SslGlobalSchema.default({}),
  hardStopAfter: DurationSchema.default('30s'),
  logLevel: z
    .enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'])
    .default('info'),
  luaPlugins: z.array(LuaPluginSchema).default([]),
  uniqueIdFormat: z
    .string()
    .default('%{+X}o\\ %ci:%cp_%fi:%fp_%Ts_%rt:%pid')
    .transform(value =>
      value.includes(',file(') ? '%{+X}o\\ %ci:%cp_%fi:%fp_%Ts_%rt:%pid' : value
    ),
  uniqueIdHeader: z.string().min(1).nullable().default('X-Request-ID'),
  jsonLogFormat: z.boolean().default(false),
  quic: QuicTunablesSchema.default({}),
  advancedDirectives: z.array(z.string()).default([]),
});

export const ERROR_FILE_CODES = Object.freeze([
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

const CANONICAL_ERROR_FILES = Object.freeze(
  Object.fromEntries(ERROR_FILE_CODES.map(code => [code, `/etc/haproxy/errors/tpl/${code}.http`]))
);

const cleanErrorFilesMap = map => {
  const cleaned = {};
  for (const [code, path] of Object.entries(map)) {
    if (code in CANONICAL_ERROR_FILES) {
      cleaned[code] = path;
    }
  }
  return cleaned;
};

export const HttpErrorsSectionSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy http-errors section name'),
  errorFiles: z.record(z.string(), z.string()).default({}).transform(cleanErrorFilesMap),
});

const HttpErrorDirectiveSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    contentType: z.string().min(1).optional(),
    lfFile: z.string().min(1).optional(),
    lfString: z.string().min(1).optional(),
  })
  .refine(
    val =>
      !(val.lfFile && val.lfString) && (val.lfFile !== undefined || val.lfString !== undefined),
    { message: 'exactly one of lfFile or lfString is required' }
  );

const DefaultServerSchema = z.object({
  initAddr: z.array(z.enum(['last', 'libc', 'none', 'ip'])).default(['last', 'libc', 'none']),
});

// =====================================================================
// Named defaults block. HAProxy 2.4+ allows multiple `defaults NAME { ... }`
// sections; frontends/backends pick one via `from <name>`. patchpanel
// stores them as a list. Frontends reference one by `fromDefaults: id`.
// Implicit-positional inheritance is intentionally not supported.
// =====================================================================

export const DefaultsBlockSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy defaults section name'),
  description: z.string().max(256).optional(),
  mode: z.enum(['http', 'tcp']).default('http'),
  timeouts: z
    .object({
      httpRequest: DurationSchema.default('60s'),
      queue: DurationSchema.default('1m'),
      connect: DurationSchema.default('30s'),
      client: DurationSchema.default('1m'),
      server: DurationSchema.default('1m'),
      httpKeepAlive: DurationSchema.default('30s'),
      check: DurationSchema.default('10s'),
      clientFin: DurationSchema.default('30s'),
      tunnel: DurationSchema.default('1h'),
    })
    .default({}),
  options: z
    .array(z.string())
    .default([
      'http-keep-alive',
      'http-server-close',
      'dontlognull',
      'httplog',
      'redispatch',
      'tcpka',
    ]),
  retries: z.number().int().min(0).max(10).default(3),
  errorFiles: z
    .record(z.string(), z.string())
    .default(CANONICAL_ERROR_FILES)
    .transform(cleanErrorFilesMap),
  errorPageContents: z
    .record(z.string().regex(/^\d{3}$/u, 'status code must be 3 digits'), z.string().max(65_536))
    .default({}),
  // Parallel to errorPageContents, but for `http-error … lf-file <path>`
  // — content here is served via HAProxy's log-format evaluator, so tokens
  // like %[unique-id], %[var(…)], %[hdr(…)] get expanded at serve time.
  // Persisted to disk in `<haproxyErrorPagesDir>/<blockId>/lf/<code>.html`
  // and an `http-error status <code> content-type "text/html; charset=utf-8"
  // lf-file <path>` directive is injected into the block's httpErrors[]
  // at render time.
  lfFileContents: z
    .record(z.string().regex(/^\d{3}$/u, 'status code must be 3 digits'), z.string().max(65_536))
    .default({}),
  httpErrors: z.array(HttpErrorDirectiveSchema).default([]),
  useErrorFilesId: IdSchema.nullable().default(null),
  defaultServer: DefaultServerSchema.default({}),
  dontlogNormal: z.boolean().default(false),
  advancedDirectives: z.array(z.string()).default([]),
});

export const ResolverNameserverSchema = z.object({
  name: z.string().min(1).max(64),
  address: AddrPortSchema,
});

export const ResolverSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy resolvers section name'),
  nameservers: z.array(ResolverNameserverSchema).min(1),
  acceptedPayloadSize: z.number().int().min(512).max(65_535).optional(),
  holdValid: DurationSchema.optional(),
  holdObsolete: DurationSchema.optional(),
  holdNx: DurationSchema.optional(),
  timeoutResolve: DurationSchema.optional(),
  timeoutRetry: DurationSchema.optional(),
  resolveRetries: z.number().int().min(0).max(20).optional(),
});

export const PeerMemberSchema = z.object({
  name: z.string().min(1).max(64),
  address: AddrPortSchema,
});

export const PeerGroupSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy peers section name'),
  peers: z.array(PeerMemberSchema).min(1),
});

export const MailerMemberSchema = z.object({
  name: z.string().min(1).max(64),
  address: AddrPortSchema,
});

export const MailerGroupSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy mailers section name'),
  timeout: DurationSchema.optional(),
  mailers: z.array(MailerMemberSchema).min(1),
});

export const RingServerSchema = z.object({
  name: z.string().min(1).max(64),
  address: AddrPortSchema,
});

export const RingSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy ring section name'),
  description: z.string().optional(),
  format: z.enum(['raw', 'rfc3164', 'rfc5424', 'short', 'priority', 'timed', 'iso']).optional(),
  maxlen: z.number().int().min(80).optional(),
  size: z.number().int().min(1024).optional(),
  timeoutConnect: DurationSchema.optional(),
  timeoutServer: DurationSchema.optional(),
  servers: z.array(RingServerSchema).min(1),
});

export const CrtStoreEntrySchema = z.object({
  crt: z.string().min(1),
  key: z.string().min(1).optional(),
  alias: z.string().min(1).optional(),
  acme: IdSchema.optional(),
});

export const CrtStoreSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy crt-store name'),
  crtBase: z.string().min(1).optional(),
  keyBase: z.string().min(1).optional(),
  loadEntries: z.array(CrtStoreEntrySchema).default([]),
});

export const MapEntrySchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export const MapSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'HAProxy map file name'),
  description: z.string().optional(),
  entries: z.array(MapEntrySchema).default([]),
});

const SizeSchema = z.string().regex(/^\d+[kmgKMG]?$/u, 'size like "100k" or "1m"');

export const RateLimitPolicyConfigSchema = z.object({
  tableSize: SizeSchema.default('100k'),
  tableExpire: DurationSchema.default('60s'),
  store: z
    .array(z.string().min(1))
    .default(['conn_rate(10s)', 'http_req_rate(60s)', 'http_err_rate(30s)']),
  trackBy: z.string().min(1).default('src'),
  denyThreshold: z.number().int().min(1).default(100),
  denyStatus: z.number().int().min(400).max(599).default(429),
  counterExpression: z.string().min(1).default('sc_http_req_rate(0)'),
});

export const GeoBlockPolicyConfigSchema = z.object({
  mapRef: z.string().min(1),
  allowList: z.array(z.string().min(2).max(3)).default([]),
  denyList: z.array(z.string().min(2).max(3)).default([]),
  denyStatus: z.number().int().min(400).max(599).default(403),
});

export const BotDefensePolicyConfigSchema = z.object({
  uaDenyPatterns: z.array(z.string().min(1)).default([]),
  uaAllowPatterns: z.array(z.string().min(1)).default([]),
  denyStatus: z.number().int().min(400).max(599).default(403),
});

export const SecurityProfileSchema = z.discriminatedUnion('kind', [
  z.object({
    id: IdSchema,
    kind: z.literal('rate-limit'),
    label: z.string().min(1).max(128),
    config: RateLimitPolicyConfigSchema,
  }),
  z.object({
    id: IdSchema,
    kind: z.literal('geo-block'),
    label: z.string().min(1).max(128),
    config: GeoBlockPolicyConfigSchema,
  }),
  z.object({
    id: IdSchema,
    kind: z.literal('bot-defense'),
    label: z.string().min(1).max(128),
    config: BotDefensePolicyConfigSchema,
  }),
]);

export const LetsEncryptSchema = z.object({
  forceRenewal: z.boolean().default(false),
  skipRenewal: z.boolean().default(false),
  defaultPropagationSeconds: z.number().int().min(30).max(600).default(120),
  renewalSchedule: z.string().regex(cronPattern).default('5 8 * * 1,4'),
});

export const ACME_SERVERS = Object.freeze([
  'letsencrypt',
  'letsencrypt-staging',
  'zerossl',
  'buypass',
  'google',
  'custom',
]);

const ACME_SERVERS_REQUIRING_EAB = new Set(['zerossl', 'google']);

export const AcmeAccountSchema = z.object({
  id: IdSchema,
  description: z.string().max(256).optional(),
  email: z.string().email(),
  server: z.enum(ACME_SERVERS).default('letsencrypt'),
  directoryUrl: z.string().url().optional(),
  eabKid: z.string().min(1).optional(),
  eabHmacKey: z.string().min(1).optional(),
});

// A user-uploaded CA bundle. Referenced from bind ssl (`caTrustedCaId`,
// `caVerifyTrustedCaId`) and server (`caTrustedCaId`) lines. The PEM bytes
// live on disk under `paths.trustedCasDir/<id>.pem`; state only carries the
// id, a friendly name, and parsed metadata (subject summary, fingerprint,
// notAfter) so the UI can show useful labels and badges without re-parsing
// the PEM on every render.
export const TrustedCASchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/u, 'letter-start, letters/digits/_/./-'),
  description: z.string().max(256).optional(),
  fingerprint: z
    .string()
    .regex(/^[A-F0-9]{2}(?::[A-F0-9]{2})+$/u, 'colon-separated uppercase hex SHA-256')
    .optional(),
  subjectSummary: z.string().max(512).optional(),
  notAfter: TimestampSchema.optional(),
  certCount: z.number().int().min(1).optional(),
  addedAt: TimestampSchema,
});

// A user-uploaded X.509 Certificate Revocation List. Referenced from bind ssl
// (`crlTrustedCrlId`) for HAProxy's `crl-file` directive. The PEM bytes live
// on disk under `paths.trustedCrlsDir/<id>.pem`; state carries the id, name,
// and a SHA-256 fingerprint of the DER body so the UI can show a stable
// identifier without re-parsing on every render. CRL semantic parsing
// (nextUpdate, revoked-cert list) is deferred — HAProxy validates the file
// at `haproxy -c` time, which catches malformed CRLs before reload.
export const TrustedCRLSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/u, 'letter-start, letters/digits/_/./-'),
  description: z.string().max(256).optional(),
  fingerprint: z
    .string()
    .regex(/^[A-F0-9]{2}(?::[A-F0-9]{2})+$/u, 'colon-separated uppercase hex SHA-256')
    .optional(),
  addedAt: TimestampSchema,
});

// =====================================================================
// Keepalived / VRRP. Shared (cluster-wide) instance + sync-group +
// track-script definitions live in state and sync between peer nodes.
// Per-node fields (priority, MASTER/BACKUP state, interface name) live
// in /etc/patchpanel/node.yaml and never sync. Each node renders its own
// keepalived.conf from state.keepalived + node.yaml.
// =====================================================================

const VrrpStateSchema = z.enum(['MASTER', 'BACKUP']);
const VrrpAuthTypeSchema = z.enum(['PASS', 'AH']);

export const KeepalivedTrackScriptSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'keepalived script name')
    .optional(),
  script: z.string().min(1).max(2048),
  interval: z.number().int().min(1).max(3600).default(2),
  timeout: z.number().int().min(1).max(60).optional(),
  weight: z.number().int().min(-254).max(254).default(0),
  fall: z.number().int().min(1).max(255).optional(),
  rise: z.number().int().min(1).max(255).optional(),
  initFail: z.boolean().default(false),
});

export const KeepalivedSyncGroupSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'keepalived sync_group name'),
  description: z.string().max(256).optional(),
  instanceIds: z.array(IdSchema).default([]),
  notifyMaster: z.string().min(1).optional(),
  notifyBackup: z.string().min(1).optional(),
  notifyFault: z.string().min(1).optional(),
});

export const KeepalivedInstanceSchema = z.object({
  id: IdSchema,
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/u, 'keepalived vrrp_instance name'),
  description: z.string().max(256).optional(),
  enabled: z.boolean().default(true),
  // The floating IP itself.
  vip: z.string().min(1),
  prefix: z.number().int().min(0).max(128).default(24),
  // VRRP-protocol-level identity. Must match across all nodes participating
  // in the same VIP. 1-255.
  virtualRouterId: z.number().int().min(1).max(255),
  // Shared auth. authType=AH is rare; PASS is the common case.
  authType: VrrpAuthTypeSchema.default('PASS'),
  authPass: z.string().min(1).max(8),
  advertInt: z.number().int().min(1).max(60).default(1),
  // Optional sync group + track script refs.
  syncGroupId: IdSchema.nullable().default(null),
  trackScriptIds: z.array(IdSchema).default([]),
  // Optional advanced VRRP knobs.
  preempt: z.boolean().default(true),
  preemptDelay: z.number().int().min(0).max(1000).optional(),
  garpMasterDelay: z.number().int().min(0).max(60).optional(),
  // Free-form extra notes for the operator.
  notes: z.string().max(512).optional(),
});

export const KeepalivedGlobalDefsSchema = z.object({
  routerId: z.string().min(1).max(64).optional(),
  // Optional notification email config — almost never used in patchpanel
  // deployments, but it's part of keepalived so we expose it.
  notificationEmail: z.array(z.string().email()).default([]),
  notificationEmailFrom: z.string().email().optional(),
  smtpServer: z.string().min(1).optional(),
  smtpConnectTimeout: z.number().int().min(1).max(300).optional(),
  vrrpStrict: z.boolean().default(false),
  vrrpSkipCheckAdvAddr: z.boolean().default(true),
  vrrpGarpInterval: z.number().int().min(0).max(60).optional(),
  vrrpGnaInterval: z.number().int().min(0).max(60).optional(),
});

export const KeepalivedSchema = z.object({
  enabled: z.boolean().default(false),
  globalDefs: KeepalivedGlobalDefsSchema.default({}),
  trackScripts: z.array(KeepalivedTrackScriptSchema).default([]),
  instances: z.array(KeepalivedInstanceSchema).default([]),
  syncGroups: z.array(KeepalivedSyncGroupSchema).default([]),
});

export { VrrpStateSchema };

// =====================================================================
// UI-side convenience storage. Lives in state.json so it syncs between
// peer nodes (operator saves a preset on node 1, sees it on node 2 after
// next sync push). Render layer ignores this entirely — it's purely
// UI sugar with no HAProxy or keepalived side effects.
// =====================================================================

export const SavedBindAddressSchema = z.object({
  address: z.string().min(1).max(256),
  label: z.string().min(1).max(128),
});

export const UiSchema = z.object({
  savedBindAddresses: z.array(SavedBindAddressSchema).default([]),
});

export const MetaSchema = z.object({
  createdAt: TimestampSchema,
  lastEditedAt: TimestampSchema,
  lastEditedBy: z.string().nullable().default(null),
  schemaUpgradedAt: TimestampSchema.optional(),
});

export const NotificationChannelSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(128),
  type: z.enum(['ha-notify', 'webhook', 'discord', 'ntfy', 'slack']),
  enabled: z.boolean().default(true),
  events: z.array(z.string()).default([]),
  minSeverity: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const NotificationsSchema = z.object({
  channels: z.array(NotificationChannelSchema).default([]),
});

export const GeoIpSchema = z.object({
  enabled: z.boolean().default(false),
  localDbSource: z.enum(['none', 'maxmind', 'dbip']).default('dbip'),
  maxmindLicenseKey: z.string().nullable().default(null),
  fallbackProvider: z.enum(['none', 'ip-api', 'ipinfo']).default('ip-api'),
  fallbackToken: z.string().nullable().default(null),
  autoUpdateCron: z.string().regex(cronPattern).default('17 4 * * 1'),
  homeLatitude: z.number().min(-90).max(90).nullable().default(null),
  homeLongitude: z.number().min(-180).max(180).nullable().default(null),
  homeCountry: z
    .string()
    .regex(/^[A-Za-z]{2}$/u, '2-letter ISO country code')
    .nullable()
    .default(null),
  homeLabel: z.string().min(1).max(64).nullable().default(null),
});

export const BindSslSchema = z.object({
  enabled: z.boolean().default(false),
  crtListRef: z.string().min(1).nullable().default(null),
  defaultCert: z.string().min(1).nullable().default(null),
  alpn: z.array(z.string().min(1)).default([]),
  ciphers: z.string().min(1).optional(),
  ciphersuites: z.string().min(1).optional(),
  sslMinVersion: z.enum(['TLSv1.2', 'TLSv1.3']).optional(),
  sslMaxVersion: z.enum(['TLSv1.2', 'TLSv1.3']).optional(),
  curves: z.string().min(1).optional(),
  noTlsTickets: z.boolean().default(false),
  preferClientCiphers: z.boolean().default(false),
  allow0rtt: z.boolean().default(false),
  strictSni: z.boolean().default(false),
  caTrustedCaId: IdSchema.optional(),
  verify: z.enum(['none', 'optional', 'required']).optional(),
  crlTrustedCrlId: IdSchema.optional(),
  crtIgnoreErrors: z.boolean().default(false),
  caIgnoreErrors: z.boolean().default(false),
  caVerifyTrustedCaId: IdSchema.optional(),
  noCaNames: z.boolean().default(false),
  sigalgs: z.string().min(1).optional(),
  clientSigalgs: z.string().min(1).optional(),
  ocspUpdateUri: z.string().min(1).optional(),
});

export const BindQuicSchema = z.object({
  ccAlgo: z.enum(['cubic', 'bbr', 'newreno', 'nocc']).optional(),
  ccAlgoWindow: QuicSizeSchema.optional(),
  forceRetry: z.boolean().default(false),
  socket: z.enum(['connection', 'listener']).optional(),
});

export const BindSchema = z.object({
  id: IdSchema,
  address: z.string().min(1),
  label: z.string().max(64).optional(),
  name: z.string().min(1).max(64).optional(),
  interface: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  transparent: z.boolean().default(false),
  acceptProxy: z.boolean().default(false),
  thread: z.string().min(1).optional(),
  shards: z.union([z.enum(['by-thread', 'by-group']), z.number().int().positive()]).optional(),
  backlog: z.number().int().positive().optional(),
  maxconn: z.number().int().positive().optional(),
  nice: z.number().int().min(-20).max(19).optional(),
  mss: z.number().int().positive().optional(),
  tcpUt: DurationSchema.optional(),
  tcpQuickAck: z.boolean().optional(),
  deferAccept: z.boolean().optional(),
  tfo: z.boolean().optional(),
  ipFamily: z.enum(['v4', 'v6', 'dual']).optional(),
  // Optional reference to state.keepalived.instances[].id. Metadata only —
  // does NOT change bind.address rendering. Tells the UI "this bind's
  // address is managed as a VRRP VIP" and informs keepalived.conf rendering.
  floatingIpInstanceId: IdSchema.nullable().default(null),
  ssl: BindSslSchema.default({}),
  quic: BindQuicSchema.default({}),
});

export const CaptureHeaderSchema = z.object({
  header: z.string().min(1).max(64),
  maxLen: z.number().int().min(8).max(2048).default(256),
});

export const CaptureCookieSchema = z.object({
  enabled: z.boolean().default(false),
  name: z.string().min(1).optional(),
  maxLen: z.number().int().min(8).max(2048).default(256),
});

export const HstsSchema = z.object({
  enabled: z.boolean().default(false),
  maxAge: z.number().int().min(0).default(16_000_000),
  includeSubdomains: z.boolean().default(true),
  preload: z.boolean().default(false),
});

export const CorsSchema = z.object({
  enabled: z.boolean().default(false),
  frameAncestors: z.string().nullable().default(null),
  allowOrigin: z.string().nullable().default(null),
  allowHeaders: z.string().nullable().default(null),
  allowMethods: z.string().nullable().default(null),
  allowCredentials: z.boolean().default(false),
  exposeHeaders: z.string().nullable().default(null),
  maxAge: z.number().int().min(0).optional(),
});

export const CompressionSchema = z.object({
  enabled: z.boolean().default(false),
  algorithm: z.enum(['gzip', 'deflate', 'raw-deflate']).default('gzip'),
  types: z
    .array(z.string().min(1))
    .default([
      'text/html',
      'text/css',
      'text/plain',
      'text/xml',
      'application/json',
      'application/javascript',
      'application/xml',
      'image/svg+xml',
    ]),
  offload: z.boolean().default(true),
});

export const ForwardForSchema = z.object({
  enabled: z.boolean().default(false),
  header: z.string().min(1).optional(),
  except: z.string().min(1).optional(),
  ifNone: z.boolean().default(false),
});

export const HttpH2TunablesSchema = z.object({
  maxConcurrentStreams: z.number().int().positive().optional(),
  maxHeaderListSize: z.number().int().positive().optional(),
  initialWindowSize: z.number().int().positive().optional(),
  maxRstAtOnce: z.number().int().positive().optional(),
  glitchesThreshold: z.number().int().positive().optional(),
  maxTotalStreams: z.number().int().positive().optional(),
  headerTableSize: z.number().int().positive().optional(),
  maxFrameSize: z.number().int().positive().optional(),
  logErrors: z.boolean().optional(),
});

// HttpOpts is typed UI sugar over fixed HAProxy directives that don't fit
// the Rule model (CORS/HSTS/compression are response policy; capture is
// log-side; forwardFor is one option line; etc.). Anything resembling a
// per-request decision belongs in frontend.rulePhases, not here.
export const HttpOptsSchema = z.object({
  defaultBackendId: IdSchema.nullable().default(null),
  hsts: HstsSchema.default({}),
  cors: CorsSchema.default({}),
  compression: CompressionSchema.default({}),
  captureRequestHeaders: z.array(CaptureHeaderSchema).default([]),
  captureResponseHeaders: z.array(CaptureHeaderSchema).default([]),
  captureCookie: CaptureCookieSchema.default({}),
  rateLimitSessions: z.number().int().positive().optional(),
  monitorUri: z.string().min(1).optional(),
  monitorFail: z.string().min(1).optional(),
  useErrorFilesId: IdSchema.nullable().default(null),
  errorFiles: z.record(z.string(), z.string()).default({}).transform(cleanErrorFilesMap),
  timeoutClient: DurationSchema.optional(),
  timeoutHttpRequest: DurationSchema.optional(),
  timeoutHttpKeepAlive: DurationSchema.optional(),
  timeoutClientFin: DurationSchema.optional(),
  httpLog: z.boolean().default(true),
  dontlogNull: z.boolean().default(false),
  dontlogNormal: z.boolean().default(false),
  logSeparateErrors: z.boolean().default(false),
  logTag: z.string().min(1).optional(),
  customLogFormat: z.string().min(1).optional(),
  forwardFor: ForwardForSchema.default({}),
  optionHttpKeepAlive: z.boolean().default(true),
  optionHttpServerClose: z.boolean().default(false),
  optionHttpTunnel: z.boolean().default(false),
  optionHttpIgnoreProbes: z.boolean().default(false),
  optionHttpBufferRequest: z.boolean().default(false),
  optionHttpProxy: z.boolean().default(false),
  optionHttpUseHtx: z.boolean().default(true),
  restrictReqHdrNames: z.enum(['preserve', 'delete', 'reject']).optional(),
  normalizeUri: z.array(z.string().min(1)).default([]),
  strictMode: z.boolean().optional(),
  optionLogasap: z.boolean().default(false),
  optionContstats: z.boolean().default(false),
  optionHttpPretendKeepalive: z.boolean().default(false),
  optionHttpNoDelay: z.boolean().default(false),
  optionOriginalto: z
    .object({
      enabled: z.boolean().default(false),
      header: z.string().min(1).optional(),
      except: z.string().min(1).optional(),
    })
    .default({}),
  optionSrvTcpKa: z.boolean().default(false),
  optionCliTcpKa: z.boolean().default(false),
  h2: HttpH2TunablesSchema.default({}),
});

export const SniRouterSchema = z.object({
  enabled: z.boolean().default(false),
  sniMap: z.array(z.object({ sniPattern: z.string().min(1), backendId: IdSchema })).default([]),
});

export const TrackScSchema = z.object({
  tableName: z.string().min(1),
  key: z.string().min(1),
});

// TcpOpts mirrors HttpOpts: typed UI sugar over the handful of tcp-mode
// frontend directives that aren't per-request rules. Per-request and
// per-response tcp rules live in frontend.rulePhases.
export const TcpOptsSchema = z.object({
  defaultBackendId: IdSchema.nullable().default(null),
  tcpLog: z.boolean().default(true),
  timeoutClient: DurationSchema.optional(),
  inspectDelay: DurationSchema.optional(),
  sniRouter: SniRouterSchema.default({}),
  trackSc0: TrackScSchema.optional(),
});

export const FrontendStatsSchema = z.object({
  enabled: z.boolean().default(false),
  uri: z.string().min(1).default('/'),
  realm: z.string().min(1).default('HAProxy Statistics'),
  refresh: z.number().int().positive().optional(),
  adminAclExpression: z.string().min(1).nullable().default(null),
  showLegends: z.boolean().default(true),
  showModules: z.boolean().default(false),
  showNodename: z.string().min(1).optional(),
  showDescription: z.string().min(1).optional(),
  auth: z.array(z.object({ username: z.string().min(1), password: z.string().min(1) })).default([]),
  prometheusExporter: z.boolean().default(false),
  prometheusPath: z.string().min(1).default('/metrics'),
  prometheusExtraCounters: z.boolean().default(false),
});

const FrontendSectionNameRegex = /^[a-zA-Z][a-zA-Z0-9_-]*$/u;

export const FrontendSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(64).regex(FrontendSectionNameRegex, 'HAProxy frontend section name'),
  description: z.string().max(256).optional(),
  enabled: z.boolean().default(true),
  mode: z.enum(['http', 'tcp']).default('http'),
  maxconn: z.number().int().positive().optional(),
  binds: z.array(BindSchema).min(1),
  fromDefaults: IdSchema,
  httpOpts: HttpOptsSchema.default({}),
  tcpOpts: TcpOptsSchema.default({}),
  stats: FrontendStatsSchema.default({}),
  useErrorFilesId: IdSchema.nullable().default(null),
  rulePhases: RulePhasesSchema.default({}),
});

export const FrontendsSchema = z.array(FrontendSchema).default([]);

const StateBaseSchema = z.object({
  schemaVersion: z.literal(1),
  meta: MetaSchema,
  letsencrypt: LetsEncryptSchema.default({}),
  tls: z
    .object({
      providers: z.array(TLSProviderSchema).default([]),
      certs: z.array(TLSCertSchema).default([]),
    })
    .default({}),
  globalSettings: GlobalSettingsSchema.default({}),
  defaultsBlocks: z.array(DefaultsBlockSchema).default([]),
  httpErrorsSections: z.array(HttpErrorsSectionSchema).default([]),
  acls: z.array(AclSchema).default([]),
  frontends: FrontendsSchema,
  resolvers: z.array(ResolverSchema).default([]),
  peers: z.array(PeerGroupSchema).default([]),
  mailers: z.array(MailerGroupSchema).default([]),
  rings: z.array(RingSchema).default([]),
  crtStores: z.array(CrtStoreSchema).default([]),
  maps: z.array(MapSchema).default([]),
  securityProfiles: z.array(SecurityProfileSchema).default([]),
  authProviders: z.array(AuthProviderSchema).default([]),
  acmeAccounts: z.array(AcmeAccountSchema).default([]),
  trustedCas: z.array(TrustedCASchema).default([]),
  trustedCrls: z.array(TrustedCRLSchema).default([]),
  backends: z.array(BackendSchema).default([]),
  notifications: NotificationsSchema.default({}),
  geoip: GeoIpSchema.default({}),
  keepalived: KeepalivedSchema.default({}),
  ui: UiSchema.default({}),
});

// =====================================================================
// Cross-reference integrity. Runs after per-field parsing succeeds.
// Catches dangling refs (frontend.fromDefaults pointing at a missing
// defaults block, a Rule referencing an ACL that doesn't exist, an
// `apply-security-profile` action whose profileId is gone, etc.) so
// the UI surfaces a precise error instead of letting `haproxy -c`
// reject the rendered cfg with a less actionable message.
// =====================================================================

const RULE_PHASE_KEYS = Object.freeze([
  'tcpRequestConnection',
  'tcpRequestSession',
  'tcpRequestContent',
  'httpRequest',
  'httpResponse',
  'httpAfterResponse',
  'tcpResponseContent',
]);

const addRefIssue = (ctx, path, message) => {
  ctx.addIssue({ code: 'custom', path, message });
};

const checkRef = (ctx, path, value, validSet, kind) => {
  if (value === null || value === undefined) {
    return;
  }
  if (!validSet.has(value)) {
    addRefIssue(ctx, path, `references unknown ${kind}: ${value}`);
  }
};

const checkUniqueBy = (ctx, basePath, arr, keyField, kind) => {
  const seen = new Set();
  for (let i = 0; i < arr.length; i += 1) {
    const key = arr[i][keyField];
    if (key === undefined || key === null) {
      continue;
    }
    if (seen.has(key)) {
      addRefIssue(ctx, [...basePath, i, keyField], `duplicate ${kind} ${keyField}: ${key}`);
    } else {
      seen.add(key);
    }
  }
};

const validateConditionAclRefs = (ctx, path, condition, aclNames) => {
  for (let i = 0; i < (condition ?? []).length; i += 1) {
    const term = condition[i];
    if (term.kind === 'aclRef') {
      checkRef(ctx, [...path, i, 'aclName'], term.aclName, aclNames, 'ACL');
    }
  }
};

const validateRuleAction = (ctx, path, action, refs) => {
  switch (action.type) {
    case 'use-backend':
      checkRef(ctx, [...path, 'backendId'], action.backendId, refs.backendIds, 'backend');
      break;
    case 'apply-security-profile':
      checkRef(ctx, [...path, 'profileId'], action.profileId, refs.profileIds, 'security profile');
      break;
    case 'apply-auth-provider':
      checkRef(
        ctx,
        [...path, 'providerId'],
        action.providerId,
        refs.authProviderIds,
        'auth provider'
      );
      break;
    default:
      break;
  }
};

const validateRulePhases = (ctx, frontendPath, rulePhases, refs) => {
  for (const phase of RULE_PHASE_KEYS) {
    const rules = rulePhases?.[phase] ?? [];
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      const rulePath = [...frontendPath, 'rulePhases', phase, i];
      validateConditionAclRefs(ctx, [...rulePath, 'condition'], rule.condition, refs.aclNames);
      validateRuleAction(ctx, [...rulePath, 'action'], rule.action, refs);
    }
  }
};

const validateBindTrustedCas = (ctx, path, fe, refs) => {
  const binds = fe.binds ?? [];
  for (let bi = 0; bi < binds.length; bi += 1) {
    const bindPath = [...path, 'binds', bi, 'ssl'];
    const { ssl } = binds[bi];
    if (!ssl) {
      continue;
    }
    checkRef(
      ctx,
      [...bindPath, 'caTrustedCaId'],
      ssl.caTrustedCaId,
      refs.trustedCaIds,
      'trusted CA'
    );
    checkRef(
      ctx,
      [...bindPath, 'caVerifyTrustedCaId'],
      ssl.caVerifyTrustedCaId,
      refs.trustedCaIds,
      'trusted CA'
    );
    checkRef(
      ctx,
      [...bindPath, 'crlTrustedCrlId'],
      ssl.crlTrustedCrlId,
      refs.trustedCrlIds,
      'trusted CRL'
    );
  }
};

const validateFrontend = (ctx, idx, fe, refs) => {
  const path = ['frontends', idx];
  checkRef(
    ctx,
    [...path, 'fromDefaults'],
    fe.fromDefaults,
    refs.defaultsBlockIds,
    'defaults block'
  );
  checkRef(
    ctx,
    [...path, 'useErrorFilesId'],
    fe.useErrorFilesId,
    refs.httpErrorsSectionIds,
    'http-errors section'
  );
  if (fe.httpOpts) {
    checkRef(
      ctx,
      [...path, 'httpOpts', 'defaultBackendId'],
      fe.httpOpts.defaultBackendId,
      refs.backendIds,
      'backend'
    );
    checkRef(
      ctx,
      [...path, 'httpOpts', 'useErrorFilesId'],
      fe.httpOpts.useErrorFilesId,
      refs.httpErrorsSectionIds,
      'http-errors section'
    );
  }
  if (fe.tcpOpts) {
    checkRef(
      ctx,
      [...path, 'tcpOpts', 'defaultBackendId'],
      fe.tcpOpts.defaultBackendId,
      refs.backendIds,
      'backend'
    );
    const sniMap = fe.tcpOpts.sniRouter?.sniMap ?? [];
    for (let si = 0; si < sniMap.length; si += 1) {
      checkRef(
        ctx,
        [...path, 'tcpOpts', 'sniRouter', 'sniMap', si, 'backendId'],
        sniMap[si].backendId,
        refs.backendIds,
        'backend'
      );
    }
  }
  validateBindTrustedCas(ctx, path, fe, refs);
  validateRulePhases(ctx, path, fe.rulePhases, refs);
};

const validateBackendServerCaRefs = (ctx, idx, backend, refs) => {
  const path = ['backends', idx];
  const servers = backend.servers ?? [];
  for (let si = 0; si < servers.length; si += 1) {
    checkRef(
      ctx,
      [...path, 'servers', si, 'caTrustedCaId'],
      servers[si].caTrustedCaId,
      refs.trustedCaIds,
      'trusted CA'
    );
  }
};

const validateAcmeAccount = (ctx, idx, acct, tupleSeen) => {
  if (acct.server === 'custom' && !acct.directoryUrl) {
    addRefIssue(
      ctx,
      ['acmeAccounts', idx, 'directoryUrl'],
      'directoryUrl is required when server is "custom"'
    );
  }
  if (acct.server !== 'custom' && acct.directoryUrl) {
    addRefIssue(
      ctx,
      ['acmeAccounts', idx, 'directoryUrl'],
      `directoryUrl must be empty when server is "${acct.server}" (CA URL is built in)`
    );
  }
  if (ACME_SERVERS_REQUIRING_EAB.has(acct.server) && (!acct.eabKid || !acct.eabHmacKey)) {
    addRefIssue(
      ctx,
      ['acmeAccounts', idx, 'eabKid'],
      `server "${acct.server}" requires External Account Binding — set both eabKid and eabHmacKey`
    );
  }
  if ((acct.eabKid && !acct.eabHmacKey) || (!acct.eabKid && acct.eabHmacKey)) {
    addRefIssue(
      ctx,
      ['acmeAccounts', idx, 'eabKid'],
      'eabKid and eabHmacKey must be set together (or both empty)'
    );
  }
  const tuple = `${acct.email}|${acct.server}|${acct.directoryUrl ?? ''}`;
  if (tupleSeen.has(tuple)) {
    addRefIssue(
      ctx,
      ['acmeAccounts', idx, 'email'],
      `duplicate ACME account: email "${acct.email}" on server "${acct.server}" already registered`
    );
  } else {
    tupleSeen.add(tuple);
  }
};

const validateCertRefs = (ctx, idx, cert, refs, providerTypeById) => {
  checkRef(
    ctx,
    ['tls', 'certs', idx, 'providerId'],
    cert.providerId,
    refs.tlsProviderIds,
    'TLS provider'
  );
  const providerType = providerTypeById.get(cert.providerId);
  if (providerType === 'byo') {
    return;
  }
  if (!cert.acmeAccountId) {
    addRefIssue(
      ctx,
      ['tls', 'certs', idx, 'acmeAccountId'],
      'acmeAccountId is required for certs using an ACME provider'
    );
    return;
  }
  checkRef(
    ctx,
    ['tls', 'certs', idx, 'acmeAccountId'],
    cert.acmeAccountId,
    refs.acmeAccountIds,
    'ACME account'
  );
};

// Uniqueness checks within each top-level collection. Schema parsing accepts
// duplicates; we surface them here so the UI can point at the offender.
const checkTopLevelUniqueness = (state, ctx) => {
  checkUniqueBy(ctx, ['defaultsBlocks'], state.defaultsBlocks, 'id', 'defaults block');
  checkUniqueBy(ctx, ['defaultsBlocks'], state.defaultsBlocks, 'name', 'defaults block');
  checkUniqueBy(ctx, ['httpErrorsSections'], state.httpErrorsSections, 'id', 'http-errors section');
  checkUniqueBy(
    ctx,
    ['httpErrorsSections'],
    state.httpErrorsSections,
    'name',
    'http-errors section'
  );
  checkUniqueBy(ctx, ['acls'], state.acls, 'id', 'ACL');
  checkUniqueBy(ctx, ['acls'], state.acls, 'name', 'ACL');
  checkUniqueBy(ctx, ['frontends'], state.frontends, 'id', 'frontend');
  checkUniqueBy(ctx, ['frontends'], state.frontends, 'name', 'frontend');
  checkUniqueBy(ctx, ['backends'], state.backends, 'id', 'backend');
  checkUniqueBy(ctx, ['backends'], state.backends, 'name', 'backend');
  checkUniqueBy(ctx, ['tls', 'providers'], state.tls.providers, 'id', 'TLS provider');
  checkUniqueBy(ctx, ['tls', 'certs'], state.tls.certs, 'id', 'cert');
  checkUniqueBy(ctx, ['tls', 'certs'], state.tls.certs, 'certName', 'cert');
  checkUniqueBy(ctx, ['authProviders'], state.authProviders, 'id', 'auth provider');
  checkUniqueBy(ctx, ['acmeAccounts'], state.acmeAccounts, 'id', 'ACME account');
  checkUniqueBy(ctx, ['trustedCas'], state.trustedCas, 'id', 'trusted CA');
  checkUniqueBy(ctx, ['trustedCas'], state.trustedCas, 'name', 'trusted CA');
  checkUniqueBy(ctx, ['trustedCrls'], state.trustedCrls, 'id', 'trusted CRL');
  checkUniqueBy(ctx, ['trustedCrls'], state.trustedCrls, 'name', 'trusted CRL');
  checkUniqueBy(ctx, ['securityProfiles'], state.securityProfiles, 'id', 'security profile');
  checkUniqueBy(ctx, ['resolvers'], state.resolvers, 'id', 'resolver');
  checkUniqueBy(ctx, ['peers'], state.peers, 'id', 'peer group');
  checkUniqueBy(ctx, ['mailers'], state.mailers, 'id', 'mailer group');
  checkUniqueBy(ctx, ['rings'], state.rings, 'id', 'ring');
  checkUniqueBy(ctx, ['crtStores'], state.crtStores, 'id', 'crt-store');
  checkUniqueBy(ctx, ['maps'], state.maps, 'id', 'map');
};

// Per-rule duplicate-id check inside each frontend's rulePhases. Rule ids
// are scoped per (frontend, phase); UI relies on (frontendId, phase, ruleId)
// being a stable composite key.
const checkRuleUniqueness = (state, ctx) => {
  for (let fi = 0; fi < state.frontends.length; fi += 1) {
    const fe = state.frontends[fi];
    for (const phase of RULE_PHASE_KEYS) {
      const rules = fe.rulePhases?.[phase] ?? [];
      checkUniqueBy(ctx, ['frontends', fi, 'rulePhases', phase], rules, 'id', 'rule');
    }
  }
};

const buildRefSets = state => ({
  defaultsBlockIds: new Set(state.defaultsBlocks.map(b => b.id)),
  httpErrorsSectionIds: new Set(state.httpErrorsSections.map(s => s.id)),
  aclNames: new Set(state.acls.map(a => a.name)),
  backendIds: new Set(state.backends.map(b => b.id)),
  tlsProviderIds: new Set(state.tls.providers.map(p => p.id)),
  profileIds: new Set(state.securityProfiles.map(p => p.id)),
  authProviderIds: new Set(state.authProviders.map(p => p.id)),
  acmeAccountIds: new Set(state.acmeAccounts.map(a => a.id)),
  trustedCaIds: new Set(state.trustedCas.map(t => t.id)),
  trustedCrlIds: new Set(state.trustedCrls.map(t => t.id)),
  keepalivedInstanceIds: new Set((state.keepalived?.instances ?? []).map(i => i.id)),
  keepalivedTrackScriptIds: new Set((state.keepalived?.trackScripts ?? []).map(s => s.id)),
  keepalivedSyncGroupIds: new Set((state.keepalived?.syncGroups ?? []).map(g => g.id)),
});

const checkKeepalivedUniqueness = (state, ctx) => {
  const instances = state.keepalived?.instances ?? [];
  const syncGroups = state.keepalived?.syncGroups ?? [];
  const trackScripts = state.keepalived?.trackScripts ?? [];
  checkUniqueBy(ctx, ['keepalived', 'instances'], instances, 'id', 'keepalived instance');
  checkUniqueBy(ctx, ['keepalived', 'instances'], instances, 'name', 'keepalived instance');
  checkUniqueBy(
    ctx,
    ['keepalived', 'instances'],
    instances,
    'virtualRouterId',
    'keepalived virtualRouterId'
  );
  checkUniqueBy(ctx, ['keepalived', 'syncGroups'], syncGroups, 'id', 'keepalived sync_group');
  checkUniqueBy(ctx, ['keepalived', 'syncGroups'], syncGroups, 'name', 'keepalived sync_group');
  checkUniqueBy(ctx, ['keepalived', 'trackScripts'], trackScripts, 'id', 'keepalived track_script');
};

const checkKeepalivedInstanceRefs = (state, ctx, refs) => {
  const instances = state.keepalived?.instances ?? [];
  for (let i = 0; i < instances.length; i += 1) {
    const inst = instances[i];
    if (inst.syncGroupId) {
      checkRef(
        ctx,
        ['keepalived', 'instances', i, 'syncGroupId'],
        inst.syncGroupId,
        refs.keepalivedSyncGroupIds,
        'keepalived sync_group'
      );
    }
    const trackIds = inst.trackScriptIds ?? [];
    for (let ti = 0; ti < trackIds.length; ti += 1) {
      checkRef(
        ctx,
        ['keepalived', 'instances', i, 'trackScriptIds', ti],
        trackIds[ti],
        refs.keepalivedTrackScriptIds,
        'keepalived track_script'
      );
    }
  }
};

const checkKeepalivedSyncGroupRefs = (state, ctx, refs) => {
  const syncGroups = state.keepalived?.syncGroups ?? [];
  for (let i = 0; i < syncGroups.length; i += 1) {
    const grp = syncGroups[i];
    const instanceIds = grp.instanceIds ?? [];
    for (let ii = 0; ii < instanceIds.length; ii += 1) {
      checkRef(
        ctx,
        ['keepalived', 'syncGroups', i, 'instanceIds', ii],
        instanceIds[ii],
        refs.keepalivedInstanceIds,
        'keepalived instance'
      );
    }
  }
};

// bind.floatingIpInstanceId → keepalived.instances[].id
const checkBindFloatingIpRefs = (state, ctx, refs) => {
  for (let fi = 0; fi < state.frontends.length; fi += 1) {
    const fe = state.frontends[fi];
    const binds = fe.binds ?? [];
    for (let bi = 0; bi < binds.length; bi += 1) {
      const bind = binds[bi];
      if (bind.floatingIpInstanceId) {
        checkRef(
          ctx,
          ['frontends', fi, 'binds', bi, 'floatingIpInstanceId'],
          bind.floatingIpInstanceId,
          refs.keepalivedInstanceIds,
          'keepalived instance'
        );
      }
    }
  }
};

const checkAcmeAccounts = (state, ctx) => {
  const seen = new Set();
  for (let i = 0; i < state.acmeAccounts.length; i += 1) {
    validateAcmeAccount(ctx, i, state.acmeAccounts[i], seen);
  }
};

const checkDefaultsBlocksRefs = (state, ctx, refs) => {
  for (let i = 0; i < state.defaultsBlocks.length; i += 1) {
    checkRef(
      ctx,
      ['defaultsBlocks', i, 'useErrorFilesId'],
      state.defaultsBlocks[i].useErrorFilesId,
      refs.httpErrorsSectionIds,
      'http-errors section'
    );
  }
};

const checkCertProviderRefs = (state, ctx, refs) => {
  const providerTypeById = new Map(state.tls.providers.map(p => [p.id, p.type]));
  for (let i = 0; i < state.tls.certs.length; i += 1) {
    validateCertRefs(ctx, i, state.tls.certs[i], refs, providerTypeById);
  }
};

const checkFrontendRefs = (state, ctx, refs) => {
  for (let i = 0; i < state.frontends.length; i += 1) {
    validateFrontend(ctx, i, state.frontends[i], refs);
  }
};

const checkBackendRefs = (state, ctx, refs) => {
  for (let i = 0; i < state.backends.length; i += 1) {
    validateBackendServerCaRefs(ctx, i, state.backends[i], refs);
  }
};

const SIDECAR_AUTH_KINDS = new Set(['authelia', 'ldap', 'saml', 'entra', 'jwt-verify']);

const checkAuthProviderRefs = (state, ctx, refs) => {
  for (let i = 0; i < state.authProviders.length; i += 1) {
    const provider = state.authProviders[i];
    if (SIDECAR_AUTH_KINDS.has(provider.type)) {
      checkRef(
        ctx,
        ['authProviders', i, 'config', 'authRequestBackendId'],
        provider.config?.authRequestBackendId,
        refs.backendIds,
        'backend'
      );
    }
  }
};

export const StateSchema = StateBaseSchema.superRefine((state, ctx) => {
  checkTopLevelUniqueness(state, ctx);
  checkRuleUniqueness(state, ctx);
  checkKeepalivedUniqueness(state, ctx);
  const refs = buildRefSets(state);
  checkKeepalivedInstanceRefs(state, ctx, refs);
  checkKeepalivedSyncGroupRefs(state, ctx, refs);
  checkBindFloatingIpRefs(state, ctx, refs);
  checkAcmeAccounts(state, ctx);
  checkDefaultsBlocksRefs(state, ctx, refs);
  checkCertProviderRefs(state, ctx, refs);
  checkFrontendRefs(state, ctx, refs);
  checkBackendRefs(state, ctx, refs);
  checkAuthProviderRefs(state, ctx, refs);
});

export const validateState = stateObj => {
  const result = StateSchema.safeParse(stateObj);
  if (!result.success) {
    return { ok: false, issues: result.error.issues };
  }
  return { ok: true, data: result.data };
};

export const emptyState = () => {
  const now = new Date().toISOString();
  return StateSchema.parse({
    schemaVersion: 1,
    meta: { createdAt: now, lastEditedAt: now, lastEditedBy: null },
    letsencrypt: {},
    tls: { providers: [], certs: [] },
    globalSettings: {},
    defaultsBlocks: [],
    httpErrorsSections: [],
    acls: [],
    frontends: [],
    resolvers: [],
    peers: [],
    mailers: [],
    rings: [],
    crtStores: [],
    maps: [],
    securityProfiles: [],
    authProviders: [],
    acmeAccounts: [],
    trustedCas: [],
    trustedCrls: [],
    backends: [],
    notifications: {},
    geoip: {},
    keepalived: {},
    ui: {},
  });
};
