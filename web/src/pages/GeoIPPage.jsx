import { Alert } from 'react-bootstrap';

import { GeoIPCard } from '../components/GeoIPCard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const GeoIPPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  if (!onSave) {
    return <Alert variant="warning">State save unavailable.</Alert>;
  }
  return <GeoIPCard doc={doc} onSave={onSave} />;
};

GeoIPPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
