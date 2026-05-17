import { Alert, Card, Form } from 'react-bootstrap';

import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { InboundTokensCard } from '../components/InboundTokensCard.jsx';
import { NodeIdentityCard } from '../components/NodeIdentityCard.jsx';
import { PeerListCard } from '../components/PeerListCard.jsx';
import {
  KEEPALIVED_INSTANCES_SECTION,
  KEEPALIVED_SYNC_GROUPS_SECTION,
  KEEPALIVED_TRACK_SCRIPTS_SECTION,
} from '../lib/keepalived-section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

// /ha — keepalived/VRRP + multi-node peer management.
//
// Layout (top → bottom):
//   1. Overview card with the master enabled toggle
//   2. VRRP instances (shared state — syncs to peers)
//   3. Sync groups   (shared state)
//   4. Track scripts (shared state)
//   5. NodeIdentityCard — this node's per-VIP priority/state/interface
//      overrides. Local to this node; writes go through PUT /api/node-config
//      and trigger a keepalived reload server-side.
//   6. PeerListCard  — paired outbound peers (this node's view of where to
//      push state).
//   7. InboundTokensCard — bearer tokens this node accepts from incoming
//      peer calls. Mint here, paste on the OTHER node's "Add peer" modal.
//
// state.keepalived.enabled is the master switch: when false, the renderer
// emits a near-empty keepalived.conf regardless of instance count. The
// toggle lives in the overview card so it's the first thing operators see.

const flipKeepalivedEnabled = (doc, nextEnabled) => ({
  ...doc,
  keepalived: { ...(doc.keepalived ?? {}), enabled: nextEnabled },
});

export const HaproxyHaPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  const keepalivedEnabled = doc.keepalived?.enabled === true;
  const instances = doc.keepalived?.instances ?? [];

  return (
    <div>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>HA / Failover (keepalived)</Card.Title>
          <Card.Text className="text-muted small">
            VRRP floating-IP failover between patchpanel nodes. Each VRRP instance is a VIP that
            roams to whichever node has the highest priority (and is healthy). Define VIPs +
            sync_groups + track_scripts here — these definitions are SHARED across the cluster.
            Per-node priority/state lives in <code>node.yaml</code> and is edited in the &ldquo;This
            node&rsquo;s identity&rdquo; card below.
          </Card.Text>
          {onSave ? (
            <Form.Check
              type="switch"
              id="keepalived-enabled-toggle"
              label={
                <span>
                  <strong>Keepalived enabled</strong>{' '}
                  <span className="text-muted">
                    — master switch. When off, the renderer emits a near-empty{' '}
                    <code>keepalived.conf</code> regardless of how many instances are configured
                    below.
                  </span>
                </span>
              }
              checked={keepalivedEnabled}
              onChange={e => onSave(flipKeepalivedEnabled(doc, e.target.checked))}
            />
          ) : null}
          {!keepalivedEnabled ? (
            <Alert variant="warning" className="py-2 small mt-3 mb-0">
              <i className="bi bi-exclamation-triangle me-2" />
              Keepalived is disabled. Configure instances below first, then flip this on to render +
              reload.
            </Alert>
          ) : null}
        </Card.Body>
      </Card>

      {onSave ? (
        <>
          <EntitySectionCard doc={doc} onSave={onSave} section={KEEPALIVED_INSTANCES_SECTION} />
          <EntitySectionCard doc={doc} onSave={onSave} section={KEEPALIVED_SYNC_GROUPS_SECTION} />
          <EntitySectionCard doc={doc} onSave={onSave} section={KEEPALIVED_TRACK_SCRIPTS_SECTION} />
        </>
      ) : (
        <Alert variant="warning">State save unavailable.</Alert>
      )}

      <NodeIdentityCard instances={instances} />
      <PeerListCard />
      <InboundTokensCard />
    </div>
  );
};

HaproxyHaPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
