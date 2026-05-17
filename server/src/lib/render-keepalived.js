// Render /etc/keepalived/keepalived.conf from state.keepalived (shared) +
// node.yaml (per-node priority/state/interface overrides).
//
// Per-node fields come from node.yaml.vrrp[instanceId]. If an instance has
// no entry in node.yaml.vrrp, this node does NOT participate in that VIP
// (the vrrp_instance block is skipped on this node only). That's how we
// model "this node hosts these VIPs but not those" without baking node-
// specific values into the synced state.

const indent = (lines, n = 4) => {
  const pad = ' '.repeat(n);
  return lines.map(line => (line.length > 0 ? `${pad}${line}` : line));
};

const block = (header, lines) => [`${header} {`, ...indent(lines), '}', ''];

const renderGlobalDefs = globalDefs => {
  const lines = [];
  if (globalDefs.routerId) {
    lines.push(`router_id ${globalDefs.routerId}`);
  }
  if (globalDefs.notificationEmail.length > 0) {
    lines.push('notification_email {');
    for (const email of globalDefs.notificationEmail) {
      lines.push(`    ${email}`);
    }
    lines.push('}');
  }
  if (globalDefs.notificationEmailFrom) {
    lines.push(`notification_email_from ${globalDefs.notificationEmailFrom}`);
  }
  if (globalDefs.smtpServer) {
    lines.push(`smtp_server ${globalDefs.smtpServer}`);
  }
  if (typeof globalDefs.smtpConnectTimeout === 'number') {
    lines.push(`smtp_connect_timeout ${globalDefs.smtpConnectTimeout}`);
  }
  if (globalDefs.vrrpStrict) {
    lines.push('vrrp_strict');
  }
  if (globalDefs.vrrpSkipCheckAdvAddr) {
    lines.push('vrrp_skip_check_adv_addr');
  }
  if (typeof globalDefs.vrrpGarpInterval === 'number') {
    lines.push(`vrrp_garp_interval ${globalDefs.vrrpGarpInterval}`);
  }
  if (typeof globalDefs.vrrpGnaInterval === 'number') {
    lines.push(`vrrp_gna_interval ${globalDefs.vrrpGnaInterval}`);
  }
  if (lines.length === 0) {
    return [];
  }
  return block('global_defs', lines);
};

const renderTrackScript = script => {
  // Escape backslashes BEFORE quotes so the quote-escape doesn't get its own
  // backslash mangled. Catches operator scripts that legitimately use \" or
  // \\ in their command line.
  const escaped = script.script.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
  const lines = [`script "${escaped}"`];
  lines.push(`interval ${script.interval}`);
  if (typeof script.timeout === 'number') {
    lines.push(`timeout ${script.timeout}`);
  }
  if (script.weight !== 0) {
    lines.push(`weight ${script.weight}`);
  }
  if (typeof script.fall === 'number') {
    lines.push(`fall ${script.fall}`);
  }
  if (typeof script.rise === 'number') {
    lines.push(`rise ${script.rise}`);
  }
  if (script.initFail) {
    lines.push('init_fail');
  }
  return block(`vrrp_script ${script.name ?? script.id}`, lines);
};

const renderSyncGroup = (group, instanceMap) => {
  const lines = [];
  const groupInstanceNames = group.instanceIds
    .map(id => instanceMap.get(id)?.name)
    .filter(name => typeof name === 'string');
  if (groupInstanceNames.length === 0) {
    return [];
  }
  lines.push('group {');
  for (const name of groupInstanceNames) {
    lines.push(`    ${name}`);
  }
  lines.push('}');
  if (group.notifyMaster) {
    lines.push(`notify_master ${group.notifyMaster}`);
  }
  if (group.notifyBackup) {
    lines.push(`notify_backup ${group.notifyBackup}`);
  }
  if (group.notifyFault) {
    lines.push(`notify_fault ${group.notifyFault}`);
  }
  return block(`vrrp_sync_group ${group.name}`, lines);
};

