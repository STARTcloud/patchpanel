import { RenderedConfigViewer } from '../components/RenderedConfigViewer.jsx';
import { onSavePropType } from '../prop-shapes.js';

export const RenderedKeepalivedPage = ({ onSave = null }) => (
  <RenderedConfigViewer
    endpoint="api/keepalived/cfg"
    configName="keepalived.conf"
    displayName="Keepalived"
    onSave={onSave}
  />
);

RenderedKeepalivedPage.propTypes = {
  onSave: onSavePropType,
};
