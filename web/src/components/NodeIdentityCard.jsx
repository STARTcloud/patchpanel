import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiGet, apiPut } from '../api/client.js';
import { useSystemInterfaces } from '../hooks/useSystemInterfaces.jsx';

// Edits /etc/patchpanel/node.yaml via /api/node-config. The contract from
// the backend brief:
//
//   GET  /api/node-config   → { nodeId, vrrp: { [instanceId]: { priority, state, interface } } }
//   PUT  /api/node-config   body: same shape
//
// node.yaml is per-node (never synced to peers). Each VRRP instance defined
// in state.keepalived.instances[] can have a per-node priority/state/iface
// override here. Instances that DON'T appear in this map are not rendered
// into this node's keepalived.conf — the node simply doesn't participate.
//
// We render one row per defined instance:
//   - if the instance has an override → show priority/state/interface inputs
//   - if not → show a soft-warning row with "Add this VIP" to seed a default
//
// Interface picker uses the same /api/system/interfaces hook the
// BindAddressPicker uses (distinct interface names, not full IPs).

const VRRP_STATES = Object.freeze(['MASTER', 'BACKUP']);

const defaultOverride = () => ({ priority: 100, state: 'BACKUP', interface: '' });

const collectInterfaceNames = groups => {
  const names = new Set();
  for (const group of groups ?? []) {
    for (const addr of group.addresses ?? []) {
      if (addr.interface) {
        names.add(addr.interface);
      }
    }
  }
  return [...names].sort();
};

