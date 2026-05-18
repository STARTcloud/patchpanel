import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Badge, Button, Dropdown, Form, InputGroup, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { useSystemInterfaces } from '../hooks/useSystemInterfaces.jsx';

// Grouped combobox for HAProxy bind addresses. Free text remains allowed
// (HAProxy syntax is too varied for a strict whitelist: hostnames, sockets,
// fd@N, abns@..., ipv6@... are all valid forms). Groups in display order:
//
//   1. Common      — *, 0.0.0.0, [::], 127.0.0.1, ::1 (hardcoded)
//   2. Interfaces  — host interfaces detected via /api/system/interfaces
//   3. Bridges     — container bridge addresses (when present)
//   4. Floating    — state.keepalived.instances[] VIPs. Selecting one ALSO
//                    sets bind.floatingIpInstanceId; selecting any other
//                    option clears it.
//   5. Saved       — state.ui.savedBindAddresses[] presets (when non-empty)
//   6. Other       — Unix socket, abns@, fd@, Custom… prompts that drop to
//                    free text
//
// Behavior is "type or pick" — the input is always editable, the dropdown
// only suggests. The picker NEVER auto-injects bindOptions (no magic
// `transparent`) — when an address isn't on any local interface AND isn't
// a sentinel, we surface an inline warning telling the operator what they
// likely need to do.
//
// HAProxy bind.address is the full host:port string (e.g. 172.17.1.55:443).
// Dropdown options expose the bare host part. When the operator picks one,
// we preserve the existing trailing :port in the value so they don't have
// to retype it. Likewise, the floating-IP / interface / "unreachable here"
// detections strip the port off the current value before comparing to the
// bare-IP option list.

const COMMON_OPTIONS = Object.freeze([
  {
    value: '*',
    subtitleKey: 'haproxy:bindPicker.subtitle.all',
    subtitleFallback: 'all interfaces (dual-stack)',
  },
  {
    value: '0.0.0.0',
    subtitleKey: 'haproxy:bindPicker.subtitle.allV4',
    subtitleFallback: 'all IPv4 interfaces',
  },
  {
    value: '[::]',
    subtitleKey: 'haproxy:bindPicker.subtitle.allV6',
    subtitleFallback: 'all IPv6 interfaces',
  },
  {
    value: '127.0.0.1',
    subtitleKey: 'haproxy:bindPicker.subtitle.loopbackV4',
    subtitleFallback: 'IPv4 loopback',
  },
  {
    value: '::1',
    subtitleKey: 'haproxy:bindPicker.subtitle.loopbackV6',
    subtitleFallback: 'IPv6 loopback',
  },
]);

const stripBrackets = s =>
  typeof s === 'string' && s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s;

const isSentinelHost = host =>
  COMMON_OPTIONS.some(o => o.value === host || stripBrackets(o.value) === host);

// Non-network address forms HAProxy supports — Unix sockets, abstract
// namespace, pre-opened fds. None of these take a :port suffix.
const looksLikeNonNetworkAddress = addr =>
  typeof addr === 'string' &&
  (addr.startsWith('/') ||
    addr.startsWith('unix@') ||
    addr.startsWith('abns@') ||
    addr.startsWith('fd@'));

// Extract a trailing port (as a string) from an HAProxy address. Returns
// null when no port is present, or when the address is a non-network form.
const extractPort = addr => {
  if (typeof addr !== 'string' || addr.length === 0) {
    return null;
  }
  if (looksLikeNonNetworkAddress(addr)) {
    return null;
  }
  // Bracketed IPv6 with port: [::1]:443
  const bracketMatch = addr.match(/^\[[^\]]+\]:(?<port>\d+)$/u);
  if (bracketMatch) {
    return bracketMatch.groups.port;
  }
  // host:port with exactly one colon (covers *:443, 0.0.0.0:443, IPv4:port,
  // hostname:port). Bare IPv6 like 2001:db8::1 has many colons and matches
  // nothing here — falls through to "no port".
  const colonCount = (addr.match(/:/gu) ?? []).length;
  if (colonCount === 1) {
    const [, port] = addr.split(':');
    if (/^\d+$/u.test(port)) {
      return port;
    }
  }
  return null;
};

