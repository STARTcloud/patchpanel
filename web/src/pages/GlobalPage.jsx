import { Alert } from 'react-bootstrap';

import { GlobalSettingsCard } from '../components/GlobalSettingsCard.jsx';
import { SslGlobalsCard } from '../components/SslGlobalsCard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const GlobalPage = ({ doc = null, onSave = null }) => {
  if (!doc) {
    return null;
  }
  if (!onSave) {
    return (
      <Alert variant="warning" className="m-3">
        State save unavailable.
      </Alert>
    );
  }
  return (
    <>
      <GlobalSettingsCard doc={doc} onSave={onSave} />
      <SslGlobalsCard doc={doc} onSave={onSave} />
    </>
  );
};

GlobalPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
