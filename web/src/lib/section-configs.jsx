import { Badge } from 'react-bootstrap';

// Entity-array section configs consumed by `EntitySectionCard`. Each section
// is a self-contained config (fields, columns, empty template, search keys,
// description). Pages import the specific configs they own:
//   - AdvancedPage    → resolvers, peers, mailers, rings, securityProfiles, maps
//   - CertificatesPage → crtStores
//   - ErrorPagesPage  → httpErrorsSections

const ID_HELP = 'lowercase a-z, 0-9, _, - (starting with a letter); max 63 chars';
const SECTION_NAME_HELP =
  'HAProxy section identifier (letters, digits, _, -); used verbatim in the rendered cfg';

const idColumn = {
  key: 'id',
  label: 'ID',
  sortable: true,
  accessor: row => row.id,
  render: row => <code>{row.id}</code>,
};

const summaryColumn = labeller => ({
  key: 'summary',
  label: 'Summary',
  render: row => <span className="small text-muted">{labeller(row)}</span>,
});

const nameColumn = {
  key: 'name',
  label: 'Name',
  sortable: true,
  accessor: row => row.name,
  render: row => <code>{row.name}</code>,
};

// ---- shared per-item field configs ---------------------------------------

const NAMESERVER_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'address', label: 'Address', type: 'text', required: true, placeholder: '10.96.0.10:53' },
]);

const PEER_MEMBER_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'address', label: 'Address', type: 'text', required: true, placeholder: '10.0.0.1:10000' },
]);

const MAILER_MEMBER_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'address',
    label: 'Address (SMTP relay)',
    type: 'text',
    required: true,
    placeholder: 'smtp.example.com:587',
  },
]);

const RING_SERVER_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text', required: true },
  {
    key: 'address',
    label: 'Address',
    type: 'text',
    required: true,
    placeholder: '10.0.0.50:10514',
  },
]);

const CRT_STORE_ENTRY_FIELDS = Object.freeze([
  { key: 'crt', label: 'Cert file', type: 'text', required: true, placeholder: 'example.com.pem' },
  { key: 'key', label: 'Key file', type: 'text', placeholder: 'leave blank if combined with crt' },
  { key: 'alias', label: 'Alias', type: 'text', placeholder: 'example' },
  { key: 'acme', label: 'ACME ref', type: 'text', placeholder: 'letsencrypt' },
]);

const MAP_ENTRY_FIELDS = Object.freeze([
  {
    key: 'key',
    label: 'Key',
    type: 'text',
    required: true,
    placeholder: '8.8.8.0/24 or example.com',
  },
  { key: 'value', label: 'Value', type: 'text', required: true, placeholder: 'US or be_backend' },
]);

const MAP_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  {
    key: 'name',
    label: 'File name (without .map)',
    type: 'text',
    required: true,
    help: 'Written to /etc/haproxy/maps/<name>.map on every apply. Letters/digits/_/- starting with a letter.',
  },
  { key: 'description', label: 'Description', type: 'text' },
  {
    key: 'entries',
    label: 'Entries',
    type: 'list',
    itemLabel: 'entry',
    itemFields: MAP_ENTRY_FIELDS,
  },
]);

const MAP_TEMPLATE = Object.freeze({
  id: 'geo',
  name: 'geo',
  description: 'Country code lookup by source IP',
  entries: [{ key: '8.8.8.0/24', value: 'US' }],
});

// ---- per-kind field configs ----------------------------------------------

const RESOLVER_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  {
    key: 'nameservers',
    label: 'Nameservers',
    type: 'list',
    required: true,
    minItems: 1,
    itemLabel: 'nameserver',
    itemFields: NAMESERVER_FIELDS,
  },
  {
    key: 'acceptedPayloadSize',
    label: 'Accepted payload size (bytes)',
    type: 'number',
    min: 512,
    max: 65_535,
    help: 'Optional. Default 512; raise for large DNS responses.',
  },
  { key: 'resolveRetries', label: 'Resolve retries', type: 'number', min: 0, max: 20 },
  { key: 'holdValid', label: 'Hold valid', type: 'text', placeholder: '10s' },
  { key: 'holdObsolete', label: 'Hold obsolete', type: 'text', placeholder: '30s' },
  { key: 'holdNx', label: 'Hold NX', type: 'text', placeholder: '30s' },
  { key: 'timeoutResolve', label: 'Timeout resolve', type: 'text', placeholder: '1s' },
  { key: 'timeoutRetry', label: 'Timeout retry', type: 'text', placeholder: '1s' },
]);

const PEER_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  {
    key: 'peers',
    label: 'Peer members',
    type: 'list',
    required: true,
    minItems: 1,
    itemLabel: 'peer',
    itemFields: PEER_MEMBER_FIELDS,
  },
]);