// Strip a trailing port to recover just the host part. Used to compare the
// current bind.address (host:port) against the bare-IP options that come
// out of the interface enumeration / VIP definitions.
const stripPort = addr => {
  if (typeof addr !== 'string' || addr.length === 0) {
    return '';
  }
  if (looksLikeNonNetworkAddress(addr)) {
    return addr;
  }
  const bracketMatch = addr.match(/^\[(?<host>[^\]]+)\](?::\d+)?$/u);
  if (bracketMatch) {
    return bracketMatch.groups.host;
  }
  const colonCount = (addr.match(/:/gu) ?? []).length;
  if (colonCount === 1) {
    return addr.split(':')[0];
  }
  return addr;
};

// True for an unbracketed IPv6 literal (has ≥2 colons, no brackets, not
// otherwise structured). Needs to be wrapped in [] before a port can be
// appended.
const isUnbracketedIpv6 = addr =>
  typeof addr === 'string' &&
  !addr.startsWith('[') &&
  !looksLikeNonNetworkAddress(addr) &&
  (addr.match(/:/gu) ?? []).length >= 2;

// Compose a final bind.address from a dropdown pick (`newHost`) + the
// operator's current value (for port preservation). Rules:
//   - Non-network forms (paths, fd@…) pass through unchanged.
//   - If newHost already includes a port, use it as-is.
//   - Otherwise, port-preserve from the existing value; bare IPv6 hosts
//     get bracketed so the resulting form is valid HAProxy syntax.
const composeAddress = (newHost, existingValue) => {
  if (looksLikeNonNetworkAddress(newHost)) {
    return newHost;
  }
  if (extractPort(newHost) !== null) {
    return newHost;
  }
  const port = extractPort(existingValue);
  if (!port) {
    return newHost;
  }
  if (isUnbracketedIpv6(newHost)) {
    return `[${newHost}]:${port}`;
  }
  return `${newHost}:${port}`;
};

