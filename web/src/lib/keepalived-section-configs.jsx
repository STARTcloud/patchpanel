import { Badge } from 'react-bootstrap';

// EntitySectionCard configs for the three keepalived collections in
// state.keepalived. Mirrors the shape used by section-configs.jsx for
// resolvers/peers/mailers/etc. — each section feeds an EntitySectionCard +
// EntityFormBuilder. Lives in a separate file because keepalived is a
// distinct concern (HA / VRRP) from the HAProxy named-section infrastructure
// that section-configs.jsx covers.

const ID_HELP = 'lowercase a-z, 0-9, _, - (starting with a letter); max 63 chars';
const SECTION_NAME_HELP =
  'keepalived section identifier (letter-start, letters/digits/_/-). Used verbatim in keepalived.conf.';

const idColumn = {
  key: 'id',
  label: 'ID',
  sortable: true,
  accessor: row => row.id,
  render: row => <code>{row.id}</code>,
};

// ---- VRRP instances --------------------------------------------------

const VRRP_STATE_OPTIONS = Object.freeze([
  { value: 'MASTER', label: 'MASTER (preferred holder)' },
  { value: 'BACKUP', label: 'BACKUP (fail-over target)' },
]);

const AUTH_TYPE_OPTIONS = Object.freeze([
  { value: 'PASS', label: 'PASS (shared password — common)' },
  { value: 'AH', label: 'AH (IPsec Authentication Header — rare)' },
]);

const KEEPALIVED_INSTANCE_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  {
    key: 'enabled',
    label: 'Enabled',
    type: 'switch',
    help: 'When off, this instance is skipped at render time on every node.',
  },
  {
    key: 'vip',
    label: 'Virtual IP',
    type: 'text',
    required: true,
    placeholder: '172.17.205.150',
    help: 'The floating IP that VRRP fails over between nodes.',
  },
  {
    key: 'prefix',
    label: 'Prefix length',
    type: 'number',
    min: 0,
    max: 128,
    placeholder: '24',
    help: 'CIDR prefix for the VIP (e.g. 24 for /24).',
  },
  {
    key: 'virtualRouterId',
    label: 'virtual_router_id',
    type: 'number',
    required: true,
    min: 1,
    max: 255,
    help: 'VRID (1-255). Must be unique per L2 broadcast domain across all VRRP routers.',
  },
  {
    key: 'authType',
    label: 'auth_type',
    type: 'select',
    options: AUTH_TYPE_OPTIONS,
    help: 'Authentication header type. PASS is the common case.',
  },
  {
    key: 'authPass',
    label: 'auth_pass',
    type: 'text',
    placeholder: 'shared-secret',
    help: 'VRRP auth password. Must match between peer nodes on the same VRID. Max 8 characters (VRRP protocol limit).',
  },
  {
    key: 'advertInt',
    label: 'advert_int (seconds)',
    type: 'number',
    min: 1,
    max: 60,
    placeholder: '1',
    help: 'Advertisement interval. Nodes drifting beyond this can split-brain.',
  },
  {
    key: 'preempt',
    label: 'preempt',
    type: 'switch',
    help: 'When on (default), a higher-priority node reclaims MASTER on recovery. Turn off to prevent flapping.',
  },
  {
    key: 'preemptDelay',
    label: 'preempt_delay (seconds)',
    type: 'number',
    min: 0,
    max: 1000,
    help: 'Delay before preempting MASTER. Ignored when preempt is off.',
  },
  {
    key: 'garpMasterDelay',
    label: 'garp_master_delay (seconds)',
    type: 'number',
    min: 0,
    max: 60,
    help: 'Delay before sending the first gratuitous ARP after becoming MASTER.',
  },
  {
    key: 'syncGroupId',
    label: 'sync_group',
    type: 'text',
    placeholder: '(none)',
    help: 'Optional: id of a sync_group this instance belongs to.',
  },
  {
    key: 'trackScriptIds',
    label: 'track_scripts',
    type: 'string-list',
    itemLabel: 'track_script id',
    help: "Health-check script ids whose pass/fail adjusts this instance's priority. Reference state.keepalived.trackScripts[].id.",
  },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'text' },
]);