const renderInstance = (instance, nodeEntry, trackScriptMap) => {
  const lines = [];
  // Per-node bits — fall back to sensible defaults if node.yaml didn't
  // declare overrides for this instance (shouldn't happen in normal flow;
  // the loader filters to only participating instances).
  const ifaceName = nodeEntry?.interface ?? 'eth0';
  const state = nodeEntry?.state ?? 'BACKUP';
  const priority = nodeEntry?.priority ?? 100;
  lines.push(`state ${state}`);
  lines.push(`interface ${ifaceName}`);
  lines.push(`virtual_router_id ${instance.virtualRouterId}`);
  lines.push(`priority ${priority}`);
  lines.push(`advert_int ${instance.advertInt}`);
  if (!instance.preempt) {
    lines.push('nopreempt');
  }
  if (typeof instance.preemptDelay === 'number' && instance.preempt) {
    lines.push(`preempt_delay ${instance.preemptDelay}`);
  }
  if (typeof instance.garpMasterDelay === 'number') {
    lines.push(`garp_master_delay ${instance.garpMasterDelay}`);
  }
  // Authentication block (PASS is the common case; auth_pass must be ≤8 chars).
  lines.push('authentication {');
  lines.push(`    auth_type ${instance.authType}`);
  lines.push(`    auth_pass ${instance.authPass}`);
  lines.push('}');
  // VIP block.
  lines.push('virtual_ipaddress {');
  lines.push(`    ${instance.vip}/${instance.prefix}`);
  lines.push('}');
  // Track scripts referenced by id → resolve to their names.
  const trackedNames = (instance.trackScriptIds ?? [])
    .map(id => trackScriptMap.get(id)?.name ?? trackScriptMap.get(id)?.id)
    .filter(Boolean);
  if (trackedNames.length > 0) {
    lines.push('track_script {');
    for (const name of trackedNames) {
      lines.push(`    ${name}`);
    }
    lines.push('}');
  }
  return block(`vrrp_instance ${instance.name}`, lines);
};

const renderHeader = nodeId => [
  '# keepalived.conf — rendered by patchpanel',
  `# node: ${nodeId}`,
  `# generated: ${new Date().toISOString()}`,
  '# DO NOT EDIT BY HAND — changes will be overwritten on next state apply.',
  '',
];

export const renderKeepalivedConfig = (state, nodeConfig) => {
  const ka = state.keepalived ?? {
    enabled: false,
    instances: [],
    syncGroups: [],
    trackScripts: [],
  };
  const nodeId = nodeConfig?.nodeId ?? 'unknown';
  const vrrpOverrides = nodeConfig?.vrrp ?? {};

  const instanceMap = new Map((ka.instances ?? []).map(i => [i.id, i]));
  const trackScriptMap = new Map((ka.trackScripts ?? []).map(s => [s.id, s]));

  const lines = [...renderHeader(nodeId)];

  if (!ka.enabled) {
    lines.push('# keepalived is disabled in state (state.keepalived.enabled = false).');
    lines.push('# This file is intentionally near-empty.');
    return `${lines.join('\n')}\n`;
  }

  // Always emit a global_defs block — even if empty, keepalived expects it.
  const globalDefsLines = renderGlobalDefs(ka.globalDefs ?? {});
  if (globalDefsLines.length > 0) {
    lines.push(...globalDefsLines);
  } else {
    lines.push(...block('global_defs', [`router_id ${nodeId}`]));
  }

  // Track scripts come before vrrp_instance blocks so the instance refs resolve.
  for (const script of ka.trackScripts ?? []) {
    lines.push(...renderTrackScript(script));
  }

  // Only emit instances this node participates in (i.e., has an entry in
  // node.yaml.vrrp). Instances with `enabled: false` in shared state are
  // skipped on every node.
  const participatingInstances = (ka.instances ?? []).filter(
    inst => inst.enabled !== false && Object.hasOwn(vrrpOverrides, inst.id)
  );
  for (const inst of participatingInstances) {
    lines.push(...renderInstance(inst, vrrpOverrides[inst.id], trackScriptMap));
  }

  // Sync groups only make sense if at least one referenced instance is
  // participating on this node; otherwise we skip the sync_group block.
  for (const group of ka.syncGroups ?? []) {
    const hasAnyParticipating = group.instanceIds.some(id =>
      participatingInstances.find(p => p.id === id)
    );
    if (hasAnyParticipating) {
      lines.push(...renderSyncGroup(group, instanceMap));
    }
  }

  return `${lines.join('\n')}\n`;
};
