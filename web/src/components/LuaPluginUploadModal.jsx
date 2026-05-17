import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';

import { apiGet, apiPost } from '../api/client.js';

// Upload a Lua plugin source file. The operator configures the list of
// allowed upload-target directories in config.yaml (`paths.luaPluginsDirs`);
// the user picks one from the dropdown, names the plugin, pastes / picks
// the .lua source, and on success the modal returns the resulting
// absolute path so the LuaPluginsCard can fill a new row with it.

const NAME_REGEX = /^[a-z][a-z0-9_-]{0,62}$/u;
const MAX_SOURCE_BYTES = 524_288;

const readFileAsText = file =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

export const LuaPluginUploadModal = ({ show, onUploaded, onCancel }) => {
  const [dirs, setDirs] = useState([]);
  const [dir, setDir] = useState('');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [fileInputBump, setFileInputBump] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dirsError, setDirsError] = useState(null);

  useEffect(() => {
    if (!show) {
      return;
    }
    apiGet('api/lua-plugins/dirs')
      .then(payload => {
        const list = payload?.dirs ?? [];
        setDirs(list);
        setDir(prev => (prev && list.includes(prev) ? prev : (list[0] ?? '')));
        setDirsError(null);
        setError(null);
      })
      .catch(err => setDirsError(err.message ?? 'failed to load upload-target list'));
  }, [show]);

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await readFileAsText(file);
      if (typeof text === 'string') {
        setSource(text);
        if (!name && file.name) {
          const stem = file.name.replace(/\.lua$/iu, '').toLowerCase();
          const derived = stem.replace(/[^a-z0-9_-]/gu, '-').replace(/^-+|-+$/gu, '');
          if (NAME_REGEX.test(derived)) {
            setName(derived);
          }
        }
      }
    } catch {
      setError('Could not read selected file. Paste source manually.');
    }
  };

  const nameValid = NAME_REGEX.test(name);
  const sourcePresent = source.trim().length > 0;
  const sourceWithinLimit = source.length <= MAX_SOURCE_BYTES;
  const dirSelected = Boolean(dir);
  const canSubmit =
    dirSelected && nameValid && sourcePresent && sourceWithinLimit && !uploading && !dirsError;

  const handleUpload = async () => {
    setError(null);
    setUploading(true);
    try {
      const result = await apiPost('api/lua-plugins/upload', { dir, name, source });
      if (!result?.ok) {
        setError(result?.error ?? 'upload failed');
        return;
      }
      onUploaded({ name, dir, path: result.path, sizeBytes: result.sizeBytes });
      setName('');
      setSource('');
      setFileInputBump(n => n + 1);
    } catch (err) {
      setError(err.message ?? 'upload request failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal show={show} onHide={onCancel} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-cloud-upload me-2" />
          Upload Lua plugin
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="info" className="small mb-3">
          Pick an upload-target directory, name the plugin, pick a <code>.lua</code> file or paste
          source. The plugin lands at <code>&lt;dir&gt;/&lt;name&gt;.lua</code>; a new row is added
          to the Lua plugins table with that path pre-filled so you only need to hit{' '}
          <strong>Save Lua plugins</strong> to wire it in.
        </Alert>
        {dirsError ? (
          <Alert variant="danger" className="small">
            Could not load upload-target list: {dirsError}
          </Alert>
        ) : null}
        <Form.Group className="mb-3">
          <Form.Label>Upload-target directory</Form.Label>
          <Form.Select
            value={dir}
            onChange={e => setDir(e.target.value)}
            disabled={dirs.length === 0 || uploading}
          >
            {dirs.length === 0 ? <option value="">(no dirs configured)</option> : null}
            {dirs.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Form.Select>
          <Form.Text className="text-muted">
            Configured via <code>paths.luaPluginsDirs</code> in <code>config.yaml</code>.
          </Form.Text>
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label>Plugin name</Form.Label>
          <Form.Control
            type="text"
            value={name}
            onChange={e => setName(e.target.value.toLowerCase())}
            placeholder="auth-request"
            isInvalid={name.length > 0 ? !nameValid : null}
            disabled={uploading}
          />
          <Form.Text className="text-muted">
            Lowercase letters, digits, <code>_</code>, <code>-</code>. 1–63 chars, must start with a
            letter. Used as the filename (<code>&lt;name&gt;.lua</code>).
          </Form.Text>
        </Form.Group>
        <Form.Group className="mb-2">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <Form.Label className="mb-0">Lua source</Form.Label>
            <Form.Control
              key={`file-${fileInputBump}`}
              type="file"
              size="sm"
              accept=".lua,text/x-lua"
              onChange={handleFile}
              style={{ maxWidth: '14rem' }}
              disabled={uploading}
            />
          </div>
          <Form.Control
            as="textarea"
            rows={12}
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="-- paste Lua source here, or pick a .lua file above"
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
            disabled={uploading}
          />
          <div className="d-flex justify-content-between mt-1 small text-muted">
            <span>
              {source.length.toLocaleString()} / {MAX_SOURCE_BYTES.toLocaleString()} bytes
            </span>
            {!sourceWithinLimit ? (
              <span className="text-danger">source exceeds the size limit</span>
            ) : null}
          </div>
        </Form.Group>
        {error ? (
          <Alert variant="danger" className="small mb-0 mt-2">
            {error}
          </Alert>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleUpload} disabled={!canSubmit}>
          {uploading ? (
            <>
              <Spinner as="span" animation="border" size="sm" /> Uploading…
            </>
          ) : (
            'Upload'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

LuaPluginUploadModal.propTypes = {
  show: PropTypes.bool.isRequired,
  onUploaded: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};