const KEEPALIVED_INSTANCE_TEMPLATE = Object.freeze({
  id: 'vi_web',
  name: 'vi_web',
  enabled: true,
  vip: '',
  prefix: 24,
  virtualRouterId: 51,
  authType: 'PASS',
  authPass: '',
  advertInt: 1,
  preempt: true,
  syncGroupId: null,
  trackScriptIds: [],
  notes: '',
});

export const KEEPALIVED_INSTANCES_SECTION = Object.freeze({
  key: 'keepalivedInstances',
  label: 'VRRP instance',
  title: 'VRRP instances',
  docPath: ['keepalived', 'instances'],
  description:
    'Floating IP definitions managed by keepalived. Each instance is a VIP that fails over between nodes via VRRP. Per-node priority/state lives in node.yaml — edit this node\'s overrides in the "This node\'s identity" card below.',
  emptyTemplate: KEEPALIVED_INSTANCE_TEMPLATE,
  fields: KEEPALIVED_INSTANCE_FIELDS,
  columns: [
    idColumn,
    {
      key: 'name',
      label: 'Section name',
      sortable: true,
      accessor: row => row.name,
      render: row => <code>{row.name}</code>,
    },
    {
      key: 'enabled',
      label: 'Enabled',
      render: row =>
        row.enabled === false ? (
          <Badge bg="secondary">disabled</Badge>
        ) : (
          <Badge bg="success">enabled</Badge>
        ),
    },
    {
      key: 'vip',
      label: 'VIP',
      sortable: true,
      accessor: row => row.vip,
      render: row => (
        <code>
          {row.vip}
          {row.prefix ? `/${row.prefix}` : ''}
        </code>
      ),
    },
    {
      key: 'virtualRouterId',
      label: 'VRID',
      sortable: true,
      accessor: row => row.virtualRouterId,
      render: row => <Badge bg="info">{row.virtualRouterId}</Badge>,
    },
    {
      key: 'syncGroupId',
      label: 'sync_group',
      render: row =>
        row.syncGroupId ? <code>{row.syncGroupId}</code> : <span className="text-muted">—</span>,
    },
    {
      key: 'trackScriptIds',
      label: 'track_scripts',
      render: row =>
        (row.trackScriptIds ?? []).length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="d-flex flex-wrap gap-1">
            {row.trackScriptIds.map(id => (
              <Badge key={id} bg="secondary">
                {id}
              </Badge>
            ))}
          </span>
        ),
    },
  ],
  searchFields: ['id', 'name', 'vip', 'syncGroupId'],
  // VRRP_STATE_OPTIONS exposed for NodeIdentityCard, which edits the
  // per-node state override (not part of the shared instance definition).
  vrrpStateOptions: VRRP_STATE_OPTIONS,
});

// ---- sync_groups -----------------------------------------------------

const KEEPALIVED_SYNC_GROUP_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  { key: 'name', label: 'Section name', type: 'text', required: true, help: SECTION_NAME_HELP },
  { key: 'description', label: 'Description', type: 'text' },
  {
    key: 'instanceIds',
    label: 'Instance ids',
    type: 'string-list',
    itemLabel: 'instance id',
    help: 'VRRP instance ids that fail over together. Reference state.keepalived.instances[].id.',
  },
  {
    key: 'notifyMaster',
    label: 'notify_master',
    type: 'text',
    help: 'Optional: script path keepalived runs when this group transitions to MASTER.',
  },
  {
    key: 'notifyBackup',
    label: 'notify_backup',
    type: 'text',
    help: 'Optional: script path keepalived runs when this group transitions to BACKUP.',
  },
  {
    key: 'notifyFault',
    label: 'notify_fault',
    type: 'text',
    help: 'Optional: script path keepalived runs when this group enters FAULT state.',
  },
]);

const KEEPALIVED_SYNC_GROUP_TEMPLATE = Object.freeze({
  id: 'dmz',
  name: 'dmz_services',
  instanceIds: [],
});

