import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ButtonGroup, Card, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiGet, apiPut } from '../api/client.js';
import { onSavePropType } from '../prop-shapes.js';

import { CfgDiffView } from './CfgDiffView.jsx';

// Generic on-disk / from-state / diff viewer for any rendered config file
// patchpanel knows how to produce (haproxy.cfg, keepalived.conf, ...). The
// daemon-specific bits — endpoint, filename, display name — are passed in
// as props; the rest of the UX (source tabs, refresh, copy, apply, diff)
// is identical across daemons. The Apply button re-applies state.json,
// which re-renders every managed config in one pass — so applying from
// either viewer triggers the full state pipeline, not just one file.

const fetchCfg = async (endpoint, source) => {
  const url = new URL(`${endpoint}?source=${source}`, document.baseURI).toString();
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
    labelKey: 'state:rendered.tab.disk',
    labelFallback: 'On-disk',
    titleKey: 'state:rendered.tabTitle.disk',
    titleFallback: 'Currently-running config from disk',
  },
  {
    id: 'state',
    icon: 'bi-cpu',
    labelKey: 'state:rendered.tab.state',
    labelFallback: 'From state',
    titleKey: 'state:rendered.tabTitle.state',
    titleFallback: 'Re-render from current state.json (does not apply)',
  },
  {
    id: 'diff',
    icon: 'bi-arrow-left-right',
    labelKey: 'state:rendered.tab.diff',
    labelFallback: 'Diff',
    titleKey: 'state:rendered.tabTitle.diff',
    titleFallback: 'Unified diff: on-disk vs from state (what would change if you Apply)',
  },
]);

const subtitleFor = (source, displayName, t) => {
  if (source === 'disk') {
    return t(
      'state:rendered.subtitle.disk',
      'The configuration {{name}} is running right now, read from disk.',
      {
        name: displayName,
      }
    );
  }
  if (source === 'state') {
    return t(
      'state:rendered.subtitle.state',
      'A fresh render from the current state.json. Useful to preview what would be applied next time you save.'
    );
  }
  return t(
    'state:rendered.subtitle.diff',
    'Unified diff: lines that would change if you click Apply (on-disk → from state).'
  );
};

const errorSuffix = (status, configName, t) => {
  if (status === 404) {
    return t('state:rendered.errorSuffix.notFound', ' — {{name}} not found on disk.', {
      name: configName,
    });
  }
  if (status === 409) {
    return t('state:rendered.errorSuffix.notInitialized', ' — state.json not initialized yet.');
  }
  return '';
};

const PRE_STYLE = Object.freeze({
  fontSize: '0.78rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  whiteSpace: 'pre',
});

const variantFor = active => (active ? 'primary' : 'outline-primary');

const SourceButtons = ({ source, onChange, disabled }) => {
  const { t } = useTranslation(['state']);
  return (
    <ButtonGroup size="sm">
      {SOURCE_TABS.map(tab => (
        <Button
          key={tab.id}
          variant={variantFor(source === tab.id)}
          onClick={() => onChange(tab.id)}
          disabled={disabled}
          title={t(tab.titleKey, tab.titleFallback)}
        >
          <i className={`bi ${tab.icon} me-1`} /> {t(tab.labelKey, tab.labelFallback)}
        </Button>
      ))}
    </ButtonGroup>
  );
};

