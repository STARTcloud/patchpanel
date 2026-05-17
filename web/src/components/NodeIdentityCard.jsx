import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Spinner, Table } from 'react-bootstrap';

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

const OverrideRow = ({ instance, override, onChange, onRemove, interfaceNames }) => (
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
          <option value="">(unset)</option>
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
        title="This node won't participate in this VIP"
      >
        ×
      </Button>
    </td>
  </tr>
);

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

const MissingRow = ({ instance, onAdd }) => (
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
      This node won&apos;t participate in this VIP until you add a per-node priority/state.
    </td>
    <td className="text-end">
      <Button variant="outline-primary" size="sm" onClick={onAdd}>
        <i className="bi bi-plus-lg me-1" />
        Add this VIP
      </Button>
    </td>
  </tr>
);

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
  const { groups } = useSystemInterfaces();
  const interfaceNames = collectInterfaceNames(groups);

  const [nodeId, setNodeId] = useState('');
  const [vrrp, setVrrp] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet('api/node-config')
      .then(payload => {
        if (cancelled) {
          return;
        }
        setNodeId(payload?.nodeId ?? '');
        setVrrp(payload?.vrrp ?? {});
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
      await apiPut('api/node-config', { nodeId, vrrp });
      setSaved(true);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
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
        <Card.Title className="mb-1">This node&apos;s identity</Card.Title>
        <Card.Text className="text-muted small">
          Edits <code>/etc/patchpanel/node.yaml</code>. These values are local to this node and
          never sync to peers. Saving triggers a keepalived reload.
        </Card.Text>

        {loadError ? (
          <Alert variant="danger" className="py-2 small">
            Failed to load node config: {loadError.message}
          </Alert>
        ) : null}

        <Form.Group className="mb-3">
          <Form.Label>Node ID</Form.Label>
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
            Human label for this node — surfaces in the peers list on other nodes and in audit
            entries.
          </Form.Text>
        </Form.Group>

        <div className="mb-2">
          <strong className="small text-muted text-uppercase">Per-VIP overrides</strong>
        </div>
        {instances.length === 0 ? (
          <Alert variant="light" className="border small mb-0">
            No VRRP instances defined yet. Add one in the table above.
          </Alert>
        ) : (
          <Table size="sm" className="mb-3">
            <thead>
              <tr>
                <th>VIP id</th>
                <th>priority</th>
                <th>state</th>
                <th>interface</th>
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
            Save failed: {saveError.message}
          </Alert>
        ) : null}
        {saved ? (
          <Alert variant="success" className="py-2 small">
            Saved. keepalived has been reloaded.
          </Alert>
        ) : null}

        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? (
            <>
              <Spinner as="span" animation="border" size="sm" className="me-2" />
              Saving…
            </>
          ) : (
            'Save node config'
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
