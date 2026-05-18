import { Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { GeoIPCard } from '../components/GeoIPCard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const GeoIPPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['geoip']);
  if (!doc) {
    return null;
  }
  if (!onSave) {
    return (
      <Alert variant="warning">{t('geoip:page.saveUnavailable', 'State save unavailable.')}</Alert>
    );
  }
  return <GeoIPCard doc={doc} onSave={onSave} />;
};

GeoIPPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