SourceButtons.propTypes = {
  source: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

const RefreshButton = ({ loading, onClick }) => {
  const { t } = useTranslation(['common']);
  return (
    <Button variant="outline-secondary" size="sm" onClick={onClick} disabled={loading}>
      {loading ? (
        <Spinner as="span" animation="border" size="sm" />
      ) : (
        t('common:buttons.refresh', 'Refresh')
      )}
    </Button>
  );
};

RefreshButton.propTypes = {
  loading: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

const CopyButton = ({ copied, disabled, onClick }) => {
  const { t } = useTranslation(['common', 'state']);
  return (
    <Button
      variant={copied ? 'success' : 'outline-secondary'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      <i className={`bi bi-${copied ? 'check2' : 'clipboard'} me-1`} />
      {copied ? t('state:rendered.copied', 'Copied') : t('common:buttons.copy', 'Copy')}
    </Button>
  );
};

CopyButton.propTypes = {
  copied: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

const ApplyButton = ({ applying, disabled, onClick, title }) => {
  const { t } = useTranslation(['state']);
  return (
    <Button variant="primary" size="sm" onClick={onClick} disabled={disabled} title={title}>
      {applying ? (
        <>
          <Spinner as="span" animation="border" size="sm" />{' '}
          <span>{t('state:rendered.applying', 'Applying…')}</span>
        </>
      ) : (
        <>
          <i className="bi bi-arrow-up-circle me-1" />
          {t('state:rendered.apply', 'Apply')}
        </>
      )}
    </Button>
  );
};

ApplyButton.propTypes = {
  applying: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  title: PropTypes.string,
};

const SubtitleText = ({ source, displayName, lineCount, byteCount }) => {
  const { t } = useTranslation(['state']);
  return (
    <Card.Text className="text-muted small d-flex align-items-center gap-2 flex-wrap">
      <span>{subtitleFor(source, displayName, t)}</span>
      {source !== 'diff' ? (
        <span>
          {t('state:rendered.lineCount', '{{lines}} lines · {{bytes}} bytes', {
            lines: lineCount,
            bytes: byteCount,
          })}
        </span>
      ) : null}
    </Card.Text>
  );
};

SubtitleText.propTypes = {
  source: PropTypes.string.isRequired,
  displayName: PropTypes.string.isRequired,
  lineCount: PropTypes.number.isRequired,
  byteCount: PropTypes.number.isRequired,
};

const ErrorBanner = ({ error, configName }) => {
  const { t } = useTranslation(['state']);
  if (!error) {
    return null;
  }
  return (
    <Alert variant="danger">
      {t('state:rendered.loadFailed', 'Failed to load cfg: {{message}}', {
        message: error.message,
      })}
      {errorSuffix(error.status, configName, t)}
    </Alert>
  );
};

ErrorBanner.propTypes = {
  error: PropTypes.shape({
    message: PropTypes.string,
    status: PropTypes.number,
  }),
  configName: PropTypes.string.isRequired,
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

const PreView = ({ text, loading }) => {
  const { t } = useTranslation(['state']);
  return (
    <pre
      className="bg-body-tertiary border rounded p-3 mb-0 patchpanel-fullheight-scroller"
      style={PRE_STYLE}
    >
      {text || (loading ? '' : t('state:rendered.empty', '(empty)'))}
    </pre>
  );
};

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

export const RenderedConfigViewer = ({ endpoint, configName, displayName, onSave = null }) => {
  const { t } = useTranslation(['state']);
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
        const [disk, stateRendered] = await Promise.all([
          fetchCfg(endpoint, 'disk'),
          fetchCfg(endpoint, 'state'),
        ]);
        setText(disk);
        setCompareText(stateRendered);
      } else {
        const fresh = await fetchCfg(endpoint, source);
        setText(fresh);
        setCompareText(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, source]);

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
        message: t(
          'state:rendered.applySuccess',
          'State re-applied: {{name}} re-rendered, validated, and reloaded.',
          { name: configName }
        ),
      });
      await load();
    } catch (err) {
      setApplyResult({
        kind: 'danger',
        message: err.message ?? t('state:rendered.applyFailed', 'apply failed'),
      });
    } finally {
      setApplying(false);
    }
  };

  const lineCount = computeLineCount(text);
  const byteCount = text.length;
  const applyTitle = t(
    'state:rendered.applyTitle',
    'Re-render {{name}} from current state.json, validate, atomically write to disk, and reload {{daemon}}. Useful when state and on-disk cfg have drifted (e.g. after a manual /data/state.json edit).',
    { name: configName, daemon: displayName }
  );

  return (
    <Card className="patchpanel-fullheight-page">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <Card.Title className="mb-0">
            {t('state:rendered.title', 'Rendered {{name}}', { name: configName })}
          </Card.Title>
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <SourceButtons source={source} onChange={setSource} disabled={loading} />
            <RefreshButton loading={loading} onClick={load} />
            <CopyButton copied={copied} disabled={loading || !text} onClick={handleCopy} />
            <ApplyButton
              applying={applying}
              disabled={applying || loading}
              onClick={handleApply}
              title={applyTitle}
            />
          </div>
        </div>
        <ApplyResultAlert result={applyResult} onClose={() => setApplyResult(null)} />
        <SubtitleText
          source={source}
          displayName={displayName}
          lineCount={lineCount}
          byteCount={byteCount}
        />
        <ErrorBanner error={error} configName={configName} />
        <CfgBody source={source} text={text} compareText={compareText} loading={loading} />
      </Card.Body>
    </Card>
  );
};

RenderedConfigViewer.propTypes = {
  endpoint: PropTypes.string.isRequired,
  configName: PropTypes.string.isRequired,
  displayName: PropTypes.string.isRequired,
  onSave: onSavePropType,
};
