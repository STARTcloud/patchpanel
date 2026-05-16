import { join as joinPath } from 'node:path';

import { resolveSslConfig } from './ssl-profiles.js';

// Resolve a trustedCaId (state ref) to its on-disk PEM path. Returns
// undefined when the id is absent, so callers can pass straight to pushKv()
// without an explicit null check.
const resolveTrustedCaPath = (trustedCaId, trustedCasDir) => {
  if (!trustedCaId || !trustedCasDir) {
    return undefined;
  }
  return joinPath(trustedCasDir, `${trustedCaId}.pem`);
};

const resolveTrustedCrlPath = (trustedCrlId, trustedCrlsDir) => {
  if (!trustedCrlId || !trustedCrlsDir) {
    return undefined;
  }
  return joinPath(trustedCrlsDir, `${trustedCrlId}.pem`);
};

const NL = '\n';

const indent = (line, depth = 1) => `${'    '.repeat(depth)}${line}`;
const section = (title, lines) => [title, ...lines.map(line => indent(line))].join(NL);
const joinNonEmpty = parts => parts.filter(Boolean).join(`${NL}${NL}`);

const TLS_VERSION_ORDER = Object.freeze(['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);
const TLS_VERSION_TO_NO_FLAG = Object.freeze({
  'TLSv1.0': 'no-tlsv10',
  'TLSv1.1': 'no-tlsv11',
  'TLSv1.2': 'no-tlsv12',
  'TLSv1.3': 'no-tlsv13',
});

const computeTlsVersionOptions = enabledVersions => {
  if (!enabledVersions || enabledVersions.length === 0) {
    return [];
  }
  const enabled = new Set(enabledVersions);
  const indices = TLS_VERSION_ORDER.map((v, i) => ({ v, i })).filter(({ v }) => enabled.has(v));
  if (indices.length === 0) {
    return [];
  }
  const [min] = indices;
  const max = indices[indices.length - 1];
  const out = [`ssl-min-ver ${min.v}`, `ssl-max-ver ${max.v}`];
  for (let i = min.i + 1; i < max.i; i += 1) {
    const between = TLS_VERSION_ORDER[i];
    if (!enabled.has(between)) {
      out.push(TLS_VERSION_TO_NO_FLAG[between]);
    }
  }
  return out;
};

const buildSideOptions = side => {
  const versionOpts = computeTlsVersionOptions(side.enabledVersions ?? []);
  const userOpts = side.options ?? [];
  return [...versionOpts, ...userOpts];
};

const renderSslTuneLines = tune => {
  const out = [`tune.ssl.default-dh-param ${tune.defaultDhParam}`];
  if (tune.cachesize !== undefined) {
    out.push(`tune.ssl.cachesize ${tune.cachesize}`);
  }
  if (tune.lifetime !== undefined) {
    out.push(`tune.ssl.lifetime ${tune.lifetime}`);
  }
  if (tune.maxrecord !== undefined) {
    out.push(`tune.ssl.maxrecord ${tune.maxrecord}`);
  }
  if (tune.forcePrivateCache === true) {
    out.push('tune.ssl.force-private-cache');
  }
  if (tune.captureBufferSize !== undefined) {
    out.push(`tune.ssl.capture-buffer-size ${tune.captureBufferSize}`);
  }
  if (tune.numAsync !== undefined) {
    out.push(`tune.ssl.async ${tune.numAsync}`);
  }
  if (tune.keylog === true) {
    out.push('tune.ssl.keylog on');
  }
  return out;
};

const renderSslSideLines = (side, prefix) => {
  const out = [];
  const ciphers = (side.ciphers ?? []).join(':');
  if (ciphers.length > 0) {
    out.push(`ssl-default-${prefix}-ciphers ${ciphers}`);
  }
  const ciphersuites = (side.ciphersuites ?? []).join(':');
  if (ciphersuites.length > 0) {
    out.push(`ssl-default-${prefix}-ciphersuites ${ciphersuites}`);
  }
  const curves = (side.curves ?? []).join(':');
  if (curves.length > 0) {
    out.push(`ssl-default-${prefix}-curves ${curves}`);
  }
  const sigalgs = (side.sigalgs ?? []).join(':');
  if (sigalgs.length > 0) {
    out.push(`ssl-default-${prefix}-sigalgs ${sigalgs}`);
  }
  const clientSigalgs = (side.clientSigalgs ?? []).join(':');
  if (clientSigalgs.length > 0) {
    out.push(`ssl-default-${prefix}-client-sigalgs ${clientSigalgs}`);
  }
  const opts = buildSideOptions(side);
  if (opts.length > 0) {
    out.push(`ssl-default-${prefix}-options ${opts.join(' ')}`);
  }
  return out;
};

const renderSslGlobalLines = ssl => {
  const resolved = resolveSslConfig(ssl);
  const out = [
    ...renderSslTuneLines(resolved.tune),
    ...renderSslSideLines(resolved.bind, 'bind'),
    ...renderSslSideLines(resolved.server, 'server'),
  ];
  if (resolved.loadExtraFiles.extraFiles.length > 0) {
    out.push(`ssl-load-extra-files ${resolved.loadExtraFiles.extraFiles.join(' ')}`);
  }
  if (resolved.loadExtraFiles.deleteExtensions === true) {
    out.push('ssl-load-extra-del-ext');
  }
  return out;
};

const RULE_PHASE_KEYS = Object.freeze([
  'tcpRequestConnection',
  'tcpRequestSession',
  'tcpRequestContent',
  'httpRequest',
  'httpResponse',
  'httpAfterResponse',
  'tcpResponseContent',
]);

const computeEffectiveMaxconn = (requested, fdHardLimit) => {
  const fdReserve = 256;
  const ceiling = Math.max(1, Math.floor((fdHardLimit - fdReserve) / 2));
  return Math.min(requested, ceiling);
};

const isQuicAddress = address =>
  typeof address === 'string' && (address.startsWith('quic4@') || address.startsWith('quic6@'));

const canonicalHeaderCase = header =>
  header
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('-');

// =====================================================================
// global section
// =====================================================================

const renderQuicGlobalTuning = state => {
  const lines = [];
  for (const fe of state.frontends ?? []) {
    if (!fe.enabled) {
      continue;
    }
    for (const bind of fe.binds ?? []) {
      if (!isQuicAddress(bind.address)) {
        continue;
      }
      const q = bind.quic ?? {};
      if (q.ccAlgo) {
        lines.push(`tune.quic.frontend.cc-algo ${q.ccAlgo}`);
      }
      if (q.maxStreams !== undefined) {
        lines.push(`tune.quic.frontend.max-streams-bidi ${q.maxStreams}`);
      }
      if (q.socketMode) {
        lines.push(`tune.quic.socket-owner ${q.socketMode}`);
      }
    }
  }
  return [...new Set(lines)];
};

// Lua plugin paths needed by `apply-auth-provider` rules pointing at
// lua-auth providers. The user-created Rule entity is what causes the
// global `lua-load` line to appear, so this still traces back to one.
const collectLuaAuthProviderPlugins = indexes => {
  const out = new Map();
  for (const providerId of indexes.referencedAuthProviderIds) {
    const provider = indexes.authProviderById.get(providerId);
    if (!provider || provider.type !== 'lua-auth') {
      continue;
    }
    out.set(provider.config.pluginPath, provider.config);
  }
  return [...out.values()];
};

const renderGlobal = (state, indexes) => {
  const { globalSettings } = state;
  const effectiveMaxconn = computeEffectiveMaxconn(
    globalSettings.maxconn,
    globalSettings.fdHardLimit
  );
  const lines = [
    `log stdout format raw local0 ${globalSettings.logLevel}`,
    'no strict-limits',
    `tune.bufsize ${globalSettings.tuneBufsize}`,
    `maxconn ${effectiveMaxconn}`,
    `fd-hard-limit ${globalSettings.fdHardLimit}`,
    `hard-stop-after ${globalSettings.hardStopAfter}`,
    'stats socket /var/lib/haproxy/stats level admin mode 660 group haproxy expose-fd listeners',
    'stats timeout 30s',
    'ca-base /etc/ssl/certs',
    'crt-base /etc/ssl/private',
    ...renderSslGlobalLines(globalSettings.ssl),
  ];

  lines.push(...renderQuicGlobalTuning(state));

  const luaAuthPlugins = collectLuaAuthProviderPlugins(indexes);
  if (globalSettings.luaPlugins.length > 0 || luaAuthPlugins.length > 0) {
    lines.push('tune.lua.bool-sample-conversion normal');
  }
  for (const plugin of globalSettings.luaPlugins) {
    if (plugin.prependPath) {
      lines.push(`lua-prepend-path ${plugin.prependPath}/?/http.lua`);
    }
    lines.push(`lua-load ${plugin.path}`);
  }
  const emittedLuaPaths = new Set(globalSettings.luaPlugins.map(p => p.path));
  for (const plugin of luaAuthPlugins) {
    if (emittedLuaPaths.has(plugin.pluginPath)) {
      continue;
    }
    if (plugin.prependPath) {
      lines.push(`lua-prepend-path ${plugin.prependPath}/?/http.lua`);
    }
    lines.push(`lua-load ${plugin.pluginPath}`);
    emittedLuaPaths.add(plugin.pluginPath);
  }
  for (const directive of globalSettings.advancedDirectives) {
    lines.push(directive);
  }

  return section('global', lines);
};

// =====================================================================
// resolvers / peers / mailers / rings / crt-stores / http-errors sections
// =====================================================================

const renderResolvers = state => {
  const userResolvers = state.resolvers ?? [];
  if (userResolvers.some(r => r.name === 'docker')) {
    return '';
  }
  return section('resolvers docker', ['nameserver dns "127.0.0.11:53"']);
};

const renderOneResolver = resolver => {
  const lines = resolver.nameservers.map(n => `nameserver ${n.name} "${n.address}"`);
  if (resolver.acceptedPayloadSize !== undefined) {
    lines.push(`accepted_payload_size ${resolver.acceptedPayloadSize}`);
  }
  if (resolver.holdValid) {
    lines.push(`hold valid ${resolver.holdValid}`);
  }
  if (resolver.holdObsolete) {
    lines.push(`hold obsolete ${resolver.holdObsolete}`);
  }
  if (resolver.holdNx) {
    lines.push(`hold nx ${resolver.holdNx}`);
  }
  if (resolver.timeoutResolve) {
    lines.push(`timeout resolve ${resolver.timeoutResolve}`);
  }
  if (resolver.timeoutRetry) {
    lines.push(`timeout retry ${resolver.timeoutRetry}`);
  }
  if (resolver.resolveRetries !== undefined) {
    lines.push(`resolve_retries ${resolver.resolveRetries}`);
  }
  return section(`resolvers ${resolver.name}`, lines);
};

const renderOnePeerGroup = group =>
  section(
    `peers ${group.name}`,
    group.peers.map(p => `peer ${p.name} ${p.address}`)
  );

const renderOneMailerGroup = group => {
  const lines = [];
  if (group.timeout) {
    lines.push(`timeout mail ${group.timeout}`);
  }
  for (const m of group.mailers) {
    lines.push(`mailer ${m.name} ${m.address}`);
  }
  return section(`mailers ${group.name}`, lines);
};

const renderOneRing = ring => {
  const lines = [];
  if (ring.description) {
    lines.push(`description "${ring.description}"`);
  }
  if (ring.format) {
    lines.push(`format ${ring.format}`);
  }
  if (ring.maxlen !== undefined) {
    lines.push(`maxlen ${ring.maxlen}`);
  }
  if (ring.size !== undefined) {
    lines.push(`size ${ring.size}`);
  }
  if (ring.timeoutConnect) {
    lines.push(`timeout connect ${ring.timeoutConnect}`);
  }
  if (ring.timeoutServer) {
    lines.push(`timeout server ${ring.timeoutServer}`);
  }
  for (const s of ring.servers) {
    lines.push(`server ${s.name} ${s.address}`);
  }
  return section(`ring ${ring.name}`, lines);
};

const renderOneCrtStore = store => {
  const lines = [];
  if (store.crtBase) {
    lines.push(`crt-base ${store.crtBase}`);
  }
  if (store.keyBase) {
    lines.push(`key-base ${store.keyBase}`);
  }
  for (const entry of store.loadEntries) {
    const parts = [`load crt "${entry.crt}"`];
    if (entry.key) {
      parts.push(`key "${entry.key}"`);
    }
    if (entry.alias) {
      parts.push(`alias ${entry.alias}`);
    }
    if (entry.acme) {
      parts.push(`acme ${entry.acme}`);
    }
    lines.push(parts.join(' '));
  }
  return section(`crt-store ${store.name}`, lines);
};

const renderOneHttpErrorsSection = entry => {
  const lines = [];
  for (const [code, path] of Object.entries(entry.errorFiles ?? {})) {
    lines.push(`errorfile ${code} ${path}`);
  }
  if (lines.length === 0) {
    lines.push('# (no errorfiles configured for this section)');
  }
  return section(`http-errors ${entry.name}`, lines);
};

const resolveErrorFilesSectionName = (state, id) => {
  if (!id) {
    return null;
  }
  const found = (state.httpErrorsSections ?? []).find(s => s.id === id);
  return found ? found.name : null;
};

// =====================================================================
// defaults block (one section per state.defaultsBlocks entry)
// =====================================================================

const renderDefaultsLogFormat = () =>
  'log-format "{\\"ts\\":\\"%[date,http_date]\\",\\"client_ip\\":\\"%ci\\",\\"client_port\\":%cp,' +
  '\\"frontend\\":\\"%ft\\",\\"backend\\":\\"%b\\",\\"server\\":\\"%s\\",' +
  '\\"method\\":\\"%HM\\",\\"uri\\":\\"%HU\\",\\"http_version\\":\\"%HV\\",' +
  '\\"status\\":%ST,\\"bytes_read\\":%B,\\"req_time_ms\\":%Tq,\\"queue_time_ms\\":%Tw,' +
  '\\"connect_time_ms\\":%Tc,\\"response_time_ms\\":%Tr,\\"total_time_ms\\":%Tt,' +
  '\\"termination\\":\\"%tsc\\",\\"actconn\\":%ac,\\"feconn\\":%fc,\\"beconn\\":%bc,' +
  '\\"srvconn\\":%sc,\\"retries\\":%rc,\\"srv_queue\\":%sq,\\"backend_queue\\":%bq,' +
  '\\"unique_id\\":\\"%ID\\",\\"user_agent\\":\\"%[capture.req.hdr(0)]\\"}"';

const renderHttpErrorDirective = directive => {
  const parts = [`http-error status ${directive.status}`];
  if (directive.contentType) {
    parts.push(`content-type "${directive.contentType}"`);
  }
  if (directive.lfFile) {
    parts.push(`lf-file ${directive.lfFile}`);
  }
  if (directive.lfString) {
    parts.push(`lf-string "${directive.lfString}"`);
  }
  return parts.join(' ');
};

const renderOneDefaultsBlock = (block, state) => {
  const { timeouts } = block;
  const { globalSettings } = state;
  const lines = ['log global'];

  const initAddr = block.defaultServer?.initAddr ?? [];
  if (initAddr.length > 0) {
    lines.push(`default-server init-addr ${initAddr.join(',')}`);
  }

  lines.push(
    `mode ${block.mode}`,
    `retries ${block.retries}`,
    `timeout http-request ${timeouts.httpRequest}`,
    `timeout queue ${timeouts.queue}`,
    `timeout connect ${timeouts.connect}`,
    `timeout client ${timeouts.client}`,
    `timeout server ${timeouts.server}`,
    `timeout http-keep-alive ${timeouts.httpKeepAlive}`,
    `timeout check ${timeouts.check}`,
    `timeout client-fin ${timeouts.clientFin}`,
    `timeout tunnel ${timeouts.tunnel}`
  );

  const skipHttpLog = globalSettings.jsonLogFormat === true;
  for (const opt of block.options) {
    if (skipHttpLog && opt === 'httplog') {
      continue;
    }
    lines.push(`option ${opt}`);
  }
  if (block.dontlogNormal) {
    lines.push('option dontlog-normal');
  }

  const CANONICAL_UNIQUE_ID = '%{+X}o\\ %ci:%cp_%fi:%fp_%Ts_%rt:%pid';
  const configuredUniqueId = globalSettings.uniqueIdFormat ?? '';
  const safeUniqueId = configuredUniqueId.includes(',file(')
    ? CANONICAL_UNIQUE_ID
    : configuredUniqueId;
  if (safeUniqueId) {
    lines.push(`unique-id-format ${safeUniqueId}`);
  }
  if (globalSettings.uniqueIdHeader) {
    lines.push(`unique-id-header ${globalSettings.uniqueIdHeader}`);
  }
  if (globalSettings.jsonLogFormat) {
    lines.push(renderDefaultsLogFormat());
  }
  for (const [code, path] of Object.entries(block.errorFiles)) {
    lines.push(`errorfile ${code} ${path}`);
  }
  for (const directive of block.httpErrors ?? []) {
    lines.push(renderHttpErrorDirective(directive));
  }
  const errorFilesName = resolveErrorFilesSectionName(state, block.useErrorFilesId);
  if (errorFilesName) {
    lines.push(`errorfiles ${errorFilesName}`);
  }
  for (const directive of block.advancedDirectives) {
    lines.push(directive);
  }
  return section(`defaults ${block.name}`, lines);
};

// =====================================================================
// ACLs + condition rendering
// =====================================================================

const FETCH_INTRINSIC_OPERATOR = Object.freeze({
  method: 'str',
});

const isRedundantOperator = (fieldName, operator) =>
  FETCH_INTRINSIC_OPERATOR[fieldName] === operator;

const renderAclLine = acl => {
  const parts = ['acl', acl.name];
  let { field } = acl;
  if (acl.fieldArg) {
    field += `(${acl.fieldArg})`;
  }
  parts.push(field);
  if (acl.operator && acl.operator !== 'bool' && !isRedundantOperator(acl.field, acl.operator)) {
    parts.push(`-m ${acl.operator}`);
  }
  if (acl.caseInsensitive) {
    parts.push('-i');
  }
  if (acl.noDnsLookup) {
    parts.push('-n');
  }
  if (acl.values && acl.values.length > 0) {
    parts.push(...acl.values);
  }
  return parts.join(' ');
};

const renderInlineMatcher = (term, withBraces = true) => {
  const parts = [];
  let { field } = term;
  if (term.fieldArg) {
    field += `(${term.fieldArg})`;
  }
  parts.push(field);
  if (
    term.operator &&
    term.operator !== 'bool' &&
    !isRedundantOperator(term.field, term.operator)
  ) {
    parts.push(`-m ${term.operator}`);
  }
  if (term.caseInsensitive) {
    parts.push('-i');
  }
  if (term.noDnsLookup) {
    parts.push('-n');
  }
  if (term.values && term.values.length > 0) {
    parts.push(...term.values);
  }
  const body = parts.join(' ');
  return withBraces ? `{ ${body} }` : body;
};

const renderConditionTerm = term => {
  if (term.kind === 'aclRef') {
    return term.negate ? `!${term.aclName}` : term.aclName;
  }
  const body = renderInlineMatcher(term);
  return term.negate ? `!${body}` : body;
};

const renderCondition = condition => {
  if (!condition || condition.length === 0) {
    return '';
  }
  let out = renderConditionTerm(condition[0]);
  for (let i = 1; i < condition.length; i += 1) {
    const join = condition[i - 1].combineWithNext === 'or' ? ' || ' : ' ';
    out += join + renderConditionTerm(condition[i]);
  }
  return out;
};

const renderConditionIfClause = condition => {
  const expr = renderCondition(condition);
  return expr ? ` if ${expr}` : '';
};

// HAProxy condition grammar has TWO traps we have to design around:
//   1. AND binds tighter than OR. `a || b c` parses as `a OR (b AND c)`, not
//      `(a OR b) AND c` (HAProxy 3.x manual §7.2 / src/acl.c "term suites").
//   2. Parentheses are NOT supported for grouping — `(a || b)` is parsed as
//      a single ACL name `(a` and rejected with "no such ACL".
//
// So when a sugar action needs to AND extra inline matchers onto a user's
// OR'd condition, we can't just append `extras` at the end (precedence flips
// the meaning for all but the last OR-group) and we can't paren-wrap (parse
// error). We distribute the extras across each OR-group instead:
//
//   user: `a || b || c`, extras: `[!e]`
//   → emit: `if a !e || b !e || c !e`
//   HAProxy parses: (a AND !e) OR (b AND !e) OR (c AND !e)
//   = (a OR b OR c) AND !e  ← what the user asked for
//
// `splitConditionByOr` walks the user's condition and breaks it on `or`
// joins, returning each AND-group separately. `renderConditionAndGroup`
// joins terms in one group with the implicit-AND space.
const splitConditionByOr = condition => {
  const groups = [];
  let current = [];
  for (let i = 0; i < (condition?.length ?? 0); i += 1) {
    current.push(condition[i]);
    const isLast = i === condition.length - 1;
    if (!isLast && condition[i].combineWithNext === 'or') {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
};

const renderConditionAndGroup = group => group.map(renderConditionTerm).join(' ');

const buildAppendClause = (condition, extras) => {
  const tail = extras.join(' ');
  if (!condition || condition.length === 0) {
    return tail ? ` if ${tail}` : '';
  }
  if (!tail) {
    return ` if ${renderCondition(condition)}`;
  }
  const groups = splitConditionByOr(condition);
  const distributed = groups.map(g => `${renderConditionAndGroup(g)} ${tail}`).join(' || ');
  return ` if ${distributed}`;
};

// =====================================================================
// Shared action-arg renderers (used across phases).
// =====================================================================

const renderSetVarArgs = action => `set-var(${action.scope}.${action.name}) ${action.expression}`;
const renderUnsetVarArgs = action => `unset-var(${action.scope}.${action.name})`;
const renderTrackScArgs = action => `track-sc${action.scIndex} ${action.key} table ${action.table}`;
const renderLuaArgs = action => {
  const args = (action.args ?? []).length > 0 ? ` ${action.args.join(' ')}` : '';
  return `lua.${action.function}${args}`;
};
const renderScIncGpcArgs = action => `sc-inc-gpc${action.gpcIndex}(${action.scIndex})`;

const renderReturnArgs = action => {
  const parts = ['return'];
  if (action.statusCode !== undefined) {
    parts.push('status', String(action.statusCode));
  }
  if (action.contentType) {
    parts.push('content-type', `"${action.contentType}"`);
  }
  if (action.body) {
    parts.push(action.body.kind, `"${action.body.content}"`);
  }
  for (const hdr of action.headers ?? []) {
    parts.push('hdr', hdr.name, `"${hdr.value}"`);
  }
  return parts.join(' ');
};

const renderRedirectArgs = action => {
  const parts = ['redirect', action.redirectType, action.target];
  if (action.code !== undefined) {
    parts.push('code', String(action.code));
  }
  if (action.dropQueryString) {
    parts.push('drop-query');
  }
  if (action.appendSlash) {
    parts.push('append-slash');
  }
  if (action.setCookie) {
    parts.push('set-cookie', action.setCookie);
  }
  if (action.clearCookie) {
    parts.push('clear-cookie', action.clearCookie);
  }
  return parts.join(' ');
};

const renderNormalizeUriArgs = action => `normalize-uri ${action.method}`;
const renderDoResolveArgs = action => {
  const familyPart = action.family ? `,${action.family}` : '';
  return `do-resolve(${action.varScope}.${action.varName},${action.resolvers}${familyPart}) ${action.expression}`;
};

// =====================================================================
// Sugar action expansion.
// =====================================================================

const expandRateLimitProfile = (profile, condition) => {
  const cfg = profile.config;
  const lines = [];
  lines.push(
    `http-request ${renderTrackScArgs({
      scIndex: 0,
      key: cfg.trackBy,
      table: `st_rl_${profile.id}`,
    })}${renderConditionIfClause(condition)}`
  );
  lines.push(
    `http-request deny deny_status ${cfg.denyStatus}${buildAppendClause(condition, [
      `{ ${cfg.counterExpression} gt ${cfg.denyThreshold} }`,
    ])}`
  );
  return lines;
};

const expandGeoBlockProfile = (profile, condition) => {
  const cfg = profile.config;
  const lines = [];
  if (cfg.allowList.length > 0) {
    lines.push(
      `http-request deny deny_status ${cfg.denyStatus}${buildAppendClause(condition, [
        `!{ src,map_str(${cfg.mapRef}) -m str ${cfg.allowList.join(' ')} }`,
      ])}`
    );
  }
  if (cfg.denyList.length > 0) {
    lines.push(
      `http-request deny deny_status ${cfg.denyStatus}${buildAppendClause(condition, [
        `{ src,map_str(${cfg.mapRef}) -m str ${cfg.denyList.join(' ')} }`,
      ])}`
    );
  }
  return lines;
};

const expandBotDefenseProfile = (profile, condition) => {
  const cfg = profile.config;
  const lines = [];
  if (cfg.uaAllowPatterns.length > 0) {
    const patterns = cfg.uaAllowPatterns.map(p => `"${p}"`).join(' ');
    lines.push(
      `http-request deny deny_status ${cfg.denyStatus}${buildAppendClause(condition, [
        `!{ req.hdr(User-Agent) -m reg ${patterns} }`,
      ])}`
    );
  }
  if (cfg.uaDenyPatterns.length > 0) {
    const patterns = cfg.uaDenyPatterns.map(p => `"${p}"`).join(' ');
    lines.push(
      `http-request deny deny_status ${cfg.denyStatus}${buildAppendClause(condition, [
        `{ req.hdr(User-Agent) -m reg ${patterns} }`,
      ])}`
    );
  }
  return lines;
};

const SECURITY_PROFILE_EXPANDERS = Object.freeze({
  'rate-limit': expandRateLimitProfile,
  'geo-block': expandGeoBlockProfile,
  'bot-defense': expandBotDefenseProfile,
});

const expandSecurityProfile = (action, condition, ctx) => {
  const profile = ctx.indexes.securityProfileById.get(action.profileId);
  if (!profile) {
    return [
      `# apply-security-profile: unknown profile ${action.profileId}${renderConditionIfClause(condition)}`,
    ];
  }
  const expander = SECURITY_PROFILE_EXPANDERS[profile.kind];
  if (!expander) {
    return [
      `# apply-security-profile: no expansion for kind ${profile.kind}${renderConditionIfClause(condition)}`,
    ];
  }
  return expander(profile, condition);
};

const resolveBackendName = (ctx, backendId) => {
  const backend = ctx.indexes.backendById.get(backendId);
  return backend ? backend.name : backendId;
};

const expandAutheliaProvider = (provider, condition, ctx) => {
  const cfg = provider.config;
  const backendName = resolveBackendName(ctx, cfg.authRequestBackendId);
  const lines = [];
  const conditionClause = renderConditionIfClause(condition);
  const propagateList = (cfg.propagateHeaders ?? []).join(',') || '-';
  for (const header of cfg.propagateHeaders ?? []) {
    lines.push(`http-request del-header ${canonicalHeaderCase(header)}${conditionClause}`);
  }
  lines.push(
    `http-request lua.auth-intercept ${backendName} ${cfg.apiVerifyPath} HEAD * ${propagateList} -${conditionClause}`
  );
  lines.push(
    `http-request redirect location ${cfg.redirectUrlTemplate}${buildAppendClause(condition, [
      `!{ var(txn.auth_response_successful) -m bool }`,
    ])}`
  );
  return lines;
};

const expandAuthInterceptProvider = (provider, condition, ctx) => {
  const cfg = provider.config;
  const backendName = resolveBackendName(ctx, cfg.authRequestBackendId);
  const lines = [];
  const conditionClause = renderConditionIfClause(condition);
  const propagateList = (cfg.propagateHeaders ?? []).join(',') || '-';
  for (const header of cfg.propagateHeaders ?? []) {
    lines.push(`http-request del-header ${canonicalHeaderCase(header)}${conditionClause}`);
  }
  lines.push(
    `http-request lua.auth-intercept ${backendName} ${cfg.authRequestPath} HEAD * ${propagateList} -${conditionClause}`
  );
  lines.push(
    `http-request deny${buildAppendClause(condition, [
      `!{ var(txn.auth_response_successful) -m bool }`,
    ])}`
  );
  return lines;
};

const expandMtlsAuthProvider = (provider, condition) => {
  const cfg = provider.config;
  const headerName = cfg.userHeaderName ?? 'X-Client-CN';
  let attrExpr;
  if (cfg.trustedAttribute === 'san') {
    attrExpr = 'ssl_c_san';
  } else if (cfg.trustedAttribute === 'serial') {
    attrExpr = 'ssl_c_serial,hex';
  } else {
    attrExpr = 'ssl_c_s_dn(cn)';
  }
  const lines = [];
  if (cfg.requirePresent !== false) {
    lines.push(`http-request deny${buildAppendClause(condition, [`!{ ssl_c_used }`])}`);
  }
  lines.push(
    `http-request set-header ${headerName} %[${attrExpr}]${buildAppendClause(condition, [
      `{ ssl_c_used }`,
    ])}`
  );
  return lines;
};

const expandHeaderTrustProvider = (provider, condition) => {
  const cfg = provider.config;
  const lines = [];
  const cidrList = cfg.trustedSourceCidrs.join(' ');
  const trustedMatcher = `{ src ${cidrList} }`;
  const untrustedMatcher = `!{ src ${cidrList} }`;
  if (cfg.stripFromUntrusted !== false) {
    lines.push(
      `http-request del-header ${cfg.headerName}${buildAppendClause(condition, [untrustedMatcher])}`
    );
  }
  lines.push(`http-request deny${buildAppendClause(condition, [untrustedMatcher])}`);
  lines.push(
    `http-request deny${buildAppendClause(condition, [`!{ req.hdr(${cfg.headerName}) -m found }`])}`
  );
  if (cfg.userHeaderName && cfg.userHeaderName !== cfg.headerName) {
    lines.push(
      `http-request set-header ${cfg.userHeaderName} %[req.hdr(${cfg.headerName})]${buildAppendClause(
        condition,
        [trustedMatcher]
      )}`
    );
  }
  return lines;
};

const expandLuaAuthProvider = (provider, condition) => {
  const cfg = provider.config;
  const args = (cfg.args ?? []).length > 0 ? ` ${cfg.args.join(' ')}` : '';
  return [`http-request lua.${cfg.functionName}${args}${renderConditionIfClause(condition)}`];
};

const AUTH_PROVIDER_EXPANDERS = Object.freeze({
  authelia: expandAutheliaProvider,
  ldap: expandAuthInterceptProvider,
  saml: expandAuthInterceptProvider,
  entra: expandAuthInterceptProvider,
  'jwt-verify': expandAuthInterceptProvider,
  'mtls-auth': expandMtlsAuthProvider,
  'header-trust': expandHeaderTrustProvider,
  'lua-auth': expandLuaAuthProvider,
});

const expandAuthProvider = (action, condition, ctx) => {
  const provider = ctx.indexes.authProviderById.get(action.providerId);
  if (!provider) {
    return [
      `# apply-auth-provider: unknown provider ${action.providerId}${renderConditionIfClause(condition)}`,
    ];
  }
  const expander = AUTH_PROVIDER_EXPANDERS[provider.type];
  if (!expander) {
    return [
      `# apply-auth-provider: type ${provider.type} has no render expansion${renderConditionIfClause(condition)}`,
    ];
  }
  return expander(provider, condition, ctx);
};

// =====================================================================
// Per-phase action renderers.
// =====================================================================

const SIMPLE_HTTP_REQUEST_VERBS = new Set(['allow', 'reject', 'silent-drop']);

const HTTP_REQUEST_RENDERERS = Object.freeze({
  deny: (a, ifc) => [
    `http-request deny${a.statusCode !== undefined ? ` deny_status ${a.statusCode}` : ''}${ifc}`,
  ],
  tarpit: (a, ifc) => [
    `http-request tarpit${a.statusCode !== undefined ? ` deny_status ${a.statusCode}` : ''}${ifc}`,
  ],
  redirect: (a, ifc) => [`http-request ${renderRedirectArgs(a)}${ifc}`],
  'use-backend': (a, ifc) => [`use_backend ${a.backendId}${ifc}`],
  'use-service': (a, ifc) => [`http-request use-service ${a.serviceName}${ifc}`],
  'set-header': (a, ifc) => [`http-request set-header ${a.name} ${a.value}${ifc}`],
  'add-header': (a, ifc) => [`http-request add-header ${a.name} ${a.value}${ifc}`],
  'del-header': (a, ifc) => [`http-request del-header ${a.name}${ifc}`],
  'replace-header': (a, ifc) => [
    `http-request replace-header ${a.name} ${a.matchRegex} ${a.replacement}${ifc}`,
  ],
  'replace-value': (a, ifc) => [
    `http-request replace-value ${a.name} ${a.matchRegex} ${a.replacement}${ifc}`,
  ],
  'set-var': (a, ifc) => [`http-request ${renderSetVarArgs(a)}${ifc}`],
  'unset-var': (a, ifc) => [`http-request ${renderUnsetVarArgs(a)}${ifc}`],
  'set-path': (a, ifc) => [`http-request set-path ${a.expression}${ifc}`],
  'set-uri': (a, ifc) => [`http-request set-uri ${a.expression}${ifc}`],
  'set-query': (a, ifc) => [`http-request set-query ${a.expression}${ifc}`],
  'set-method': (a, ifc) => [`http-request set-method ${a.expression}${ifc}`],
  'set-log-level': (a, ifc) => [`http-request set-log-level ${a.level}${ifc}`],
  'track-sc': (a, ifc) => [`http-request ${renderTrackScArgs(a)}${ifc}`],
  capture: (a, ifc) => [`http-request capture ${a.expression} len ${a.len}${ifc}`],
  lua: (a, ifc) => [`http-request ${renderLuaArgs(a)}${ifc}`],
  auth: (a, ifc) => [`http-request auth${a.realm ? ` realm "${a.realm}"` : ''}${ifc}`],
  return: (a, ifc) => [`http-request ${renderReturnArgs(a)}${ifc}`],
  'normalize-uri': (a, ifc) => [`http-request ${renderNormalizeUriArgs(a)}${ifc}`],
  'wait-for-body': (a, ifc) => [`http-request wait-for-body time ${a.time}${ifc}`],
  'early-hint': (a, ifc) => [`http-request early-hint ${a.name} ${a.value}${ifc}`],
  'do-resolve': (a, ifc) => [`http-request ${renderDoResolveArgs(a)}${ifc}`],
  'sc-inc-gpc': (a, ifc) => [`http-request ${renderScIncGpcArgs(a)}${ifc}`],
});

const renderHttpRequestAction = (action, condition, ctx) => {
  if (action.type === 'apply-security-profile') {
    return expandSecurityProfile(action, condition, ctx);
  }
  if (action.type === 'apply-auth-provider') {
    return expandAuthProvider(action, condition, ctx);
  }
  const ifClause = renderConditionIfClause(condition);
  if (SIMPLE_HTTP_REQUEST_VERBS.has(action.type)) {
    return [`http-request ${action.type}${ifClause}`];
  }
  const renderer = HTTP_REQUEST_RENDERERS[action.type];
  return renderer
    ? renderer(action, ifClause)
    : [`# httpRequest: unhandled action type ${action.type}${ifClause}`];
};

const renderHttpResponseAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  switch (action.type) {
    case 'allow':
      return [`http-response allow${ifClause}`];
    case 'deny':
      return [
        `http-response deny${
          action.statusCode !== undefined ? ` deny_status ${action.statusCode}` : ''
        }${ifClause}`,
      ];
    case 'set-status': {
      const reasonPart = action.reason ? ` reason "${action.reason}"` : '';
      return [`http-response set-status ${action.statusCode}${reasonPart}${ifClause}`];
    }
    case 'set-header':
      return [`http-response set-header ${action.name} ${action.value}${ifClause}`];
    case 'add-header':
      return [`http-response add-header ${action.name} ${action.value}${ifClause}`];
    case 'del-header':
      return [`http-response del-header ${action.name}${ifClause}`];
    case 'replace-header':
      return [
        `http-response replace-header ${action.name} ${action.matchRegex} ${action.replacement}${ifClause}`,
      ];
    case 'replace-value':
      return [
        `http-response replace-value ${action.name} ${action.matchRegex} ${action.replacement}${ifClause}`,
      ];
    case 'set-var':
      return [`http-response ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`http-response ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'set-log-level':
      return [`http-response set-log-level ${action.level}${ifClause}`];
    case 'silent-drop':
      return [`http-response silent-drop${ifClause}`];
    case 'lua':
      return [`http-response ${renderLuaArgs(action)}${ifClause}`];
    case 'return':
      return [`http-response ${renderReturnArgs(action)}${ifClause}`];
    case 'redirect':
      return [`http-response ${renderRedirectArgs(action)}${ifClause}`];
    case 'capture':
      return [`http-response capture ${action.expression} id ${action.id}${ifClause}`];
    default:
      return [`# httpResponse: unhandled action type ${action.type}${ifClause}`];
  }
};

const renderHttpAfterResponseAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  switch (action.type) {
    case 'allow':
      return [`http-after-response allow${ifClause}`];
    case 'deny':
      return [`http-after-response deny${ifClause}`];
    case 'set-status': {
      const reasonPart = action.reason ? ` reason "${action.reason}"` : '';
      return [`http-after-response set-status ${action.statusCode}${reasonPart}${ifClause}`];
    }
    case 'set-header':
      return [`http-after-response set-header ${action.name} ${action.value}${ifClause}`];
    case 'add-header':
      return [`http-after-response add-header ${action.name} ${action.value}${ifClause}`];
    case 'del-header':
      return [`http-after-response del-header ${action.name}${ifClause}`];
    case 'replace-header':
      return [
        `http-after-response replace-header ${action.name} ${action.matchRegex} ${action.replacement}${ifClause}`,
      ];
    case 'replace-value':
      return [
        `http-after-response replace-value ${action.name} ${action.matchRegex} ${action.replacement}${ifClause}`,
      ];
    case 'set-var':
      return [`http-after-response ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`http-after-response ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'set-log-level':
      return [`http-after-response set-log-level ${action.level}${ifClause}`];
    case 'lua':
      return [`http-after-response ${renderLuaArgs(action)}${ifClause}`];
    default:
      return [`# httpAfterResponse: unhandled action type ${action.type}${ifClause}`];
  }
};

const renderTcpRequestConnectionAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  const prefix = 'tcp-request connection';
  switch (action.type) {
    case 'accept':
      return [`${prefix} accept${ifClause}`];
    case 'reject':
      return [`${prefix} reject${ifClause}`];
    case 'set-var':
      return [`${prefix} ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`${prefix} ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'track-sc':
      return [`${prefix} ${renderTrackScArgs(action)}${ifClause}`];
    case 'silent-drop':
      return [`${prefix} silent-drop${ifClause}`];
    case 'set-mark':
      return [`${prefix} set-mark ${action.mark}${ifClause}`];
    case 'set-tos':
      return [`${prefix} set-tos ${action.tos}${ifClause}`];
    case 'sc-inc-gpc':
      return [`${prefix} ${renderScIncGpcArgs(action)}${ifClause}`];
    default:
      return [`# tcpRequestConnection: unhandled action type ${action.type}${ifClause}`];
  }
};

const renderTcpRequestSessionAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  const prefix = 'tcp-request session';
  switch (action.type) {
    case 'accept':
      return [`${prefix} accept${ifClause}`];
    case 'reject':
      return [`${prefix} reject${ifClause}`];
    case 'set-var':
      return [`${prefix} ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`${prefix} ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'track-sc':
      return [`${prefix} ${renderTrackScArgs(action)}${ifClause}`];
    case 'silent-drop':
      return [`${prefix} silent-drop${ifClause}`];
    default:
      return [`# tcpRequestSession: unhandled action type ${action.type}${ifClause}`];
  }
};

const renderTcpRequestContentAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  const prefix = 'tcp-request content';
  switch (action.type) {
    case 'accept':
      return [`${prefix} accept${ifClause}`];
    case 'reject':
      return [`${prefix} reject${ifClause}`];
    case 'set-var':
      return [`${prefix} ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`${prefix} ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'track-sc':
      return [`${prefix} ${renderTrackScArgs(action)}${ifClause}`];
    case 'silent-drop':
      return [`${prefix} silent-drop${ifClause}`];
    case 'lua':
      return [`${prefix} ${renderLuaArgs(action)}${ifClause}`];
    case 'use-service':
      return [`${prefix} use-service ${action.serviceName}${ifClause}`];
    case 'do-resolve':
      return [`${prefix} ${renderDoResolveArgs(action)}${ifClause}`];
    case 'set-priority-class':
      return [`${prefix} set-priority-class ${action.value}${ifClause}`];
    case 'set-priority-offset':
      return [`${prefix} set-priority-offset ${action.value}${ifClause}`];
    case 'set-mark':
      return [`${prefix} set-mark ${action.mark}${ifClause}`];
    case 'set-tos':
      return [`${prefix} set-tos ${action.tos}${ifClause}`];
    default:
      return [`# tcpRequestContent: unhandled action type ${action.type}${ifClause}`];
  }
};

const renderTcpResponseContentAction = (action, condition) => {
  const ifClause = renderConditionIfClause(condition);
  const prefix = 'tcp-response content';
  switch (action.type) {
    case 'accept':
      return [`${prefix} accept${ifClause}`];
    case 'reject':
      return [`${prefix} reject${ifClause}`];
    case 'close':
      return [`${prefix} close${ifClause}`];
    case 'set-var':
      return [`${prefix} ${renderSetVarArgs(action)}${ifClause}`];
    case 'unset-var':
      return [`${prefix} ${renderUnsetVarArgs(action)}${ifClause}`];
    case 'lua':
      return [`${prefix} ${renderLuaArgs(action)}${ifClause}`];
    case 'silent-drop':
      return [`${prefix} silent-drop${ifClause}`];
    default:
      return [`# tcpResponseContent: unhandled action type ${action.type}${ifClause}`];
  }
};

const PHASE_ACTION_RENDERERS = Object.freeze({
  httpRequest: renderHttpRequestAction,
  httpResponse: renderHttpResponseAction,
  httpAfterResponse: renderHttpAfterResponseAction,
  tcpRequestConnection: renderTcpRequestConnectionAction,
  tcpRequestSession: renderTcpRequestSessionAction,
  tcpRequestContent: renderTcpRequestContentAction,
  tcpResponseContent: renderTcpResponseContentAction,
});

const renderRule = (phase, rule, ctx) => {
  if (rule.enabled === false) {
    return [];
  }
  const renderer = PHASE_ACTION_RENDERERS[phase];
  if (!renderer) {
    return [];
  }
  return renderer(rule.action, rule.condition ?? [], ctx);
};

const renderPhase = (phase, rules, ctx) => {
  const out = [];
  for (const rule of rules ?? []) {
    out.push(...renderRule(phase, rule, ctx));
  }
  return out;
};

// =====================================================================
// HttpOpts / TcpOpts emission (the typed UI sugar that survived).
// =====================================================================

const renderCorsHeaders = httpOpts => {
  const { cors } = httpOpts;
  if (!cors?.enabled) {
    return [];
  }
  const lines = [];
  if (cors.frameAncestors) {
    lines.push(
      `http-response set-header Content-Security-Policy "frame-ancestors ${cors.frameAncestors}"`
    );
  }
  if (cors.allowOrigin) {
    lines.push(`http-response set-header Access-Control-Allow-Origin "${cors.allowOrigin}"`);
  }
  if (cors.allowHeaders) {
    lines.push(`http-response set-header Access-Control-Allow-Headers "${cors.allowHeaders}"`);
  }
  if (cors.allowMethods) {
    lines.push(`http-response set-header Access-Control-Allow-Methods "${cors.allowMethods}"`);
  }
  if (cors.allowCredentials) {
    lines.push('http-response set-header Access-Control-Allow-Credentials "true"');
  }
  if (cors.exposeHeaders) {
    lines.push(`http-response set-header Access-Control-Expose-Headers "${cors.exposeHeaders}"`);
  }
  if (cors.maxAge !== undefined) {
    lines.push(`http-response set-header Access-Control-Max-Age "${cors.maxAge}"`);
  }
  return lines;
};

const renderHstsHeader = httpOpts => {
  const { hsts } = httpOpts;
  if (!hsts?.enabled) {
    return [];
  }
  const parts = [`max-age=${hsts.maxAge}`];
  if (hsts.includeSubdomains) {
    parts.push('includeSubDomains');
  }
  if (hsts.preload) {
    parts.push('preload');
  }
  return [`http-after-response set-header Strict-Transport-Security "${parts.join('; ')}"`];
};

const renderCompressionLines = compression => {
  if (!compression?.enabled) {
    return [];
  }
  const lines = [`compression algo ${compression.algorithm}`];
  if (compression.types?.length > 0) {
    lines.push(`compression type ${compression.types.join(' ')}`);
  }
  if (compression.offload) {
    lines.push('compression offload');
  }
  return lines;
};

const renderForwardForLines = forwardFor => {
  if (!forwardFor?.enabled) {
    return [];
  }
  const parts = ['option forwardfor'];
  if (forwardFor.except) {
    parts.push(`except ${forwardFor.except}`);
  }
  if (forwardFor.header) {
    parts.push(`header ${forwardFor.header}`);
  }
  if (forwardFor.ifNone) {
    parts.push('if-none');
  }
  return [parts.join(' ')];
};

const renderHttpFrontendCaps = (fe, httpOpts) => {
  const lines = [];
  if (fe.maxconn !== undefined) {
    lines.push(`maxconn ${fe.maxconn}`);
  }
  if (httpOpts.rateLimitSessions !== undefined) {
    lines.push(`rate-limit sessions ${httpOpts.rateLimitSessions}`);
  }
  return lines;
};

const renderHttpOriginalto = originalto => {
  if (!originalto?.enabled) {
    return [];
  }
  const parts = ['option originalto'];
  if (originalto.except) {
    parts.push(`except ${originalto.except}`);
  }
  if (originalto.header) {
    parts.push(`header ${originalto.header}`);
  }
  return [parts.join(' ')];
};

const renderHttpOptionToggles = httpOpts => {
  const lines = [];
  if (httpOpts.httpLog === false) {
    lines.push('no option httplog');
  }
  if (httpOpts.dontlogNull) {
    lines.push('option dontlognull');
  }
  if (httpOpts.dontlogNormal) {
    lines.push('option dontlog-normal');
  }
  if (httpOpts.logSeparateErrors) {
    lines.push('option log-separate-errors');
  }
  if (httpOpts.optionHttpKeepAlive === false) {
    lines.push('no option http-keep-alive');
  }
  if (httpOpts.optionHttpServerClose) {
    lines.push('option http-server-close');
  }
  if (httpOpts.optionHttpTunnel) {
    lines.push('option http-tunnel');
  }
  if (httpOpts.optionHttpIgnoreProbes) {
    lines.push('option http-ignore-probes');
  }
  if (httpOpts.optionHttpBufferRequest) {
    lines.push('option http-buffer-request');
  }
  if (httpOpts.optionHttpProxy) {
    lines.push('option http-proxy');
  }
  if (httpOpts.optionHttpPretendKeepalive) {
    lines.push('option http-pretend-keepalive');
  }
  if (httpOpts.optionHttpNoDelay) {
    lines.push('option http-no-delay');
  }
  if (httpOpts.optionLogasap) {
    lines.push('option logasap');
  }
  if (httpOpts.optionContstats) {
    lines.push('option contstats');
  }
  if (httpOpts.optionCliTcpKa) {
    lines.push('option clitcpka');
  }
  if (httpOpts.optionSrvTcpKa) {
    lines.push('option srvtcpka');
  }
  lines.push(...renderHttpOriginalto(httpOpts.optionOriginalto));
  return lines;
};

const renderHttpSmugglingDefense = httpOpts => {
  const lines = [];
  if (httpOpts.restrictReqHdrNames) {
    lines.push(`option http-restrict-req-hdr-names ${httpOpts.restrictReqHdrNames}`);
  }
  if (httpOpts.normalizeUri?.length > 0) {
    for (const arg of httpOpts.normalizeUri) {
      lines.push(`http-request normalize-uri ${arg}`);
    }
  }
  if (httpOpts.strictMode !== undefined) {
    lines.push(`http-request strict-mode ${httpOpts.strictMode ? 'on' : 'off'}`);
  }
  return lines;
};

const renderHttpLogging = httpOpts => {
  const lines = [];
  if (httpOpts.customLogFormat) {
    lines.push(`log-format ${httpOpts.customLogFormat}`);
  }
  if (httpOpts.logTag) {
    lines.push(`log-tag ${httpOpts.logTag}`);
  }
  return lines;
};

const renderHttpFrontendTimeouts = httpOpts => {
  const lines = [];
  if (httpOpts.timeoutClient) {
    lines.push(`timeout client ${httpOpts.timeoutClient}`);
  }
  if (httpOpts.timeoutHttpRequest) {
    lines.push(`timeout http-request ${httpOpts.timeoutHttpRequest}`);
  }
  if (httpOpts.timeoutHttpKeepAlive) {
    lines.push(`timeout http-keep-alive ${httpOpts.timeoutHttpKeepAlive}`);
  }
  if (httpOpts.timeoutClientFin) {
    lines.push(`timeout client-fin ${httpOpts.timeoutClientFin}`);
  }
  return lines;
};

const renderHttpCapture = httpOpts => {
  const lines = [];
  for (const cap of httpOpts.captureRequestHeaders ?? []) {
    lines.push(`http-request capture req.hdr(${cap.header}) len ${cap.maxLen}`);
  }
  for (const cap of httpOpts.captureResponseHeaders ?? []) {
    lines.push(`http-response capture res.hdr(${cap.header}) len ${cap.maxLen}`);
  }
  if (httpOpts.captureCookie?.enabled && httpOpts.captureCookie.name) {
    lines.push(
      `http-request capture cookie ${httpOpts.captureCookie.name} len ${httpOpts.captureCookie.maxLen}`
    );
  }
  return lines;
};

const renderHttpMonitor = httpOpts => {
  const lines = [];
  if (httpOpts.monitorUri) {
    lines.push(`monitor-uri ${httpOpts.monitorUri}`);
  }
  if (httpOpts.monitorFail) {
    lines.push(`monitor fail if ${httpOpts.monitorFail}`);
  }
  return lines;
};

const renderHttpErrorFilesRef = (fe, state, httpOpts) => {
  const lines = [];
  const httpOptsErrorFilesName = resolveErrorFilesSectionName(state, httpOpts.useErrorFilesId);
  if (httpOptsErrorFilesName) {
    lines.push(`errorfiles ${httpOptsErrorFilesName}`);
  }
  for (const [code, path] of Object.entries(httpOpts.errorFiles ?? {})) {
    lines.push(`errorfile ${code} ${path}`);
  }
  const feErrorFilesName = resolveErrorFilesSectionName(state, fe.useErrorFilesId);
  if (feErrorFilesName) {
    lines.push(`errorfiles ${feErrorFilesName}`);
  }
  return lines;
};

const renderHttpH2Tunables = h2 => {
  if (!h2) {
    return [];
  }
  const lines = [];
  if (h2.maxConcurrentStreams !== undefined) {
    lines.push(`tune.h2.fe.max-concurrent-streams ${h2.maxConcurrentStreams}`);
  }
  if (h2.maxFrameSize !== undefined) {
    lines.push(`tune.h2.max-frame-size ${h2.maxFrameSize}`);
  }
  if (h2.maxHeaderListSize !== undefined) {
    lines.push(`tune.h2.header-table-size ${h2.maxHeaderListSize}`);
  }
  if (h2.initialWindowSize !== undefined) {
    lines.push(`tune.h2.fe.initial-window-size ${h2.initialWindowSize}`);
  }
  if (h2.maxRstAtOnce !== undefined) {
    lines.push(`tune.h2.fe.max-rst-at-once ${h2.maxRstAtOnce}`);
  }
  if (h2.glitchesThreshold !== undefined) {
    lines.push(`tune.h2.fe.glitches-threshold ${h2.glitchesThreshold}`);
  }
  if (h2.maxTotalStreams !== undefined) {
    lines.push(`tune.h2.fe.max-total-streams ${h2.maxTotalStreams}`);
  }
  if (h2.headerTableSize !== undefined) {
    lines.push(`tune.h2.header-table-size ${h2.headerTableSize}`);
  }
  if (h2.logErrors === true) {
    lines.push('tune.h2.log-errors on');
  }
  return lines;
};

const renderTcpSniRouterBlock = sniRouter => {
  if (!sniRouter?.enabled) {
    return [];
  }
  const out = ['tcp-request content accept if { req_ssl_hello_type 1 }'];
  for (const m of sniRouter.sniMap ?? []) {
    out.push(`use_backend ${m.backendId} if { req_ssl_sni -i ${m.sniPattern} }`);
  }
  return out;
};

// =====================================================================
// bind line emission.
// =====================================================================

const pushKv = (parts, value, key) => {
  if (value !== undefined && value !== null) {
    parts.push(`${key} ${value}`);
  }
};

const renderBindBooleanTuningTokens = bind => {
  const out = [];
  if (bind.tcpQuickAck === true) {
    out.push('tcp-quickack');
  } else if (bind.tcpQuickAck === false) {
    out.push('no-tcp-quickack');
  }
  if (bind.deferAccept) {
    out.push('defer-accept');
  }
  if (bind.tfo) {
    out.push('tfo');
  }
  if (bind.ipFamily === 'v4' || bind.ipFamily === 'dual') {
    out.push('v4v6');
  } else if (bind.ipFamily === 'v6') {
    out.push('v6only');
  }
  return out;
};

const renderBindBaseTokens = bind => {
  const parts = [];
  if (bind.name) {
    parts.push(`name ${bind.name}`);
  }
  if (bind.acceptProxy) {
    parts.push('accept-proxy');
  }
  if (bind.transparent) {
    parts.push('transparent');
  }
  pushKv(parts, bind.interface, 'interface');
  pushKv(parts, bind.namespace, 'namespace');
  pushKv(parts, bind.thread, 'thread');
  pushKv(parts, bind.shards, 'shards');
  pushKv(parts, bind.backlog, 'backlog');
  pushKv(parts, bind.maxconn, 'maxconn');
  pushKv(parts, bind.nice, 'nice');
  pushKv(parts, bind.mss, 'mss');
  if (bind.tcpUt) {
    parts.push(`tcp-ut ${bind.tcpUt}`);
  }
  parts.push(...renderBindBooleanTuningTokens(bind));
  return parts;
};

const renderBindSslKvTokens = (ssl, trustedCasDir, trustedCrlsDir) => {
  const parts = [];
  pushKv(parts, ssl.crtListRef, 'crt-list');
  pushKv(parts, ssl.defaultCert, 'crt');
  if (ssl.alpn?.length > 0) {
    parts.push(`alpn ${ssl.alpn.join(',')}`);
  }
  pushKv(parts, ssl.ciphers, 'ciphers');
  pushKv(parts, ssl.ciphersuites, 'ciphersuites');
  pushKv(parts, ssl.sslMinVersion, 'ssl-min-ver');
  pushKv(parts, ssl.sslMaxVersion, 'ssl-max-ver');
  pushKv(parts, ssl.curves, 'curves');
  pushKv(parts, ssl.sigalgs, 'sigalgs');
  pushKv(parts, ssl.clientSigalgs, 'client-sigalgs');
  pushKv(parts, resolveTrustedCaPath(ssl.caTrustedCaId, trustedCasDir), 'ca-file');
  pushKv(parts, resolveTrustedCaPath(ssl.caVerifyTrustedCaId, trustedCasDir), 'ca-verify-file');
  pushKv(parts, ssl.verify, 'verify');
  pushKv(parts, resolveTrustedCrlPath(ssl.crlTrustedCrlId, trustedCrlsDir), 'crl-file');
  return parts;
};

const renderBindSslFlagTokens = ssl => {
  const out = [];
  if (ssl.crtIgnoreErrors) {
    out.push('crt-ignore-err all');
  }
  if (ssl.caIgnoreErrors) {
    out.push('ca-ignore-err all');
  }
  if (ssl.noTlsTickets) {
    out.push('no-tls-tickets');
  }
  if (ssl.noCaNames) {
    out.push('no-ca-names');
  }
  if (ssl.preferClientCiphers) {
    out.push('prefer-client-ciphers');
  }
  if (ssl.strictSni) {
    out.push('strict-sni');
  }
  if (ssl.allow0rtt) {
    out.push('allow-0rtt');
  }
  return out;
};

const renderBindSslTokens = (ssl, trustedCasDir, trustedCrlsDir) => {
  if (!ssl?.enabled) {
    return [];
  }
  return [
    'ssl',
    ...renderBindSslKvTokens(ssl, trustedCasDir, trustedCrlsDir),
    ...renderBindSslFlagTokens(ssl),
  ];
};

const renderBindLine = (bind, trustedCasDir, trustedCrlsDir) => {
  const parts = [`bind ${bind.address}`];
  parts.push(...renderBindBaseTokens(bind));
  parts.push(...renderBindSslTokens(bind.ssl, trustedCasDir, trustedCrlsDir));
  return parts.join(' ');
};

const renderQuicBindExtras = bind => {
  if (!isQuicAddress(bind.address)) {
    return [];
  }
  const out = [];
  if (bind.quic?.forceRetry) {
    out.push('option quic-force-retry');
  }
  return out;
};

// =====================================================================
// stats sub-block (http frontends).
// =====================================================================

const renderStatsBlock = stats => {
  if (!stats?.enabled) {
    return [];
  }
  const lines = ['stats enable', `stats uri ${stats.uri}`, `stats realm ${stats.realm}`];
  if (stats.refresh !== undefined) {
    lines.push(`stats refresh ${stats.refresh}`);
  }
  if (stats.adminAclExpression) {
    lines.push(`stats admin if ${stats.adminAclExpression}`);
  }
  if (stats.showLegends === false) {
    lines.push('stats hide-legends');
  }
  if (stats.showModules) {
    lines.push('stats show-modules');
  }
  if (stats.showNodename) {
    lines.push(`stats show-node ${stats.showNodename}`);
  }
  if (stats.showDescription) {
    lines.push(`stats show-desc ${stats.showDescription}`);
  }
  for (const cred of stats.auth ?? []) {
    lines.push(`stats auth ${cred.username}:${cred.password}`);
  }
  if (stats.prometheusExporter) {
    const promSuffix = stats.prometheusExtraCounters ? '?extra-counters' : '';
    lines.push(
      `http-request use-service prometheus-exporter${promSuffix} if { path ${stats.prometheusPath} }`
    );
  }
  return lines;
};

// =====================================================================
// frontend rendering.
// =====================================================================

const collectAclRefsInFrontend = fe => {
  const names = new Set();
  for (const phase of RULE_PHASE_KEYS) {
    const rules = fe.rulePhases?.[phase] ?? [];
    for (const rule of rules) {
      if (rule.enabled === false) {
        continue;
      }
      for (const term of rule.condition ?? []) {
        if (term.kind === 'aclRef') {
          names.add(term.aclName);
        }
      }
    }
  }
  return names;
};

const renderFrontendAcls = (fe, state) => {
  const wanted = collectAclRefsInFrontend(fe);
  if (wanted.size === 0) {
    return [];
  }
  const lines = [];
  for (const acl of state.acls ?? []) {
    if (wanted.has(acl.name)) {
      lines.push(renderAclLine(acl));
    }
  }
  return lines;
};

const renderHttpFrontendBody = (fe, state, ctx) => {
  const httpOpts = fe.httpOpts ?? {};
  const rulePhases = fe.rulePhases ?? {};
  const lines = ['log global'];
  lines.push(...renderHttpFrontendCaps(fe, httpOpts));
  lines.push(...renderHttpOptionToggles(httpOpts));
  lines.push(...renderHttpSmugglingDefense(httpOpts));
  lines.push(...renderForwardForLines(httpOpts.forwardFor));
  lines.push(...renderHttpLogging(httpOpts));
  lines.push(...renderHttpFrontendTimeouts(httpOpts));
  lines.push(...renderCompressionLines(httpOpts.compression));
  lines.push(...renderHttpCapture(httpOpts));
  lines.push(...renderHttpMonitor(httpOpts));
  lines.push(...renderCorsHeaders(httpOpts));
  lines.push(...renderHstsHeader(httpOpts));
  lines.push(...renderFrontendAcls(fe, state));
  const httpRequestOut = renderPhase('httpRequest', rulePhases.httpRequest, ctx);
  const httpReqHandlers = httpRequestOut.filter(l => !l.startsWith('use_backend '));
  const httpReqRouters = httpRequestOut.filter(l => l.startsWith('use_backend '));
  lines.push(...httpReqHandlers);
  lines.push(...httpReqRouters);
  lines.push(...renderPhase('httpResponse', rulePhases.httpResponse, ctx));
  lines.push(...renderPhase('httpAfterResponse', rulePhases.httpAfterResponse, ctx));
  if (httpOpts.defaultBackendId) {
    lines.push(`default_backend ${httpOpts.defaultBackendId}`);
  }
  lines.push(...renderHttpErrorFilesRef(fe, state, httpOpts));
  lines.push(...renderHttpH2Tunables(httpOpts.h2));
  for (const bind of fe.binds ?? []) {
    lines.push(...renderQuicBindExtras(bind));
  }
  return lines;
};

const renderTcpFrontendBody = (fe, state, ctx) => {
  const tcpOpts = fe.tcpOpts ?? {};
  const rulePhases = fe.rulePhases ?? {};
  const lines = ['mode tcp', 'log global'];

  if (tcpOpts.tcpLog) {
    lines.push('option tcplog');
  }
  if (fe.maxconn !== undefined) {
    lines.push(`maxconn ${fe.maxconn}`);
  }
  if (tcpOpts.timeoutClient) {
    lines.push(`timeout client ${tcpOpts.timeoutClient}`);
  }
  if (tcpOpts.inspectDelay) {
    lines.push(`tcp-request inspect-delay ${tcpOpts.inspectDelay}`);
  }

  lines.push(...renderFrontendAcls(fe, state));
  lines.push(...renderPhase('tcpRequestConnection', rulePhases.tcpRequestConnection, ctx));
  lines.push(...renderPhase('tcpRequestSession', rulePhases.tcpRequestSession, ctx));
  lines.push(...renderPhase('tcpRequestContent', rulePhases.tcpRequestContent, ctx));
  lines.push(...renderPhase('tcpResponseContent', rulePhases.tcpResponseContent, ctx));

  lines.push(...renderTcpSniRouterBlock(tcpOpts.sniRouter));

  if (tcpOpts.trackSc0) {
    lines.push(
      `tcp-request connection track-sc0 ${tcpOpts.trackSc0.key} table ${tcpOpts.trackSc0.tableName}`
    );
  }

  if (tcpOpts.defaultBackendId) {
    lines.push(`default_backend ${tcpOpts.defaultBackendId}`);
  }

  return lines;
};

const resolveDefaultsBlockName = (state, id) => {
  const found = (state.defaultsBlocks ?? []).find(b => b.id === id);
  return found ? found.name : null;
};

const renderFrontend = (fe, state, ctx) => {
  if (!fe.enabled) {
    return '';
  }
  const sslEnabledBinds = (fe.binds ?? []).filter(b => b.ssl?.enabled);
  if (sslEnabledBinds.length > 0 && ctx.loadableCertCount === 0) {
    return '';
  }

  const defaultsName = resolveDefaultsBlockName(state, fe.fromDefaults);
  const header = defaultsName ? `frontend ${fe.name} from ${defaultsName}` : `frontend ${fe.name}`;

  const lines = [];
  for (const bind of fe.binds ?? []) {
    lines.push(renderBindLine(bind, ctx.trustedCasDir, ctx.trustedCrlsDir));
  }

  if (fe.mode === 'http') {
    lines.push(...renderHttpFrontendBody(fe, state, ctx));
  } else if (fe.mode === 'tcp') {
    lines.push(...renderTcpFrontendBody(fe, state, ctx));
  }

  if (fe.mode === 'http') {
    lines.push(...renderStatsBlock(fe.stats));
  }

  return section(header, lines);
};

// =====================================================================
// Backend rendering. Unchanged from previous design.
// =====================================================================

const SEND_PROXY_FLAGS = Object.freeze({
  v1: 'send-proxy',
  v2: 'send-proxy-v2',
  'v2-ssl': 'send-proxy-v2-ssl',
  'v2-ssl-cn': 'send-proxy-v2-ssl-cn',
});

const renderServerLine = (server, trustedCasDir) => {
  const parts = ['server', server.name, server.address];
  if (server.check) {
    parts.push('check');
  }
  if (server.ssl) {
    parts.push('ssl');
    parts.push('verify', server.sslVerify ?? 'none');
    const caPath = resolveTrustedCaPath(server.caTrustedCaId, trustedCasDir);
    if (caPath) {
      parts.push('ca-file', caPath);
    }
    if (server.sni) {
      parts.push('sni', server.sni);
    }
  }
  if (server.weight !== undefined) {
    parts.push('weight', String(server.weight));
  }
  if (server.maxconn !== undefined) {
    parts.push('maxconn', String(server.maxconn));
  }
  if (server.backup) {
    parts.push('backup');
  }
  if (server.cookie) {
    parts.push('cookie', server.cookie);
  }
  if (server.initAddr && server.initAddr.length > 0) {
    parts.push('init-addr', server.initAddr.join(','));
  }
  if (server.sendProxy && server.sendProxy !== 'none' && SEND_PROXY_FLAGS[server.sendProxy]) {
    parts.push(SEND_PROXY_FLAGS[server.sendProxy]);
  }
  for (const directive of server.advancedDirectives) {
    parts.push(directive);
  }
  return parts.join(' ');
};

// Backends with no `from <name>` clause inherit from the LAST defaults block.
// HAProxy's own compile-time default for `balance` is roundrobin; we treat
// that as the inherited default since DefaultsBlockSchema doesn't carry one.
const findInheritedDefaultsForBackend = state => {
  const blocks = state.defaultsBlocks ?? [];
  return blocks.length > 0 ? blocks[blocks.length - 1] : null;
};

const renderBackend = (backend, state, ctx) => {
  const defaults = findInheritedDefaultsForBackend(state);
  const lines = [];
  if (backend.mode && (!defaults || backend.mode !== defaults.mode)) {
    lines.push(`mode ${backend.mode}`);
  }
  if (backend.balance && backend.balance !== 'roundrobin') {
    lines.push(`balance ${backend.balance}`);
  }
  if (backend.stickTable) {
    const st = backend.stickTable;
    lines.push(`stick-table type ${st.type} size ${st.size} expire ${st.expire}`);
    lines.push(`stick on ${st.stickOn}`);
  }
  if (backend.httpReuse) {
    lines.push(`http-reuse ${backend.httpReuse}`);
  }
  if (backend.forwardFor) {
    lines.push('option forwardfor');
  }
  for (const opt of backend.options) {
    lines.push(`option ${opt}`);
  }
  if (backend.retries !== undefined) {
    lines.push(`retries ${backend.retries}`);
  }
  for (const [key, value] of Object.entries(backend.timeouts ?? {})) {
    if (value) {
      lines.push(`timeout ${key.replace(/[A-Z]/gu, ch => `-${ch.toLowerCase()}`)} ${value}`);
    }
  }
  for (const server of backend.servers) {
    lines.push(renderServerLine(server, ctx?.trustedCasDir));
  }
  for (const directive of backend.advancedDirectives) {
    lines.push(directive);
  }
  const header = defaults
    ? `backend ${backend.name} from ${defaults.name}`
    : `backend ${backend.name}`;
  return section(header, lines);
};

// =====================================================================
// Auto-emitted backend sections for rate-limit security profile stick-tables.
// Auth-provider sidecar backends are NOT auto-emitted — users define them
// as regular state.backends entries and reference them via
// `authProvider.config.authRequestBackendId`.
// =====================================================================

const stickTableTypeFor = trackBy => (trackBy === 'src' ? 'ip' : 'string');

const renderRateLimitStickTableBackends = indexes => {
  const sections = [];
  for (const profileId of indexes.referencedSecurityProfileIds) {
    const profile = indexes.securityProfileById.get(profileId);
    if (!profile || profile.kind !== 'rate-limit') {
      continue;
    }
    const cfg = profile.config;
    const lines = [
      `stick-table type ${stickTableTypeFor(cfg.trackBy)} size ${cfg.tableSize} expire ${cfg.tableExpire} store ${cfg.store.join(',')}`,
    ];
    sections.push(section(`backend st_rl_${profileId}`, lines));
  }
  return sections;
};

// =====================================================================
// Top-level orchestration.
// =====================================================================

const collectAclRefsFromRule = (rule, set) => {
  for (const term of rule.condition ?? []) {
    if (term.kind === 'aclRef') {
      set.add(term.aclName);
    }
  }
};

const collectSugarRefsFromRule = (rule, secSet, authSet) => {
  const { action } = rule;
  if (!action) {
    return;
  }
  if (action.type === 'apply-security-profile') {
    secSet.add(action.profileId);
  }
  if (action.type === 'apply-auth-provider') {
    authSet.add(action.providerId);
  }
};

const scanRuleForRefs = (rule, sets) => {
  if (rule.enabled === false) {
    return;
  }
  collectAclRefsFromRule(rule, sets.acls);
  collectSugarRefsFromRule(rule, sets.profiles, sets.providers);
};

const buildRuleIndexes = state => {
  const sets = {
    acls: new Set(),
    profiles: new Set(),
    providers: new Set(),
  };

  for (const fe of state.frontends ?? []) {
    if (!fe.enabled) {
      continue;
    }
    for (const phase of RULE_PHASE_KEYS) {
      for (const rule of fe.rulePhases?.[phase] ?? []) {
        scanRuleForRefs(rule, sets);
      }
    }
  }

  const authProviderById = new Map((state.authProviders ?? []).map(p => [p.id, p]));
  const securityProfileById = new Map((state.securityProfiles ?? []).map(p => [p.id, p]));
  const backendById = new Map((state.backends ?? []).map(b => [b.id, b]));

  return {
    referencedAclNames: sets.acls,
    referencedSecurityProfileIds: sets.profiles,
    referencedAuthProviderIds: sets.providers,
    authProviderById,
    securityProfileById,
    backendById,
  };
};

export const renderHaproxyConfig = (state, options = {}) => {
  const certsListPath = options.certsListPath ?? '/etc/haproxy/certs.list';
  const trustedCasDir = options.trustedCasDir ?? null;
  const trustedCrlsDir = options.trustedCrlsDir ?? null;
  const loadableCertCount = options.loadableCertCount ?? state.tls.certs.length;
  const indexes = buildRuleIndexes(state);
  const ctx = { indexes, loadableCertCount, certsListPath, trustedCasDir, trustedCrlsDir };

  const segments = [
    renderGlobal(state, indexes),
    renderResolvers(state),
    ...(state.resolvers ?? []).map(renderOneResolver),
    ...(state.peers ?? []).map(renderOnePeerGroup),
    ...(state.mailers ?? []).map(renderOneMailerGroup),
    ...(state.rings ?? []).map(renderOneRing),
    ...(state.crtStores ?? []).map(renderOneCrtStore),
    ...(state.httpErrorsSections ?? []).map(renderOneHttpErrorsSection),
    ...(state.defaultsBlocks ?? []).map(block => renderOneDefaultsBlock(block, state)),
    ...(state.frontends ?? []).map(fe => renderFrontend(fe, state, ctx)),
    ...state.backends.map(backend => renderBackend(backend, state, ctx)),
    ...renderRateLimitStickTableBackends(indexes),
  ];

  return `${joinNonEmpty(segments)}${NL}`;
};

export const __internals = Object.freeze({
  renderAclLine,
  renderConditionTerm,
  renderCondition,
  renderConditionIfClause,
  renderBindLine,
  renderHttpFrontendBody,
  renderTcpFrontendBody,
  renderStatsBlock,
  renderFrontend,
  buildRuleIndexes,
  expandSecurityProfile,
  expandAuthProvider,
});