const promptOnce = (label, placeholder) => {
  if (typeof window === 'undefined') {
    return null;
  }
  // eslint-disable-next-line no-alert -- escape hatch for rare custom forms; a full modal flow would dwarf the picker.
  const raw = window.prompt(label, placeholder ?? '');
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const OptionRow = ({ value, subtitle, badge, badgeBg = 'secondary', onPick }) => (
  <Dropdown.Item
    onClick={() => onPick(value)}
    className="d-flex justify-content-between align-items-center gap-2"
  >
    <code className="small">{value}</code>
    <span className="text-muted small d-flex align-items-center gap-2">
      {badge ? (
        <Badge bg={badgeBg} className="small">
          {badge}
        </Badge>
      ) : null}
      {subtitle}
    </span>
  </Dropdown.Item>
);

OptionRow.propTypes = {
  value: PropTypes.string.isRequired,
  subtitle: PropTypes.node,
  badge: PropTypes.node,
  badgeBg: PropTypes.string,
  onPick: PropTypes.func.isRequired,
};

const matches = (value, filter) => {
  if (!filter) {
    return true;
  }
  return value.toLowerCase().includes(filter.toLowerCase());
};

// Pure derivation: classify the operator's current address against the
// detected local interfaces + configured VIPs. Extracted so BindAddressPicker
// itself stays under the complexity ceiling.
const computeAddressContext = (value, detectedHosts, floatingIps) => {
  const currentHost = stripPort(value ?? '');
  const isNonNetwork = looksLikeNonNetworkAddress(currentHost);
  const isFloating = !isNonNetwork && floatingIps.some(vi => vi.vip === currentHost);
  const isSentinel = !isNonNetwork && isSentinelHost(currentHost);
  const searchable = Boolean(currentHost) && !isNonNetwork && !isSentinel && !isFloating;
  const looksNodeLocal = searchable && detectedHosts.includes(currentHost);
  const isUnreachableHere =
    searchable && detectedHosts.length > 0 && !detectedHosts.includes(currentHost);
  return { isFloating, looksNodeLocal, isUnreachableHere };
};

const AddressWarnings = ({
  floatingIpInstanceId,
  value,
  onChange,
  isUnreachableHere,
  isFloating,
  looksNodeLocal,
}) => {
  const { t } = useTranslation(['haproxy', 'common']);
  return (
    <>
      {floatingIpInstanceId ? (
        <Form.Text className="text-info d-block mt-1">
          <i className="bi bi-link me-1" />
          {t('haproxy:bindPicker.warnings.associatedWithVip', 'Associated with VIP')}{' '}
          <code>{floatingIpInstanceId}</code>.{' '}
          <Button
            variant="link"
            size="sm"
            className="p-0 align-baseline"
            onClick={() => onChange({ address: value, floatingIpInstanceId: null })}
          >
            {t('haproxy:bindPicker.warnings.disassociate', 'Disassociate')}
          </Button>
        </Form.Text>
      ) : null}

      {isUnreachableHere ? (
        <Form.Text className="text-warning d-block mt-1">
          <i className="bi bi-exclamation-triangle me-1" />
          {t(
            'haproxy:bindPicker.warnings.unreachable',
            "This address isn't on any local interface and doesn't match any VIP. HAProxy will fail to bind unless transparent is set in this bind's options and net.ipv4.ip_nonlocal_bind=1 is set on the host. patchpanel will not configure either for you."
          )}
        </Form.Text>
      ) : null}

      {isFloating ? (
        <Form.Text className="text-warning d-block mt-1">
          <i className="bi bi-exclamation-triangle me-1" />
          {t(
            'haproxy:bindPicker.warnings.floating',
            "This is a floating IP managed by keepalived. To make HAProxy start even when this node isn't holding the VIP, add transparent to bindOptions and set net.ipv4.ip_nonlocal_bind=1 on the host. patchpanel will not do either for you."
          )}
        </Form.Text>
      ) : null}

      {looksNodeLocal && !isFloating ? (
        <Form.Text className="text-muted d-block mt-1">
          <i className="bi bi-info-circle me-1" />
          {t(
            'haproxy:bindPicker.warnings.nodeLocal',
            'This address only exists on this node — other cluster nodes will fail to bind it.'
          )}
        </Form.Text>
      ) : null}
    </>
  );
};

AddressWarnings.propTypes = {
  floatingIpInstanceId: PropTypes.string,
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  isUnreachableHere: PropTypes.bool.isRequired,
  isFloating: PropTypes.bool.isRequired,
  looksNodeLocal: PropTypes.bool.isRequired,
};

export const BindAddressPicker = ({
  value,
  floatingIpInstanceId = null,
  onChange,
  floatingIps = [],
  savedAddresses = [],
}) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [showFiltered, setShowFiltered] = useState(false);
  const { groups, filtered, loading, error, refresh } = useSystemInterfaces({ showFiltered });
  const [filterText, setFilterText] = useState('');

  const detectedHosts = useMemo(
    () => groups.flatMap(g => (g.addresses ?? []).map(a => a.ip)),
    [groups]
  );

  const { isFloating, looksNodeLocal, isUnreachableHere } = computeAddressContext(
    value,
    detectedHosts,
    floatingIps
  );

  // Pick a value as the address. If it came from a floating IP, set the
  // floatingIpInstanceId; otherwise clear it. composeAddress preserves any
  // existing :port suffix so operators don't have to retype it.
  const pickAddress = newHost =>
    onChange({ address: composeAddress(newHost, value), floatingIpInstanceId: null });
  const pickRaw = next => onChange({ address: next, floatingIpInstanceId: null });
  const pickFloatingIp = (newHost, instanceId) =>
    onChange({ address: composeAddress(newHost, value), floatingIpInstanceId: instanceId });

  const handleCustom = () => {
    const v = promptOnce(
      t(
        'haproxy:bindPicker.prompts.custom',
        'Enter a bind address (hostname, IP, or HAProxy address form):'
      ),
      value || ''
    );
    if (v !== null) {
      pickRaw(v);
    }
  };

  const handleSocket = () => {
    const v = promptOnce(
      t('haproxy:bindPicker.prompts.socket', 'Unix socket path:'),
      '/var/run/haproxy.sock'
    );
    if (v !== null) {
      pickRaw(v);
    }
  };

  const handleAbns = () => {
    const v = promptOnce(
      t('haproxy:bindPicker.prompts.abns', 'Abstract namespace socket name (abns@…):'),
      ''
    );
    if (v !== null) {
      pickRaw(`abns@${v}`);
    }
  };

  const handleFd = () => {
    const v = promptOnce(t('haproxy:bindPicker.prompts.fd', 'Pre-opened fd number (fd@…):'), '');
    if (v !== null) {
      pickRaw(`fd@${v}`);
    }
  };

  const getFilteredLabel = () => {
    if (showFiltered) {
      return t('haproxy:bindPicker.showingFiltered', 'Showing filtered');
    }
    if (filtered > 0) {
      return t('haproxy:bindPicker.showFilteredCount', 'Show filtered ({{count}})', {
        count: filtered,
      });
    }
    return t('haproxy:bindPicker.showFiltered', 'Show filtered');
  };

  return (
    <>
      <InputGroup>
        <Form.Control
          type="text"
          value={value ?? ''}
          onChange={e => pickRaw(e.target.value)}
          placeholder={t('haproxy:bindPicker.placeholder', 'e.g. *:443 or 172.17.1.55:443')}
        />
        <Dropdown align="end">
          <Dropdown.Toggle variant="outline-secondary" id="bind-addr-picker">
            <i className="bi bi-list" />
          </Dropdown.Toggle>
          <Dropdown.Menu style={{ minWidth: '24rem', maxHeight: '24rem', overflowY: 'auto' }}>
            <div className="px-2 py-1">
              <Form.Control
                size="sm"
                type="text"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
                placeholder={t('haproxy:bindPicker.filter', 'Filter…')}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the operator just opened this dropdown; focusing the filter is the expected affordance.
                autoFocus
              />
            </div>

            <Dropdown.Header>{t('haproxy:bindPicker.groups.common', 'Common')}</Dropdown.Header>
            {COMMON_OPTIONS.filter(o => matches(o.value, filterText)).map(o => (
              <OptionRow
                key={o.value}
                value={o.value}
                subtitle={t(o.subtitleKey, o.subtitleFallback)}
                onPick={pickAddress}
              />
            ))}

            {groups.length > 0
              ? groups.map(group => {
                  const visible = (group.addresses ?? []).filter(
                    a => matches(a.ip, filterText) || matches(a.interface ?? '', filterText)
                  );
                  if (visible.length === 0) {
                    return null;
                  }
                  return (
                    <div key={group.label}>
                      <Dropdown.Header>{group.label}</Dropdown.Header>
                      {visible.map(a => (
                        <OptionRow
                          key={`${a.interface}-${a.ip}`}
                          value={a.ip}
                          subtitle={
                            <>
                              <code className="small me-1">{a.interface}</code>
                              <span>{a.family}</span>
                            </>
                          }
                          onPick={pickAddress}
                        />
                      ))}
                    </div>
                  );
                })
              : null}

            {floatingIps.length > 0 ? (
              <>
                <Dropdown.Header>
                  {t('haproxy:bindPicker.groups.floating', 'Floating IPs (keepalived)')}
                </Dropdown.Header>
                {floatingIps
                  .filter(
                    vi => matches(vi.vip ?? '', filterText) || matches(vi.id ?? '', filterText)
                  )
                  .map(vi => (
                    <OptionRow
                      key={vi.id}
                      value={vi.vip}
                      badge={vi.id}
                      badgeBg="info"
                      subtitle={t('haproxy:bindPicker.subtitle.floating', 'floating')}
                      onPick={host => pickFloatingIp(host, vi.id)}
                    />
                  ))}
              </>
            ) : null}

            {savedAddresses.length > 0 ? (
              <>
                <Dropdown.Header>
                  {t('haproxy:bindPicker.groups.saved', 'Saved presets')}
                </Dropdown.Header>
                {savedAddresses
                  .filter(
                    s => matches(s.address ?? '', filterText) || matches(s.label ?? '', filterText)
                  )
                  .map(s => (
                    <OptionRow
                      key={s.address}
                      value={s.address}
                      subtitle={s.label}
                      onPick={pickRaw}
                    />
                  ))}
              </>
            ) : null}

            <Dropdown.Divider />
            <Dropdown.Header>{t('haproxy:bindPicker.groups.other', 'Other')}</Dropdown.Header>
            <Dropdown.Item onClick={handleSocket}>
              <i className="bi bi-hdd me-2" />
              {t('haproxy:bindPicker.items.unixSocket', 'Unix socket…')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleAbns}>
              <i className="bi bi-link-45deg me-2" />
              {t('haproxy:bindPicker.items.abns', 'Abstract namespace (abns@…)')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleFd}>
              <i className="bi bi-input-cursor me-2" />
              {t('haproxy:bindPicker.items.fd', 'Pre-opened fd (fd@…)')}
            </Dropdown.Item>
            <Dropdown.Item onClick={handleCustom}>
              <i className="bi bi-pencil me-2" />
              {t('haproxy:bindPicker.items.custom', 'Custom address…')}
            </Dropdown.Item>

            <Dropdown.Divider />
            <div className="px-2 py-1 d-flex justify-content-between align-items-center small">
              <Form.Check
                type="switch"
                id="bind-picker-show-filtered"
                label={getFilteredLabel()}
                checked={showFiltered}
                onChange={e => setShowFiltered(e.target.checked)}
                disabled={!showFiltered ? filtered === 0 : null}
              />
              <Button
                variant="link"
                size="sm"
                className="text-decoration-none p-0"
                onClick={refresh}
                disabled={loading}
                title={t('haproxy:bindPicker.reloadTitle', 'Re-fetch interface list')}
              >
                {loading ? (
                  <Spinner as="span" animation="border" size="sm" />
                ) : (
                  <>
                    <i className="bi bi-arrow-clockwise me-1" />
                    {t('haproxy:bindPicker.reload', 'Reload')}
                  </>
                )}
              </Button>
            </div>
            {error ? (
              <div className="px-2 small text-danger">
                {t('haproxy:bindPicker.interfacesUnavailable', 'Interface list unavailable')}:{' '}
                {error.message}
              </div>
            ) : null}
          </Dropdown.Menu>
        </Dropdown>
      </InputGroup>

      <AddressWarnings
        floatingIpInstanceId={floatingIpInstanceId}
        value={value}
        onChange={onChange}
        isUnreachableHere={isUnreachableHere}
        isFloating={isFloating}
        looksNodeLocal={looksNodeLocal}
      />
    </>
  );
};

BindAddressPicker.propTypes = {
  value: PropTypes.string,
  floatingIpInstanceId: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  floatingIps: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      vip: PropTypes.string.isRequired,
    })
  ),
  savedAddresses: PropTypes.arrayOf(
    PropTypes.shape({
      address: PropTypes.string.isRequired,
      label: PropTypes.string,
    })
  ),
};
