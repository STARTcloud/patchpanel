import { Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['haproxy', 'common']);
  if (!doc) {
    return null;
  }
  return (
    <div>
      <Card className="mb-3">
        <Card.Body>
          <Card.Title>
            {t('haproxy:advanced.page.title', 'Advanced — HAProxy infrastructure')}
          </Card.Title>
          <Card.Text className="text-muted mb-0">
            {t(
              'haproxy:advanced.page.description',
              'DNS resolvers, peer-sync stick-table groups, SMTP mailer groups for email-alert, log-ring sinks, and reusable security policy registry (rate-limit / geo-block / bot-defense). Cert-related infrastructure lives on the Certificates tab; error-page sections live on the Error pages tab; additional listeners live on the new Frontends tab.'
            )}
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