const MAILER_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  {
    key: 'timeout',
    label: 'Timeout',
    type: 'text',
    placeholder: '10s',
    help: 'Optional. Per-mail SMTP relay timeout.',
  },
  {
    key: 'mailers',
    label: 'Mailer members',
    type: 'list',
    required: true,
    minItems: 1,
    itemLabel: 'mailer',
    itemFields: MAILER_MEMBER_FIELDS,
  },
]);

const RING_FORMAT_OPTIONS = Object.freeze([
  { value: 'raw', label: 'raw' },
  { value: 'rfc3164', label: 'rfc3164' },
  { value: 'rfc5424', label: 'rfc5424' },
  { value: 'short', label: 'short' },
  { value: 'priority', label: 'priority' },
  { value: 'timed', label: 'timed' },
  { value: 'iso', label: 'iso' },
]);

const RING_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  { key: 'description', label: 'Description', type: 'text' },
  {
    key: 'format',
    label: 'Format',
    type: 'select',
    allowEmpty: true,
    options: RING_FORMAT_OPTIONS,
    help: 'Optional. Match what your log collector expects.',
  },
  { key: 'maxlen', label: 'Max line length (bytes)', type: 'number', min: 80, placeholder: '1200' },
  { key: 'size', label: 'Buffer size (bytes)', type: 'number', min: 1024, placeholder: '32764' },
  { key: 'timeoutConnect', label: 'Timeout connect', type: 'text', placeholder: '5s' },
  { key: 'timeoutServer', label: 'Timeout server', type: 'text', placeholder: '10s' },
  {
    key: 'servers',
    label: 'Log servers',
    type: 'list',
    required: true,
    minItems: 1,
    itemLabel: 'server',
    itemFields: RING_SERVER_FIELDS,
  },
]);

const CRT_STORE_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  { key: 'crtBase', label: 'Cert base path', type: 'text', placeholder: '/etc/haproxy/ssl' },
  { key: 'keyBase', label: 'Key base path', type: 'text', placeholder: '/etc/haproxy/ssl' },
  {
    key: 'loadEntries',
    label: 'Cert entries',
    type: 'list',
    itemLabel: 'entry',
    itemFields: CRT_STORE_ENTRY_FIELDS,
    help: 'Optional in Phase 1. Wave L wires `crt @store/alias` references into frontend binds.',
  },
]);

const RATE_LIMIT_CONFIG_FIELDS = Object.freeze([
  {
    key: 'tableSize',
    label: 'Stick-table size',
    type: 'text',
    placeholder: '100k',
    help: 'Size with k/m/g suffix (e.g. 100k, 1m).',
  },
  { key: 'tableExpire', label: 'Stick-table expire', type: 'text', placeholder: '60s' },
  {
    key: 'store',
    label: 'Stored counters',
    type: 'string-list',
    itemLabel: 'counter',
    help: 'HAProxy `stick-table store ...` fetches (e.g. `conn_rate(10s)`, `http_req_rate(60s)`).',
  },
  {
    key: 'trackBy',
    label: 'Track by',
    type: 'text',
    placeholder: 'src',
    help: 'Sample expression to track (typically `src` for per-IP).',
  },
  {
    key: 'denyThreshold',
    label: 'Deny threshold',
    type: 'number',
    min: 1,
    placeholder: '100',
    help: 'Requests over this counter value trigger the deny.',
  },
  {
    key: 'denyStatus',
    label: 'Deny status code',
    type: 'number',
    min: 400,
    max: 599,
    placeholder: '429',
  },
  {
    key: 'counterExpression',
    label: 'Counter expression',
    type: 'text',
    placeholder: 'sc_http_req_rate(0)',
    help: 'HAProxy sample expression compared against the threshold.',
  },
]);

const GEO_BLOCK_CONFIG_FIELDS = Object.freeze([
  {
    key: 'mapRef',
    label: 'Geo map ref',
    type: 'text',
    required: true,
    placeholder: '/etc/haproxy/geo.map',
    help: 'Path to a `src,map_ip` lookup map (country-code values).',
  },
  {
    key: 'allowList',
    label: 'Allow list (country codes)',
    type: 'string-list',
    itemLabel: 'country code',
    help: '2- or 3-letter ISO country codes (e.g. US, GB).',
  },
  {
    key: 'denyList',
    label: 'Deny list (country codes)',
    type: 'string-list',
    itemLabel: 'country code',
  },
  {
    key: 'denyStatus',
    label: 'Deny status code',
    type: 'number',
    min: 400,
    max: 599,
    placeholder: '403',
  },
]);

