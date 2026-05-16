import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  InputGroup,
  Modal,
  Spinner,
  Table,
  Tab,
  Tabs,
} from 'react-bootstrap';
import { Link } from 'react-router';

import { apiDelete, apiGet, apiPost } from '../api/client.js';

const TablesSubtab = () => {
  const [tables, setTables] = useState([]);
  const [active, setActive] = useState(null);
  const [entries, setEntries] = useState({ entries: [], header: null });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadTables = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet('api/runtime/tables');
      setTables(payload.tables ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const loadEntries = async name => {
    setActive(name);
    setEntries({ entries: [], header: null });
    try {
      const payload = await apiGet(`api/runtime/tables/${encodeURIComponent(name)}`);
      setEntries({ entries: payload.entries ?? [], header: payload.header });
    } catch (err) {
      setError(err);
    }
  };

  const clearAll = async name => {
    try {
      await apiPost(`api/runtime/tables/${encodeURIComponent(name)}/clear`, {});
      await loadEntries(name);
    } catch (err) {
      setError(err);
    }
  };

  const clearKey = async (name, key) => {
    try {
      await apiPost(`api/runtime/tables/${encodeURIComponent(name)}/clear`, { key });
      await loadEntries(name);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <SubtabHelp
        title="Stick tables"
        body={
          <>
            Per-table key/value counters HAProxy keeps in memory (e.g. <code>http_req_rate</code>{' '}
            tracked by source IP for rate-limiting). Empty if no <code>stick-table</code> directives
            are declared in any frontend/backend. <strong>Inspect</strong> dumps the current
            contents of one table; <strong>Clear all</strong> wipes the table; the per-row
            <strong> Delete</strong> evicts a single key (e.g. unban one client IP). Effective
            instantly — no reload, no session loss.
          </>
        }
      />
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      <div className="d-flex gap-2 mb-2 flex-wrap">
        <Button variant="outline-secondary" size="sm" onClick={loadTables} disabled={loading}>
          {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Refresh'}
        </Button>
        <span className="text-muted small align-self-center">
          {tables.length} stick table{tables.length === 1 ? '' : 's'} live in HAProxy.
        </span>
      </div>
      <Table size="sm" bordered hover responsive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Used</th>
            <th>Size</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tables.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-muted small py-3">
                No stick tables defined.
              </td>
            </tr>
          ) : null}
          {tables.map(t => (
            <tr key={t.table}>
              <td>
                <code>{t.table}</code>
              </td>
              <td>{t.type}</td>
              <td>{t.used}</td>
              <td>{t.size}</td>
              <td className="text-end text-nowrap">
                <Button
                  variant="outline-primary"
                  size="sm"
                  className="me-1"
                  onClick={() => loadEntries(t.table)}
                >
                  Inspect
                </Button>
                <Button variant="outline-danger" size="sm" onClick={() => clearAll(t.table)}>
                  Clear all
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal show={Boolean(active)} onHide={() => setActive(null)} size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            <code>{active}</code>{' '}
            <Badge bg="secondary" className="ms-2">
              {entries.entries.length} entries
            </Badge>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Table size="sm" bordered responsive>
            <thead>
              <tr>
                <th>Key</th>
                <th>Fields</th>
                <th className="text-end" />
              </tr>
            </thead>
            <tbody>
              {entries.entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-muted small py-3">
                    Empty.
                  </td>
                </tr>
              ) : null}
              {entries.entries.map((row, idx) => (
                <tr key={`${row.fields.key ?? idx}`}>
                  <td>
                    <code>{row.fields.key ?? '?'}</code>
                  </td>
                  <td className="small text-muted">
                    {Object.entries(row.fields)
                      .filter(([k]) => k !== 'key')
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ')}
                  </td>
                  <td className="text-end">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => clearKey(active, row.fields.key)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setActive(null)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

const AclMapLabelCell = ({ file, description }) => {
  if (file) {
    return <code className="small">{file}</code>;
  }
  if (description) {
    return <span className="small text-muted">{description}</span>;
  }
  return <span className="small text-muted">(inline)</span>;
};

AclMapLabelCell.propTypes = {
  file: PropTypes.string,
  description: PropTypes.string,
};

const AclMapSubtabImpl = ({ kind }) => {
  const isAcl = kind === 'acls';
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const load = useCallback(async () => {
    try {
      const payload = await apiGet(`api/runtime/${kind}`);
      setItems(payload[kind] ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  const loadEntries = async ref => {
    setActive(ref);
    try {
      const payload = await apiGet(`api/runtime/${kind}/${encodeURIComponent(ref)}/entries`);
      setEntries(payload.entries ?? []);
    } catch (err) {
      setError(err);
    }
  };

  const add = async () => {
    if (!active) {
      return;
    }
    try {
      if (isAcl) {
        await apiPost(`api/runtime/acls/${encodeURIComponent(active)}/entries`, { value: newKey });
      } else {
        await apiPost(`api/runtime/maps/${encodeURIComponent(active)}/entries`, {
          key: newKey,
          value: newValue,
        });
      }
      setNewKey('');
      setNewValue('');
      await loadEntries(active);
    } catch (err) {
      setError(err);
    }
  };

  const remove = async row => {
    if (!active) {
      return;
    }
    try {
      const param = isAcl
        ? `value=${encodeURIComponent(row.value)}`
        : `key=${encodeURIComponent(row.key)}`;
      await apiDelete(`api/runtime/${kind}/${encodeURIComponent(active)}/entries?${param}`);
      await loadEntries(active);
    } catch (err) {
      setError(err);
    }
  };

  const helpBody = isAcl ? (
    <>
      <p className="mb-2">
        Only <strong>file-backed ACLs</strong> (lines like{' '}
        <code>acl trusted_ips src -f /etc/haproxy/trusted.lst</code>) appear here — the inline ACLs
        patchpanel writes for route hostnames are sample-based and don&apos;t show up in{' '}
        <code>show acl</code>.
      </p>
      <p className="mb-1">
        <strong>To use this tab:</strong> add a file-backed ACL directive to your config (Raw State
        tab, or as an advanced directive on a frontend) and create the file on disk. Then this tab
        lets you <strong>Add / Delete</strong> entries at runtime with no reload.
      </p>
      <pre className="small mb-0 bg-body-tertiary p-2 rounded">
        {`# In an advanced directive on the HTTPS frontend:\nacl trusted_ips src -f /etc/haproxy/trusted.lst\nhttp-request deny if !trusted_ips\n\n# /etc/haproxy/trusted.lst contains one IP/CIDR per line:\n10.0.0.0/8\n192.168.1.42`}
      </pre>
    </>
  ) : (
    <>
      <p className="mb-2">
        Maps are key→value lookup tables HAProxy uses for geo routing, header→backend dispatch, etc.
        Only file-backed maps already loaded by HAProxy appear in this runtime list.
      </p>
      <p className="mb-1">
        <strong>To create or edit map entries:</strong> use{' '}
        <Link to="/advanced">Advanced → Maps</Link> &mdash; patchpanel writes{' '}
        <code>/etc/haproxy/maps/&lt;name&gt;.map</code> on every apply, no Raw State editing needed.
        To <em>use</em> a map, reference it from a frontend advanced directive:
      </p>
      <pre className="small mb-0 bg-body-tertiary p-2 rounded">
        {`# On the HTTPS frontend's "Advanced HAProxy directives" list:\nhttp-request set-header X-Country %[src,map_ip(/etc/haproxy/maps/geo.map,unknown)]\n\n# Or for host-based backend selection:\nuse_backend %[req.hdr(host),lower,map(/etc/haproxy/maps/host_to_be.map,be_default)]`}
      </pre>
    </>
  );

  return (
    <div>
      <SubtabHelp title={isAcl ? 'Runtime ACL lists' : 'Runtime maps'} body={helpBody} />
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      <Table size="sm" bordered hover responsive>
        <thead>
          <tr>
            <th>#</th>
            <th>File / source</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="text-center text-muted small py-3">
                None defined.{' '}
                <span className="text-muted">
                  {isAcl
                    ? 'Add a file-backed ACL in your config to see it here.'
                    : 'Add a file-backed map in your config to see it here.'}
                </span>
              </td>
            </tr>
          ) : null}
          {items.map(item => (
            <tr key={item.id}>
              <td>{item.id}</td>
              <td>
                <AclMapLabelCell file={item.file} description={item.description} />
              </td>
              <td className="text-end">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={() => loadEntries(String(item.id))}
                >
                  Inspect
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal show={Boolean(active)} onHide={() => setActive(null)} size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            <code>
              {isAcl ? 'acl' : 'map'} #{active}
            </code>{' '}
            entries
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <InputGroup className="mb-2" size="sm">
            <Form.Control
              placeholder={isAcl ? 'Value (e.g. 10.0.0.1)' : 'Key'}
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
            />
            {isAcl ? null : (
              <Form.Control
                placeholder="Value"
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
              />
            )}
            <Button variant="outline-primary" onClick={add}>
              Add
            </Button>
          </InputGroup>
          <Table size="sm" bordered responsive>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center text-muted small py-3">
                    Empty.
                  </td>
                </tr>
              ) : null}
              {entries.map((row, idx) => (
                <tr key={`${row.id ?? idx}-${row.key ?? row.value}`}>
                  <td>
                    <code>{isAcl ? row.value : row.key}</code>
                  </td>
                  {isAcl ? null : (
                    <td>
                      <code>{row.value}</code>
                    </td>
                  )}
                  <td className="text-end">
                    <Button variant="outline-danger" size="sm" onClick={() => remove(row)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setActive(null)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

AclMapSubtabImpl.propTypes = {
  kind: PropTypes.oneOf(['acls', 'maps']).isRequired,
};

const AclMapSubtab = AclMapSubtabImpl;

const SubtabHelp = ({ title, body }) => (
  <Alert variant="light" className="border small mb-3">
    <div className="fw-bold mb-1">{title}</div>
    {body}
  </Alert>
);

SubtabHelp.propTypes = {
  title: PropTypes.string.isRequired,
  body: PropTypes.node.isRequired,
};

const SessionsSubtab = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet('api/stats/sessions');
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shutdown = async id => {
    try {
      await apiPost(`api/runtime/sessions/${encodeURIComponent(id)}/shutdown`, {});
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <SubtabHelp
        title="Active client sessions"
        body={
          <>
            Each row is a single live connection HAProxy is currently handling — output of{' '}
            <code>show sess all</code>. The <em>source</em> is the client IP/port. The{' '}
            <em>frontend</em> is the HAProxy listener that accepted it; the <em>backend</em> is
            where it&apos;s being proxied to. <strong>Shutdown</strong> forcibly closes the session
            via the runtime socket — useful for kicking stuck connections, killing a misbehaving
            client, or testing reconnection behavior. The list also feeds the Top client IPs /
            Sessions by frontend / Sessions by backend cards on the Stats tab.
          </>
        }
      />
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      <div className="d-flex gap-2 mb-2">
        <Button variant="outline-secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Refresh'}
        </Button>
        <span className="text-muted small align-self-center">
          {data?.totalSessions ?? 0} active session{data?.totalSessions === 1 ? '' : 's'}.
        </span>
      </div>
      <Table size="sm" bordered hover responsive>
        <thead>
          <tr>
            <th>Session id</th>
            <th>Source</th>
            <th>Frontend</th>
            <th>Backend</th>
            <th className="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(data?.sessions ?? []).length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center text-muted small py-3">
                No sessions.
              </td>
            </tr>
          ) : null}
          {(data?.sessions ?? []).slice(0, 200).map(s => (
            <tr key={s.sessionId}>
              <td>
                <code className="small">{s.sessionId}</code>
              </td>
              <td>
                <code className="small">{s.sourceParsed?.ip ?? '?'}</code>
              </td>
              <td>{s.fe ?? '—'}</td>
              <td>{s.be ?? '—'}</td>
              <td className="text-end">
                <Button variant="outline-danger" size="sm" onClick={() => shutdown(s.sessionId)}>
                  Shutdown
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

const RawCommandSubtabImpl = ({ path, label, refreshLabel = 'Refresh' }) => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await apiGet(path);
      setText(payload.raw ?? '');
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      {error ? <Alert variant="danger">{error.message}</Alert> : null}
      <div className="d-flex gap-2 mb-2">
        <Button variant="outline-secondary" size="sm" onClick={load} disabled={loading}>
          {loading ? <Spinner as="span" animation="border" size="sm" /> : refreshLabel}
        </Button>
        <span className="text-muted small align-self-center">{label}</span>
      </div>
      <pre
        className="bg-body-tertiary border rounded p-3 mb-0"
        style={{
          maxHeight: '60vh',
          overflow: 'auto',
          fontSize: '0.78rem',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        {text || '(empty)'}
      </pre>
    </div>
  );
};

RawCommandSubtabImpl.propTypes = {
  path: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  refreshLabel: PropTypes.string,
};

const RawCommandSubtab = RawCommandSubtabImpl;

export const RuntimePage = () => (
  <Card>
    <Card.Body>
      <Card.Title>Runtime</Card.Title>
      <Card.Text className="text-muted small">
        Live HAProxy operations via the runtime stats socket — no config reload, no session loss.
        Every action is recorded in the audit log.
      </Card.Text>
      <Tabs defaultActiveKey="tables" id="runtime-tabs" className="mb-3">
        <Tab eventKey="tables" title="Stick tables">
          <TablesSubtab />
        </Tab>
        <Tab eventKey="sessions" title="Sessions">
          <SessionsSubtab />
        </Tab>
        <Tab eventKey="acls" title="ACLs">
          <AclMapSubtab kind="acls" />
        </Tab>
        <Tab eventKey="maps" title="Maps">
          <AclMapSubtab kind="maps" />
        </Tab>
        <Tab eventKey="errors" title="Recent errors">
          <RawCommandSubtab
            path="api/runtime/errors"
            label="Output of HAProxy `show errors` — recent malformed requests/responses."
          />
        </Tab>
        <Tab eventKey="resolvers" title="Resolvers">
          <RawCommandSubtab
            path="api/runtime/resolvers"
            label="Output of HAProxy `show resolvers` — DNS resolver state."
          />
        </Tab>
      </Tabs>
    </Card.Body>
  </Card>
);
