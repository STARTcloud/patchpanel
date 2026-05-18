import PropTypes from 'prop-types';
import { Component } from 'react';
import { Alert, Button, Card } from 'react-bootstrap';

import i18n from '../i18n/index.js';
import { log } from '../utils/Logger.js';

// Translate safely. ErrorBoundary catches render errors; i18n may not be
// ready yet when the boundary fires. Wrap every lookup in try/catch and
// fall back to the English literal if anything goes sideways.
const tr = (key, fallback, vars) => {
  try {
    if (i18n?.isInitialized && typeof i18n.t === 'function') {
      return i18n.t(key, { defaultValue: fallback, ...vars });
    }
  } catch {
    // i18n unavailable — fall through.
  }
  if (vars) {
    return Object.entries(vars).reduce(
      (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'gu'), String(v)),
      fallback
    );
  }
  return fallback;
};

// Hand-picked subset of React's official codes.json. Templates use %s for
// positional args, matching React's invariant() convention. Source:
// https://github.com/facebook/react/blob/main/scripts/error-codes/codes.json
const REACT_ERROR_TEMPLATES = {
  31: 'Objects are not valid as a React child (found: %s). If you meant to render a collection of children, use an array instead.',
  130: 'Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s',
  152: '%s(...): Nothing was returned from render. This usually means a return statement is missing. Or, to render nothing, return null.',
  185: 'Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.',
  321: 'Invalid hook call. Hooks can only be called inside the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app',
  418: 'Hydration failed because the server rendered HTML didn’t match the client. As a result this tree will be regenerated on the client.',
  425: 'Text content does not match server-rendered HTML.',
  426: 'There was an error while hydrating. Because the error happened outside of a Suspense boundary, the entire root will switch to client rendering.',
};

const MINIFIED_PATTERN =
  /^Minified React error #(?<code>\d+);\s*visit\s+(?<url>https:\/\/react\.dev\/errors\/\d+[^\s]*)/u;

const parseMinifiedReactError = message => {
  if (typeof message !== 'string') {
    return null;
  }
  const match = message.match(MINIFIED_PATTERN);
  if (!match || !match.groups) {
    return null;
  }
  const code = Number(match.groups.code);
  const { url } = match.groups;
  const args = [];
  try {
    const parsed = new URL(url);
    for (const value of parsed.searchParams.getAll('args[]')) {
      args.push(value);
    }
  } catch {
    return { code, url, args: [] };
  }
  return { code, url, args };
};

const formatTemplate = (template, args) => {
  let i = 0;
  return template.replace(/%s/gu, () => {
    const value = args[i] ?? '';
    i += 1;
    return value;
  });
};

const MinifiedErrorAlert = ({ parsed, originalMessage }) => {
  const template = REACT_ERROR_TEMPLATES[parsed.code];
  const friendly = template ? formatTemplate(template, parsed.args) : null;
  return (
    <Alert variant="danger" className="mb-3">
      <Alert.Heading as="h6" className="mb-2">
        {tr('common:errors.reactError', 'React error #{{code}}', { code: parsed.code })}
      </Alert.Heading>
      {friendly ? (
        <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>
          {friendly}
        </p>
      ) : (
        <p className="mb-2">
          {tr(
            'common:errors.noInlineTemplate',
            'No inline template for this code. Open the official description:'
          )}{' '}
          <Alert.Link href={parsed.url} target="_blank" rel="noopener noreferrer">
            {parsed.url}
          </Alert.Link>
        </p>
      )}
      {friendly ? (
        <div className="small">
          <Alert.Link href={parsed.url} target="_blank" rel="noopener noreferrer">
            {tr('common:errors.openOnReactDev', 'Open full description on react.dev')}
          </Alert.Link>
        </div>
      ) : null}
      <details className="mt-2">
        <summary className="small text-muted">
          {tr('common:errors.originalMessage', 'Original minified message')}
        </summary>
        <pre className="small mt-2 mb-0 p-2 bg-body-tertiary" style={{ whiteSpace: 'pre-wrap' }}>
          {originalMessage}
        </pre>
      </details>
    </Alert>
  );
};

MinifiedErrorAlert.propTypes = {
  parsed: PropTypes.shape({
    code: PropTypes.number.isRequired,
    url: PropTypes.string.isRequired,
    args: PropTypes.arrayOf(PropTypes.string).isRequired,
  }).isRequired,
  originalMessage: PropTypes.string.isRequired,
};

const GenericErrorAlert = ({ error }) => (
  <Alert variant="danger" className="mb-3">
    <strong>{error.name}:</strong> {error.message}
  </Alert>
);

GenericErrorAlert.propTypes = {
  error: PropTypes.shape({
    name: PropTypes.string,
    message: PropTypes.string,
  }).isRequired,
};

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    log.error.error('ErrorBoundary caught', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  render() {
    const { error, info } = this.state;
    const { children, fallback } = this.props;
    if (!error) {
      return children;
    }
    if (fallback) {
      return fallback({ error, info, reset: this.reset });
    }
    const parsed = parseMinifiedReactError(error.message);
    return (
      <Card className="m-3">
        <Card.Body>
          <Card.Title className="text-danger">
            {tr('common:errors.somethingWentWrong', 'Something went wrong')}
          </Card.Title>
          {parsed ? (
            <MinifiedErrorAlert parsed={parsed} originalMessage={error.message} />
          ) : (
            <GenericErrorAlert error={error} />
          )}
          {info?.componentStack ? (
            <details>
              <summary className="text-muted small">
                {tr('common:errors.componentStack', 'Component stack')}
              </summary>
              <pre className="small mt-2 p-2 bg-body-tertiary" style={{ whiteSpace: 'pre-wrap' }}>
                {info.componentStack}
              </pre>
            </details>
          ) : null}
          <div className="d-flex gap-2 mt-3">
            <Button variant="primary" onClick={this.reset}>
              {tr('common:errors.tryAgain', 'Try again')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
            >
              {tr('common:errors.reloadPage', 'Reload page')}
            </Button>
          </div>
        </Card.Body>
      </Card>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  fallback: PropTypes.func,
};