const BOT_DEFENSE_CONFIG_FIELDS = Object.freeze([
  {
    key: 'uaDenyPatterns',
    label: 'User-Agent deny patterns',
    type: 'string-list',
    itemLabel: 'pattern',
    help: 'Substring or regex patterns matched against the User-Agent header.',
  },
  {
    key: 'uaAllowPatterns',
    label: 'User-Agent allow patterns (whitelist)',
    type: 'string-list',
    itemLabel: 'pattern',
  },
  {
    key: 'denyStatus',
    label: 'Deny status code',
    type: 'number',
    min: 400,
    max: 599,
    placeholder: '403',
  },
]);

const SECURITY_PROFILE_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'label', label: 'Display label', type: 'text', required: true },
  {
    key: 'kind',
    label: 'Kind',
    type: 'discriminated-union',
    configKey: 'config',
    options: [
      { value: 'rate-limit', label: 'Rate limit', fields: RATE_LIMIT_CONFIG_FIELDS },
      { value: 'geo-block', label: 'Geo block', fields: GEO_BLOCK_CONFIG_FIELDS },
      { value: 'bot-defense', label: 'Bot defense', fields: BOT_DEFENSE_CONFIG_FIELDS },
    ],
    help: 'Phase 2 (v0.2.33+) wires the renderer for routes that reference this profile.',
  },
]);

// ---- empty templates -----------------------------------------------------

const RESOLVER_TEMPLATE = Object.freeze({
  id: 'k8s-dns',
  name: 'k8s_dns',
  nameservers: [{ name: 'cluster', address: '10.96.0.10:53' }],
  holdValid: '10s',
  resolveRetries: 3,
});

const PEER_TEMPLATE = Object.freeze({
  id: 'cluster-peers',
  name: 'cluster_peers',
  peers: [
    { name: 'self', address: '10.0.0.1:10000' },
    { name: 'other', address: '10.0.0.2:10000' },
  ],
});

const MAILER_TEMPLATE = Object.freeze({
  id: 'oncall',
  name: 'oncall_mailers',
  timeout: '10s',
  mailers: [{ name: 'smtp1', address: 'smtp.example.com:587' }],
});

const RING_TEMPLATE = Object.freeze({
  id: 'syslog-ring',
  name: 'syslog_ring',
  format: 'rfc5424',
  maxlen: 1200,
  size: 32_764,
  timeoutConnect: '5s',
  timeoutServer: '10s',
  servers: [{ name: 'collector', address: '10.0.0.50:10514' }],
});

const CRT_STORE_TEMPLATE = Object.freeze({
  id: 'letsencrypt',
  name: 'letsencrypt',
  crtBase: '/etc/haproxy/ssl',
  keyBase: '/etc/haproxy/ssl',
  loadEntries: [{ crt: 'example.com.pem', alias: 'example' }],
});

const SECURITY_PROFILE_TEMPLATE = Object.freeze({
  id: 'edge-rate-limit',
  kind: 'rate-limit',
  label: 'Edge rate limit (100 req/min per IP)',
  config: {
    tableSize: '100k',
    tableExpire: '60s',
    store: ['conn_rate(10s)', 'http_req_rate(60s)', 'http_err_rate(30s)'],
    trackBy: 'src',
    denyThreshold: 100,
    denyStatus: 429,
    counterExpression: 'sc_http_req_rate(0)',
  },
});

const HTTP_ERRORS_SECTION_TEMPLATE = Object.freeze({
  id: 'branded',
  name: 'branded',
  errorFiles: {
    503: '/etc/haproxy/errors/branded/503.http',
  },
});

// ---- final section configs ----------------------------------------------

export const RESOLVERS_SECTION = Object.freeze({
  key: 'resolvers',
  label: 'Resolver',
  title: 'Resolvers',
  docPath: ['resolvers'],
  description:
    'Additional `resolvers NAME { ... }` sections for DNS-based service discovery (k8s, public resolvers, internal split-horizon). The bundled `resolvers docker` section for Docker DNS still emits at the top of the rendered config.',
  emptyTemplate: RESOLVER_TEMPLATE,
  fields: RESOLVER_FIELDS,
  columns: [
    idColumn,
    nameColumn,
    summaryColumn(row => `${row.nameservers?.length ?? 0} nameservers`),
  ],
  searchFields: ['id', 'name'],
});

export const PEERS_SECTION = Object.freeze({
  key: 'peers',
  label: 'Peer group',
  title: 'Peers',
  docPath: ['peers'],
  description:
    'Stick-table synchronization across HAProxy instances (HA pair or cluster). Each peer group is rendered as `peers NAME { peer ... }` and can be referenced from backend stick-tables (Wave L).',
  emptyTemplate: PEER_TEMPLATE,
  fields: PEER_FIELDS,
  columns: [idColumn, nameColumn, summaryColumn(row => `${row.peers?.length ?? 0} peers`)],
  searchFields: ['id', 'name'],
});