const OverrideRow = ({ instance, override, onChange, onRemove, interfaceNames }) => {
  const { t } = useTranslation(['cluster']);
  return (
    <tr>
      <td>
        <code>{instance.id}</code>
        <div className="text-muted small">
          {instance.vip}
          {instance.prefix ? `/${instance.prefix}` : ''} · VRID {instance.virtualRouterId}
        </div>
      </td>
      <td style={{ width: '7rem' }}>
        <Form.Control
          type="number"
          min={1}
          max={254}
          value={override.priority ?? ''}
          onChange={e => {
            const raw = e.target.value;
            const n = raw === '' ? null : Number.parseInt(raw, 10);
            onChange({ ...override, priority: Number.isInteger(n) ? n : null });
          }}
        />
      </td>
      <td style={{ width: '9rem' }}>
        <Form.Select
          value={override.state ?? 'BACKUP'}
          onChange={e => onChange({ ...override, state: e.target.value })}
        >
          {VRRP_STATES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Form.Select>
      </td>
      <td style={{ width: '10rem' }}>
        {interfaceNames.length > 0 ? (
          <Form.Select
            value={override.interface ?? ''}
            onChange={e => onChange({ ...override, interface: e.target.value })}
          >
            <option value="">{t('cluster:node.identity.interfaceUnset', '(unset)')}</option>
            {interfaceNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Form.Select>
        ) : (
          <Form.Control
            type="text"
            value={override.interface ?? ''}
            placeholder="eth0"
            onChange={e => onChange({ ...override, interface: e.target.value })}
          />
        )}
      </td>
      <td className="text-end">
        <Button
          variant="outline-danger"
          size="sm"
          onClick={onRemove}
          title={t(
            'cluster:node.identity.removeVipTitle',
            "This node won't participate in this VIP"
          )}
        >
          ×
        </Button>
      </td>
    </tr>
  );
};

OverrideRow.propTypes = {
  instance: PropTypes.shape({
    id: PropTypes.string.isRequired,
    vip: PropTypes.string,
    prefix: PropTypes.number,
    virtualRouterId: PropTypes.number,
  }).isRequired,
  override: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  interfaceNames: PropTypes.arrayOf(PropTypes.string).isRequired,
};

const MissingRow = ({ instance, onAdd }) => {
  const { t } = useTranslation(['cluster']);
  return (
    <tr>
      <td>
        <code>{instance.id}</code>
        <div className="text-muted small">
          {instance.vip}
          {instance.prefix ? `/${instance.prefix}` : ''} · VRID {instance.virtualRouterId}
        </div>
      </td>
      <td colSpan={3} className="text-muted small">
        <i className="bi bi-info-circle me-1" />
        {t(
          'cluster:node.identity.missingHint',
          "This node won't participate in this VIP until you add a per-node priority/state."
        )}
      </td>
      <td className="text-end">
        <Button variant="outline-primary" size="sm" onClick={onAdd}>
          <i className="bi bi-plus-lg me-1" />
          {t('cluster:node.identity.addVip', 'Add this VIP')}
        </Button>
      </td>
    </tr>
  );
};

MissingRow.propTypes = {
  instance: PropTypes.shape({
    id: PropTypes.string.isRequired,
    vip: PropTypes.string,
    prefix: PropTypes.number,
    virtualRouterId: PropTypes.number,
  }).isRequired,
  onAdd: PropTypes.func.isRequired,
};

export const NodeIdentityCard = ({ instances }) => {
  const { t } = useTranslation(['cluster', 'common']);
  const { groups } = useSystemInterfaces();
  const interfaceNames = collectInterfaceNames(groups);

  const [nodeId, setNodeId] = useState('');
  const [renewalLeader, setRenewalLeader] = useState(true);
  const [sync, setSync] = useState({
    autoPushOnSave: false,
    pullEnabled: false,
    pullFromPeerId: null,
    pullIntervalSeconds: 60,
  });
  const [peers, setPeers] = useState([]);
  const [vrrp, setVrrp] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet('api/node-config'),
      apiGet('api/peers').catch(() => []),
    ])
      .then(([nodePayload, peersPayload]) => {
        if (cancelled) {
          return;
        }
        setNodeId(nodePayload?.nodeId ?? '');
        setRenewalLeader(nodePayload?.renewalLeader !== false);
        setSync({
          autoPushOnSave: nodePayload?.sync?.autoPushOnSave === true,
          pullEnabled: nodePayload?.sync?.pullEnabled === true,
          pullFromPeerId: nodePayload?.sync?.pullFromPeerId ?? null,
          pullIntervalSeconds:
            Number.isInteger(nodePayload?.sync?.pullIntervalSeconds)
              ? nodePayload.sync.pullIntervalSeconds
              : 60,
        });
        setVrrp(nodePayload?.vrrp ?? {});
        setPeers(Array.isArray(peersPayload) ? peersPayload : []);
        setLoadError(null);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) {
          return;
        }
        setLoadError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOverride = (instanceId, next) => {
    setSaved(false);
    setVrrp(prev => ({ ...prev, [instanceId]: next }));
  };

  const removeOverride = instanceId => {
    setSaved(false);
    setVrrp(prev => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  };

  const addDefaultOverride = instanceId => {
    setSaved(false);
    setVrrp(prev => ({ ...prev, [instanceId]: defaultOverride() }));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiPut('api/node-config', { nodeId, renewalLeader, sync, vrrp });
      setSaved(true);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const setSyncField = (key, value) => {
    setSaved(false);
    setSync(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <Card className="mb-3">
        <Card.Body className="d-flex justify-content-center py-3">
          <Spinner animation="border" size="sm" />
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title className="mb-1">
          {t('cluster:node.identity.title', "This node's identity")}
        </Card.Title>
        <Card.Text className="text-muted small">
          {t(
            'cluster:node.identity.description',
            'Edits /etc/patchpanel/node.yaml. These values are local to this node and never sync to peers. Saving triggers a keepalived reload.'
          )}
        </Card.Text>

        {loadError ? (
          <Alert variant="danger" className="py-2 small">
            {t('cluster:node.identity.loadFailed', 'Failed to load node config:')}{' '}
            {loadError.message}
          </Alert>
        ) : null}

        <Form.Group className="mb-3">
          <Form.Label>{t('cluster:node.identity.nodeIdLabel', 'Node ID')}</Form.Label>
          <Form.Control
            type="text"
            value={nodeId}
            onChange={e => {
              setSaved(false);
              setNodeId(e.target.value);
            }}
            placeholder="haproxy-s2-n1"
          />
          <Form.Text className="text-muted">
            {t(
              'cluster:node.identity.nodeIdHint',
              'Human label for this node — surfaces in the peers list on other nodes and in audit entries.'
            )}
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Check
            type="switch"
            id="node-config-renewal-leader"
            checked={renewalLeader}
            onChange={e => {
              setSaved(false);
              setRenewalLeader(e.target.checked);
            }}
            label={t(
              'cluster:node.identity.renewalLeaderLabel',
              'Run certbot renewals on this node (renewal leader)'
            )}
          />
          <Form.Text className="text-muted">
            {t(
              'cluster:node.identity.renewalLeaderHint',
              'Exactly one node in the cluster should be the renewal leader. The leader runs certbot, then pushes the renewed certs to peers via the peer-sync API. Non-leaders skip their cron renewal pass and receive certs from the leader instead.'
            )}
          </Form.Text>
        </Form.Group>

        <div className="mb-2">
          <strong className="small text-muted text-uppercase">
            {t('cluster:node.identity.syncHeading', 'Cluster sync')}
          </strong>
        </div>

        <Form.Group className="mb-3">
          <Form.Check
            type="switch"
            id="node-config-auto-push"
            checked={sync.autoPushOnSave}
            onChange={e => setSyncField('autoPushOnSave', e.target.checked)}
            label={t(
              'cluster:node.identity.autoPushLabel',
              'Auto-push state to peers on save / after renewal'
            )}
          />
          <Form.Text className="text-muted">
            {t(
              'cluster:node.identity.autoPushHint',
              'When off (default), state changes and cert renewals stay local until you click "Sync now" on a peer. Turn this on for the leader so writes propagate automatically.'
            )}
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Check
            type="switch"
            id="node-config-pull-enabled"
            checked={sync.pullEnabled}
            onChange={e => setSyncField('pullEnabled', e.target.checked)}
            label={t(
              'cluster:node.identity.pullEnabledLabel',
              'Pull state from upstream peer on interval'
            )}
          />
          <Form.Text className="text-muted">
            {t(
              'cluster:node.identity.pullEnabledHint',
              'For followers: poll the upstream peer for state + cert changes and apply locally. Leave off on the leader. Pairing must already exist (the upstream must have minted an inbound token for this node).'
            )}
          </Form.Text>
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label className="small">
            {t('cluster:node.identity.pullFromLabel', 'Upstream peer')}
          </Form.Label>
          <Form.Select
            value={sync.pullFromPeerId ?? ''}
            disabled={!sync.pullEnabled}
            onChange={e => setSyncField('pullFromPeerId', e.target.value || null)}
          >
            <option value="">
              {t('cluster:node.identity.pullFromUnset', '— select a paired peer —')}
            </option>
            {peers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.url})
              </option>
            ))}
          </Form.Select>
          {sync.pullEnabled && peers.length === 0 ? (
            <Form.Text className="text-warning">
              {t(
                'cluster:node.identity.pullNoPeers',
                'No paired peers yet. Add one in the "Pair with peer" section first.'
              )}
            </Form.Text>
          ) : null}
        </Form.Group>

        <Form.Group className="mb-3">
          <Form.Label className="small">
            {t('cluster:node.identity.pullIntervalLabel', 'Pull interval (seconds)')}
          </Form.Label>
          <Form.Control
            type="number"
            min={10}
            max={3600}
            value={sync.pullIntervalSeconds}
            disabled={!sync.pullEnabled}
            onChange={e => {
              const n = Number.parseInt(e.target.value, 10);
              setSyncField(
                'pullIntervalSeconds',
                Number.isInteger(n) ? Math.max(10, Math.min(3600, n)) : 60
              );
            }}
            style={{ maxWidth: '10rem' }}
          />
          <Form.Text className="text-muted">
            {t(
              'cluster:node.identity.pullIntervalHint',
              'How often the follower polls the upstream. 10s minimum, 3600s maximum.'
            )}
          </Form.Text>
        </Form.Group>

        <div className="mb-2">
          <strong className="small text-muted text-uppercase">
            {t('cluster:node.identity.overridesHeading', 'Per-VIP overrides')}
          </strong>
        </div>
        {instances.length === 0 ? (
          <Alert variant="light" className="border small mb-0">
            {t(
              'cluster:node.identity.noInstances',
              'No VRRP instances defined yet. Add one in the table above.'
            )}
          </Alert>
        ) : (
          <Table size="sm" className="mb-3">
            <thead>
              <tr>
                <th>{t('cluster:node.identity.col.vipId', 'VIP id')}</th>
                <th>{t('cluster:node.identity.col.priority', 'priority')}</th>
                <th>{t('cluster:node.identity.col.state', 'state')}</th>
                <th>{t('cluster:node.identity.col.interface', 'interface')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {instances.map(instance => {
                const override = vrrp[instance.id];
                if (!override) {
                  return (
                    <MissingRow
                      key={instance.id}
                      instance={instance}
                      onAdd={() => addDefaultOverride(instance.id)}
                    />
                  );
                }
                return (
                  <OverrideRow
                    key={instance.id}
                    instance={instance}
                    override={override}
                    onChange={next => setOverride(instance.id, next)}
                    onRemove={() => removeOverride(instance.id)}
                    interfaceNames={interfaceNames}
                  />
                );
              })}
            </tbody>
          </Table>
        )}

        {saveError ? (
          <Alert variant="danger" className="py-2 small">
            {t('cluster:node.identity.saveFailed', 'Save failed:')} {saveError.message}
          </Alert>
        ) : null}
        {saved ? (
          <Alert variant="success" className="py-2 small">
            {t('cluster:node.identity.savedReloaded', 'Saved. keepalived has been reloaded.')}
          </Alert>
        ) : null}

        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-2" />
              {t('common:status.saving', 'Saving…')}
            </>
          ) : (
            t('cluster:node.identity.saveButton', 'Save node config')
          )}
        </Button>
      </Card.Body>
    </Card>
  );
};

NodeIdentityCard.propTypes = {
  instances: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      vip: PropTypes.string,
      prefix: PropTypes.number,
      virtualRouterId: PropTypes.number,
    })
  ).isRequired,
};
