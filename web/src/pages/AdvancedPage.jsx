import { Card } from 'react-bootstrap';

import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import {
  MAILERS_SECTION,
  MAPS_SECTION,
  PEERS_SECTION,
  RESOLVERS_SECTION,
  RINGS_SECTION,
  SECURITY_PROFILES_SECTION,
} from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

// v0.2.35 IA reorg — Advanced is now JUST the HAProxy-infrastructure
// entities. Cert stores moved to the Certificates tab, http-errors sections
// moved to the Error pages tab, additional frontends moved to the new
// Frontends tab. Each entity now lives next to the surface it modifies.

const SECTIONS = Object.freeze([
  RESOLVERS_SECTION,
  PEERS_SECTION,
  MAILERS_SECTION,
  RINGS_SECTION,
  MAPS_SECTION,
  SECURITY_PROFILES_SECTION,
]);

export const AdvancedPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  return (
    <div>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>Advanced — HAProxy infrastructure</Card.Title>
          <Card.Text className="text-muted mb-0">
            DNS resolvers, peer-sync stick-table groups, SMTP mailer groups for
            <code> email-alert</code>, log-ring sinks, and reusable security policy registry (
            <code>rate-limit</code> / <code>geo-block</code> / <code>bot-defense</code>).
            Cert-related infrastructure lives on the <strong>Certificates</strong> tab; error-page
            sections live on the <strong>Error pages</strong> tab; additional listeners live on the
            new <strong>Frontends</strong> tab.
          </Card.Text>
        </Card.Body>
      </Card>
      {SECTIONS.map(section => (
        <EntitySectionCard key={section.key} doc={doc} onSave={onSave} section={section} />
      ))}
    </div>
  );
};

AdvancedPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
