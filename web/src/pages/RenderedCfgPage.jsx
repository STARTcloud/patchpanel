import { RenderedConfigViewer } from '../components/RenderedConfigViewer.jsx';
import { onSavePropType } from '../prop-shapes.js';

export const RenderedCfgPage = ({ onSave = null }) => (
  <RenderedConfigViewer
    endpoint="api/haproxy/cfg"
    configName="haproxy.cfg"
    displayName="HAProxy"
    onSave={onSave}
  />
);

RenderedCfgPage.propTypes = {
  onSave: onSavePropType,
};
