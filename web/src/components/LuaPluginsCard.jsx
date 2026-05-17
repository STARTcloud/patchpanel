import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Table } from 'react-bootstrap';

import { onSavePropType, stateDocShape } from '../prop-shapes.js';
import { genKey } from '../utils/keys.js';

import { LuaPluginUploadModal } from './LuaPluginUploadModal.jsx';

const newPlugin = () => ({ name: '', path: '', prependPath: '' });

const cleanForSave = plugins =>
  plugins
    .map(plugin => {
      const cleaned = { name: plugin.name, path: plugin.path };
      if (plugin.prependPath) {
        cleaned.prependPath = plugin.prependPath;
      }
      return cleaned;
    })
    .filter(plugin => plugin.name && plugin.path);

const PluginRow = ({ plugin, onChange, onRemove }) => (
  <tr>
    <td>
      <Form.Control
        size="sm"
        value={plugin.name}
        placeholder="haproxy-auth-request"
        onChange={e => onChange({ ...plugin, name: e.target.value })}
      />
    </td>
    <td>
      <Form.Control
        size="sm"
        value={plugin.path}
        placeholder="/etc/haproxy/haproxy-lua-http/auth-request.lua"
        onChange={e => onChange({ ...plugin, path: e.target.value })}
      />
    </td>
    <td>
      <Form.Control
        size="sm"
        value={plugin.prependPath ?? ''}
        placeholder="/etc/haproxy"
        onChange={e => onChange({ ...plugin, prependPath: e.target.value })}
      />
    </td>
    <td className="text-end">
      <Button variant="outline-danger" size="sm" onClick={onRemove}>
        ×
      </Button>
    </td>
  </tr>
);

PluginRow.propTypes = {
  plugin: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
};

export const LuaPluginsCard = ({ doc, onSave }) => {
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  const initial = useMemo(() => {
    const plugins = doc.globalSettings.luaPlugins ?? [];
    return { keys: plugins.map(() => genKey()), plugins };
  }, [doc.globalSettings.luaPlugins]);
  const current = draft ?? initial;

  const updateAt = (idx, next) => {
    setStatus(null);
    setDraft({
      keys: current.keys,
      plugins: current.plugins.map((p, i) => (i === idx ? next : p)),
    });
  };

  const removeAt = idx => {
    setStatus(null);
    setDraft({
      keys: [...current.keys.slice(0, idx), ...current.keys.slice(idx + 1)],
      plugins: [...current.plugins.slice(0, idx), ...current.plugins.slice(idx + 1)],
    });
  };

  const addRow = () => {
    setStatus(null);
    setDraft({
      keys: [...current.keys, genKey()],
      plugins: [...current.plugins, newPlugin()],
    });
  };

  const handleUploaded = ({ name, path }) => {
    setStatus({ kind: 'success', message: `Uploaded ${name}. Click Save to apply.` });
    setShowUpload(false);
    setDraft({
      keys: [...current.keys, genKey()],
      plugins: [...current.plugins, { name, path, prependPath: '' }],
    });
  };

  const submit = event => {
    event.preventDefault();
    setStatus(null);
    onSave({
      ...doc,
      globalSettings: { ...doc.globalSettings, luaPlugins: cleanForSave(current.plugins) },
    })
      .then(() => {
        setStatus({ kind: 'success', message: 'Saved.' });
        setDraft(null);
      })
      .catch(err => setStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>Lua plugins</Card.Title>
        <Card.Text className="text-muted small">
          Global <code>lua-load</code> + optional <code>lua-prepend-path</code> entries. Each plugin
          renders as <code>lua-prepend-path PREPEND/?/http.lua</code> (when set) followed by{' '}
          <code>lua-load PATH</code>. Plugins registered via this list expose their{' '}
          <code>core.register_action</code> functions as <code>lua.&lt;name&gt;</code> usable from a
          Rule&apos;s <code>lua</code> action.
        </Card.Text>
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}
        <Form onSubmit={submit}>
          {current.plugins.length === 0 ? (
            <p className="text-muted small mb-2">No Lua plugins configured.</p>
          ) : (
            <Table size="sm" bordered responsive className="mb-2">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Path</th>
                  <th>Prepend path (optional)</th>
                  <th className="text-end" />
                </tr>
              </thead>
              <tbody>
                {current.plugins.map((plugin, idx) => (
                  <PluginRow
                    key={current.keys[idx]}
                    plugin={plugin}
                    onChange={next => updateAt(idx, next)}
                    onRemove={() => removeAt(idx)}
                  />
                ))}
              </tbody>
            </Table>
          )}
          <div className="d-flex gap-2 flex-wrap">
            <Button variant="outline-primary" size="sm" type="button" onClick={addRow}>
              <i className="bi bi-plus-lg me-1" />
              Add Lua plugin
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              type="button"
              onClick={() => setShowUpload(true)}
            >
              <i className="bi bi-cloud-upload me-1" />
              Upload .lua file
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!draft}>
              Save Lua plugins
            </Button>
          </div>
        </Form>
      </Card.Body>
      <LuaPluginUploadModal
        show={showUpload}
        onUploaded={handleUploaded}
        onCancel={() => setShowUpload(false)}
      />
    </Card>
  );
};

LuaPluginsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