export const KEEPALIVED_SYNC_GROUPS_SECTION = Object.freeze({
  key: 'keepalivedSyncGroups',
  label: 'sync_group',
  title: 'VRRP sync groups',
  docPath: ['keepalived', 'syncGroups'],
  description:
    'Bundle multiple VRRP instances so failover propagates atomically. When one member transitions, all peers in the group transition with it.',
  emptyTemplate: KEEPALIVED_SYNC_GROUP_TEMPLATE,
  fields: KEEPALIVED_SYNC_GROUP_FIELDS,
  columns: [
    idColumn,
    {
      key: 'name',
      label: 'Section name',
      sortable: true,
      accessor: row => row.name,
      render: row => <code>{row.name}</code>,
    },
    {
      key: 'instanceIds',
      label: 'Instances',
      render: row =>
        (row.instanceIds ?? []).length === 0 ? (
          <span className="text-muted small">none</span>
        ) : (
          <span className="d-flex flex-wrap gap-1">
            {row.instanceIds.map(id => (
              <Badge key={id} bg="secondary">
                {id}
              </Badge>
            ))}
          </span>
        ),
    },
  ],
  searchFields: ['id', 'name'],
});

// ---- track_scripts ---------------------------------------------------

const KEEPALIVED_TRACK_SCRIPT_FIELDS = Object.freeze([
  { key: 'id', label: 'ID', type: 'text', required: true, help: ID_HELP },
  {
    key: 'name',
    label: 'Section name',
    type: 'text',
    help: `${SECTION_NAME_HELP} Optional — falls back to the id when blank.`,
  },
  {
    key: 'script',
    label: 'Script',
    type: 'text',
    required: true,
    placeholder: 'killall -0 haproxy',
    help: 'Shell command keepalived runs to evaluate health. Exit 0 = pass, non-zero = fail.',
  },
  {
    key: 'interval',
    label: 'Interval (seconds)',
    type: 'number',
    min: 1,
    max: 3600,
    placeholder: '2',
    help: 'How often to run the script.',
  },
  {
    key: 'weight',
    label: 'Weight',
    type: 'number',
    placeholder: '2',
    help: 'Priority delta on transition. Positive = priority increases on pass; negative = drops on fail. -254 to 254.',
  },
  {
    key: 'timeout',
    label: 'Timeout (seconds)',
    type: 'number',
    min: 1,
    max: 60,
    placeholder: '3',
  },
  {
    key: 'fall',
    label: 'fall',
    type: 'number',
    min: 1,
    max: 255,
    placeholder: '2',
    help: 'Consecutive failed checks before the script is considered failed.',
  },
  {
    key: 'rise',
    label: 'rise',
    type: 'number',
    min: 1,
    max: 255,
    placeholder: '1',
    help: 'Consecutive successful checks before the script is considered passed.',
  },
  {
    key: 'initFail',
    label: 'init_fail',
    type: 'switch',
    help: 'Treat the script as failed on startup until at least one successful run.',
  },
]);

const KEEPALIVED_TRACK_SCRIPT_TEMPLATE = Object.freeze({
  id: 'chk_haproxy',
  script: 'killall -0 haproxy',
  interval: 2,
  weight: 2,
  timeout: 3,
  fall: 2,
  rise: 1,
  initFail: false,
});

export const KEEPALIVED_TRACK_SCRIPTS_SECTION = Object.freeze({
  key: 'keepalivedTrackScripts',
  label: 'track_script',
  title: 'VRRP track scripts',
  docPath: ['keepalived', 'trackScripts'],
  description:
    "Named health checks referenced by VRRP instances. Failing a check adjusts the instance's priority by the configured weight, which can trigger a failover.",
  emptyTemplate: KEEPALIVED_TRACK_SCRIPT_TEMPLATE,
  fields: KEEPALIVED_TRACK_SCRIPT_FIELDS,
  columns: [
    idColumn,
    {
      key: 'script',
      label: 'Script',
      render: row => <code className="small">{row.script}</code>,
    },
    {
      key: 'interval',
      label: 'Interval',
      render: row => <span>{row.interval ?? 2}s</span>,
    },
    {
      key: 'weight',
      label: 'Weight',
      render: row => <Badge bg={row.weight >= 0 ? 'success' : 'danger'}>{row.weight}</Badge>,
    },
  ],
  searchFields: ['id', 'name', 'script'],
});
