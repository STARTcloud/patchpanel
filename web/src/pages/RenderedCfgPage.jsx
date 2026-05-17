import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ButtonGroup, Card, Spinner } from 'react-bootstrap';

import { apiGet, apiPut } from '../api/client.js';
import { CfgDiffView } from '../components/CfgDiffView.jsx';
import { onSavePropType } from '../prop-shapes.js';

const fetchCfg = async source => {
  const url = new URL(`api/haproxy/cfg?source=${source}`, document.baseURI).toString();
  const response = await fetch(url, {
    headers: { accept: 'text/plain' },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let payload = '';
    try {
      payload = await response.text();
    } catch {
      // ignore
    }
    const message = payload
      ? `${response.status}: ${payload.slice(0, 200)}`
      : `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return response.text();
};

const copyToClipboard = async text => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

const SOURCE_TABS = Object.freeze([
  {
    id: 'disk',
    icon: 'bi-hdd',
    label: 'On-disk',
    title: 'Currently-running config from disk',
  },
  {
    id: 'state',
    icon: 'bi-cpu',
    label: 'From state',
    title: 'Re-render from current state.json (does not apply)',
  },
  {
    id: 'diff',
    icon: 'bi-arrow-left-right',
    label: 'Diff',
    title: 'Unified diff: on-disk vs from state (what would change if you Apply)',
  },
]);

const SUBTITLE_BY_SOURCE = Object.freeze({
  disk: 'The configuration HAProxy is running right now, read from disk.',
  state:
    'A fresh render from the current state.json. Useful to preview what would be applied next time you save.',
  diff: 'Unified diff: lines that would change if you click Apply (on-disk → from state).',
});

const ERROR_SUFFIX = Object.freeze({
  404: ' — haproxy.cfg not found on disk.',
  409: ' — state.json not initialized yet.',
});

const APPLY_TITLE =
  'Re-render haproxy.cfg from current state.json, validate, atomically write to disk, and reload HAProxy via the master socket. Useful when state and on-disk cfg have drifted (e.g. after a manual /data/state.json edit).';

const PRE_STYLE = Object.freeze({
  fontSize: '0.78rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  whiteSpace: 'pre',
});

const variantFor = active => (active ? 'primary' : 'outline-primary');

const SourceButtons = ({ source, onChange, disabled }) => (
  <ButtonGroup size="sm">
    {SOURCE_TABS.map(tab => (
      <Button
        key={tab.id}
        variant={variantFor(source === tab.id)}
        onClick={() => onChange(tab.id)}
        disabled={disabled}
        title={tab.title}
      >
        <i className={`bi ${tab.icon} me-1`} /> {tab.label}
      </Button>
    ))}
  </ButtonGroup>
);

SourceButtons.propTypes = {
  source: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

const RefreshButton = ({ loading, onClick }) => (
  <Button variant="outline-secondary" size="sm" onClick={onClick} disabled={loading}>
    {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Refresh'}
  </Button>
);

RefreshButton.propTypes = {
  loading: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

const CopyButton = ({ copied, disabled, onClick }) => (
  <Button
    variant={copied ? 'success' : 'outline-secondary'}
    size="sm"
    onClick={onClick}
    disabled={disabled}
  >
    <i className={`bi bi-${copied ? 'check2' : 'clipboard'} me-1`} />
    {copied ? 'Copied' : 'Copy'}
  </Button>
);

CopyButton.propTypes = {
  copied: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

const ApplyButton = ({ applying, disabled, onClick }) => (
  <Button variant="primary" size="sm" onClick={onClick} disabled={disabled} title={APPLY_TITLE}>
    {applying ? (
      <>
        <Spinner as="span" animation="border" size="sm" /> Applying…
      </>
    ) : (
      <>
        <i className="bi bi-arrow-up-circle me-1" />
        Apply
      </>
    )}
  </Button>
);

ApplyButton.propTypes = {
  applying: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

const SubtitleText = ({ source, lineCount, byteCount }) => (
  <Card.Text className="text-muted small d-flex align-items-center gap-2 flex-wrap">
    <span>{SUBTITLE_BY_SOURCE[source] ?? ''}</span>
    {source !== 'diff' ? (
      <span>
        {lineCount} lines · {byteCount} bytes
      </span>
    ) : null}
  </Card.Text>
);

SubtitleText.propTypes = {
  source: PropTypes.string.isRequired,
  lineCount: PropTypes.number.isRequired,
  byteCount: PropTypes.number.isRequired,
};

const ErrorBanner = ({ error }) => {
  if (!error) {
    return null;
  }
  return (
    <Alert variant="danger">
      Failed to load cfg: {error.message}
      {ERROR_SUFFIX[error.status] ?? ''}
    </Alert>
  );
};

ErrorBanner.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
    status: PropTypes.number,
  }),
};

const ApplyResultAlert = ({ result, onClose }) => {
  if (!result) {
    return null;
  }
  return (
    <Alert variant={result.kind} onClose={onClose} dismissible className="mb-2">
      {result.message}
    </Alert>
  );
};

ApplyResultAlert.propTypes = {
  result: PropTypes.shape({
    kind: PropTypes.string,
    message: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
};

const PreView = ({ text, loading }) => (
  <pre
    className="bg-body-tertiary border rounded p-3 mb-0 patchpanel-fullheight-scroller"
    style={PRE_STYLE}
  >
    {text || (loading ? '' : '(empty)')}
  </pre>
);

PreView.propTypes = {
  text: PropTypes.string.isRequired,
  loading: PropTypes.bool,
};

const CfgBody = ({ source, text, compareText, loading }) => {
  if (source === 'diff' && compareText !== null) {
    return <CfgDiffView oldText={text} newText={compareText} />;
  }
  return <PreView text={text} loading={loading} />;
};

CfgBody.propTypes = {
  source: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired,
  compareText: PropTypes.string,
  loading: PropTypes.bool,
};

const computeLineCount = text => (text ? text.split('\n').length : 0);

const resolveSaveFn = onSave =>
  typeof onSave === 'function' ? onSave : doc => apiPut('api/state', doc);

export const RenderedCfgPage = ({ onSave = null }) => {
  const [source, setSource] = useState('disk');
  const [text, setText] = useState('');
  const [compareText, setCompareText] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      if (source === 'diff') {
        const [disk, stateRendered] = await Promise.all([fetchCfg('disk'), fetchCfg('state')]);
        setText(disk);
        setCompareText(stateRendered);
      } else {
        const fresh = await fetchCfg(source);
        setText(fresh);
        setCompareText(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        load();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleCopy = async () => {
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // ignore
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setApplyResult(null);
    try {
      const currentState = await apiGet('api/state');
      await resolveSaveFn(onSave)(currentState);
      setApplyResult({
        kind: 'success',
        message: 'State re-applied: haproxy.cfg re-rendered, validated, and reloaded.',
      });
      await load();
    } catch (err) {
      setApplyResult({ kind: 'danger', message: err.message ?? 'apply failed' });
    } finally {
      setApplying(false);
    }
  };

  const lineCount = computeLineCount(text);
  const byteCount = text.length;

  return (
    <Card className="patchpanel-fullheight-page">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <Card.Title className="mb-0">Rendered haproxy.cfg</Card.Title>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <SourceButtons source={source} onChange={setSource} disabled={loading} />
            <RefreshButton loading={loading} onClick={load} />
            <CopyButton copied={copied} disabled={loading || !text} onClick={handleCopy} />
            <ApplyButton applying={applying} disabled={applying || loading} onClick={handleApply} />
          </div>
        </div>
        <ApplyResultAlert result={applyResult} onClose={() => setApplyResult(null)} />
        <SubtitleText source={source} lineCount={lineCount} byteCount={byteCount} />
        <ErrorBanner error={error} />
        <CfgBody source={source} text={text} compareText={compareText} loading={loading} />
      </Card.Body>
    </Card>
  );
};

RenderedCfgPage.propTypes = {
  onSave: onSavePropType,
};
