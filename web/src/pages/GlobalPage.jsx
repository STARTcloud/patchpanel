import { Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { AdvancedDirectivesCard } from '../components/AdvancedDirectivesCard.jsx';
import { GlobalSettingsCard } from '../components/GlobalSettingsCard.jsx';
import { LuaPluginsCard } from '../components/LuaPluginsCard.jsx';
import { QuicTunablesCard } from '../components/QuicTunablesCard.jsx';
import { SslGlobalsCard } from '../components/SslGlobalsCard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const GlobalPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  if (!doc) {
    return null;
  }
  if (!onSave) {
    return (
      <Alert variant="warning" className="m-3">
        {t('haproxy:global.stateSaveUnavailable', 'State save unavailable.')}
      </Alert>
    );
  }
  return (
    <>
      <GlobalSettingsCard doc={doc} onSave={onSave} />
      <SslGlobalsCard doc={doc} onSave={onSave} />
      <LuaPluginsCard doc={doc} onSave={onSave} />
      <QuicTunablesCard doc={doc} onSave={onSave} />
      <AdvancedDirectivesCard doc={doc} onSave={onSave} />
    </>
  );
};

GlobalPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