export const MAILERS_SECTION = Object.freeze({
  key: 'mailers',
  label: 'Mailer group',
  title: 'Mailers',
  docPath: ['mailers'],
  description:
    'SMTP relay groups for HAProxy `email-alert` notifications on server up/down. Phase 2 wires per-backend `email-alert` directives that reference these.',
  emptyTemplate: MAILER_TEMPLATE,
  fields: MAILER_FIELDS,
  columns: [idColumn, nameColumn, summaryColumn(row => `${row.mailers?.length ?? 0} mailers`)],
  searchFields: ['id', 'name'],
});

export const RINGS_SECTION = Object.freeze({
  key: 'rings',
  label: 'Ring',
  title: 'Rings',
  docPath: ['rings'],
  description:
    'Buffered async log shipping over TCP syslog (RFC 5424 / RFC 3164). Phase 2 lets the logs page point at a ring for shipping to Loki / Vector / Fluent-Bit collectors.',
  emptyTemplate: RING_TEMPLATE,
  fields: RING_FIELDS,
  columns: [
    idColumn,
    nameColumn,
    {
      key: 'format',
      label: 'Format',
      render: row => <Badge bg="info">{row.format ?? 'raw'}</Badge>,
    },
    summaryColumn(row => `${row.servers?.length ?? 0} servers`),
  ],
  searchFields: ['id', 'name', 'format'],
});

export const CRT_STORES_SECTION = Object.freeze({
  key: 'crtStores',
  label: 'Cert store',
  title: 'Cert stores',
  docPath: ['crtStores'],
  description:
    'HAProxy 3.3 `crt-store NAME { ... }` sections decouple cert file paths from frontend references via aliases. Wave L wires these into frontend `crt @store/alias` references and the native ACME flow.',
  emptyTemplate: CRT_STORE_TEMPLATE,
  fields: CRT_STORE_FIELDS,
  columns: [
    idColumn,
    nameColumn,
    summaryColumn(row => `${row.loadEntries?.length ?? 0} cert entries`),
  ],
  searchFields: ['id', 'name'],
});

export const MAPS_SECTION = Object.freeze({
  key: 'maps',
  label: 'Map',
  title: 'Maps',
  docPath: ['maps'],
  description:
    'File-backed key→value lookup tables (HAProxy `map_*` converters). Each map is written to `/etc/haproxy/maps/<name>.map` on every apply — no need to touch Raw State to add or remove entries. To USE a map, reference it from a frontend advanced directive (e.g. `http-request set-header X-Country %[src,map_ip(/etc/haproxy/maps/geo.map,unknown)]`) or via a `use_backend ... if { req.hdr(host) -m str -f /etc/haproxy/maps/host_to_be.map }` rule.',
  emptyTemplate: MAP_TEMPLATE,
  fields: MAP_FIELDS,
  columns: [idColumn, nameColumn, summaryColumn(row => `${row.entries?.length ?? 0} entries`)],
  searchFields: ['id', 'name', 'description'],
});

export const SECURITY_PROFILES_SECTION = Object.freeze({
  key: 'securityProfiles',
  label: 'Security profile',
  title: 'Security profiles',
  docPath: ['securityProfiles'],
  description:
    'Reusable security policies (`rate-limit`, `geo-block`, `bot-defense`). Rules invoke them via the `apply-security-profile` action; the renderer expands each invocation into the matching ACL + stick-table + deny chain, gated on the rule condition.',
  emptyTemplate: SECURITY_PROFILE_TEMPLATE,
  fields: SECURITY_PROFILE_FIELDS,
  columns: [
    idColumn,
    {
      key: 'kind',
      label: 'Kind',
      sortable: true,
      accessor: row => row.kind,
      render: row => (
        <Badge bg="warning" text="dark">
          {row.kind}
        </Badge>
      ),
    },
    { key: 'label', label: 'Label', render: row => row.label ?? '' },
  ],
  searchFields: ['id', 'kind', 'label'],
});

export const HTTP_ERRORS_SECTIONS_SECTION = Object.freeze({
  key: 'httpErrorsSections',
  label: 'Error pages section',
  title: 'Error pages sections',
  docPath: ['httpErrorsSections'],
  description:
    'Named `http-errors NAME { errorfile … }` blocks for serving alternate error-page bundles. Frontends and Defaults blocks reference one via their `useErrorFilesId` field. Unknown status codes are dropped on parse — only the canonical 19 are accepted.',
  emptyTemplate: HTTP_ERRORS_SECTION_TEMPLATE,
  columns: [
    idColumn,
    nameColumn,
    summaryColumn(row => `${Object.keys(row.errorFiles ?? {}).length} errorfiles`),
  ],
  searchFields: ['id', 'name'],
});
