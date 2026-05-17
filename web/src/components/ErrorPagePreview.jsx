import PropTypes from 'prop-types';
import { useMemo } from 'react';
import { Badge } from 'react-bootstrap';

// Renders an HAProxy `.http` errorfile as it would appear to a browser.
// Input is the raw HTTP/1.0 response (status line + headers + blank line +
// body). Output is a sandboxed iframe with the body as srcdoc, plus a small
// metadata strip showing the parsed status / content-type / body size.
//
// The iframe is fully sandboxed (no scripts, no same-origin) — the preview
// is a static visual render of the body, not an executable copy of it.
//
// Tokens like `%[unique-id]`, `%[var(txn.request_id)]`, `%[hdr(host)]` etc.
// are mocked at preview time using the supplied `variables` map so users can
// see how their template will look once HAProxy populates them. This is a
// preview-only substitution — the real HAProxy runtime does its own
// expansion when serving the error page.

const escapeHtml = s =>
  s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');

const escapeAttr = escapeHtml;

const TOKEN_RE = /%\[(?<token>[^\]]+)\]/gu;
const UNSET_PLACEHOLDER = token => `[?${token}]`;

// Look up a token against the variables map with a couple of common
// fall-throughs so users don't have to provide every nested form. e.g.
// `var(txn.request_id)` falls back to `txn.request_id`, then `request_id`.
const lookupToken = (token, vars) => {
  if (Object.hasOwn(vars, token)) {
    return vars[token];
  }
  const parenMatch = token.match(/^(?<fn>[a-zA-Z_]+)\((?<inner>[^)]+)\)$/u);
  if (parenMatch) {
    const { inner } = parenMatch.groups;
    if (Object.hasOwn(vars, inner)) {
      return vars[inner];
    }
    const dotTail = inner.split('.').pop();
    if (dotTail && Object.hasOwn(vars, dotTail)) {
      return vars[dotTail];
    }
  }
  return null;
};

// Manual exec loop rather than String.replace(re, callback) so we can read
// from match.groups by name and avoid an unused positional `match` parameter
// in the replace callback (which the no-underscore convention disallows).
const expandTokens = (text, vars) => {
  let result = '';
  let lastIdx = 0;
  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(text);
  while (match !== null) {
    result += text.slice(lastIdx, match.index);
    const { token } = match.groups;
    const replacement = lookupToken(token.trim(), vars);
    result += replacement ?? UNSET_PLACEHOLDER(token);
    lastIdx = TOKEN_RE.lastIndex;
    match = TOKEN_RE.exec(text);
  }
  result += text.slice(lastIdx);
  return result;
};

const VIEWPORT_WIDTHS = Object.freeze({
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
});

const parseHttpFile = raw => {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { statusLine: '', headers: {}, body: '', contentType: '', hasHeaders: false };
  }
  // RFC line endings can be CRLF; HAProxy ships LF. Normalize.
  const normalized = raw.replace(/\r\n/gu, '\n');
  // Split on first blank line. If there is none, treat the whole input as
  // a body (some users paste raw HTML directly into the override box).
  const blankIdx = normalized.indexOf('\n\n');
  if (blankIdx === -1) {
    return {
      statusLine: '',
      headers: {},
      body: normalized,
      contentType: '',
      hasHeaders: false,
    };
  }
  const head = normalized.slice(0, blankIdx);
  const body = normalized.slice(blankIdx + 2);
  const [statusLine, ...headerLines] = head.split('\n');
  const headers = {};
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  // Looks like an HTTP response only when the first line starts with HTTP/.
  // Otherwise the user is editing a bare body and we still want to render it.
  const hasHeaders = /^HTTP\//u.test(statusLine);
  if (!hasHeaders) {
    return {
      statusLine: '',
      headers: {},
      body: normalized,
      contentType: '',
      hasHeaders: false,
    };
  }
  return {
    statusLine,
    headers,
    body,
    contentType: headers['content-type'] ?? '',
    hasHeaders: true,
  };
};

const themeStyles = theme => {
  if (theme === 'dark') {
    return {
      background: '#1f2326',
      iframeBackground: '#1f2326',
      prePalette: 'color: #e8eaed; background: #2a2f33;',
    };
  }
  return {
    background: 'white',
    iframeBackground: 'white',
    prePalette: 'color: #212529; background: #f8f9fa;',
  };
};

const renderableSrcDoc = (body, contentType, theme) => {
  const normalized = contentType.toLowerCase();
  const { prePalette } = themeStyles(theme);
  if (normalized.includes('text/html') || normalized === '') {
    // For HTML content, inject a tiny color-scheme hint so user-supplied
    // styles can react to prefers-color-scheme inside the iframe. The body
    // markup itself is unmodified.
    const colorScheme = theme === 'dark' ? 'dark' : 'light';
    return `<!doctype html><html data-pp-theme="${escapeAttr(theme)}"><head><meta charset="utf-8"><style>:root{color-scheme:${colorScheme};}</style></head><body>${body}</body></html>`;
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  :root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
  body { margin: 0; padding: 1rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; ${prePalette} }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 0.85rem; }
</style></head><body><pre>${escapeHtml(body)}</pre></body></html>`;
};

export const ErrorPagePreview = ({
  source,
  title = 'preview',
  height = '20rem',
  variables = null,
  viewport = 'desktop',
  theme = 'light',
}) => {
  const expandedSource = useMemo(() => {
    if (!variables || Object.keys(variables).length === 0) {
      return source;
    }
    return expandTokens(source, variables);
  }, [source, variables]);

  const parsed = useMemo(() => parseHttpFile(expandedSource), [expandedSource]);
  const srcDoc = useMemo(
    () => renderableSrcDoc(parsed.body, parsed.contentType, theme),
    [parsed.body, parsed.contentType, theme]
  );

  const isEmpty = expandedSource.length === 0 || parsed.body.trim().length === 0;
  const ctLabel = parsed.contentType || (parsed.hasHeaders ? '(no content-type)' : 'raw body');
  const bytes = new TextEncoder().encode(parsed.body).length;
  const frameWidth = VIEWPORT_WIDTHS[viewport] ?? VIEWPORT_WIDTHS.desktop;
  const { iframeBackground } = themeStyles(theme);

  return (
    <div className="border rounded">
      <div className="d-flex align-items-center gap-2 px-2 py-1 small bg-body-tertiary border-bottom">
        {parsed.hasHeaders ? (
          <code className="text-truncate" title={parsed.statusLine}>
            {parsed.statusLine}
          </code>
        ) : (
          <Badge bg="secondary" className="bg-opacity-25 text-body-secondary border">
            no HTTP headers
          </Badge>
        )}
        <Badge bg="info" className="bg-opacity-25 text-body border">
          {ctLabel}
        </Badge>
        <span className="text-muted ms-auto text-nowrap">{bytes.toLocaleString()} bytes</span>
      </div>
      {isEmpty ? (
        <div className="p-3 small text-muted">(empty)</div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            background: theme === 'dark' ? '#121517' : '#e9ecef',
            padding: viewport === 'desktop' ? 0 : '0.5rem',
          }}
        >
          <iframe
            title={title}
            srcDoc={srcDoc}
            sandbox=""
            style={{
              width: frameWidth,
              maxWidth: '100%',
              height,
              border: viewport === 'desktop' ? 0 : '1px solid var(--bs-border-color)',
              display: 'block',
              background: iframeBackground,
            }}
          />
        </div>
      )}
    </div>
  );
};

ErrorPagePreview.propTypes = {
  source: PropTypes.string.isRequired,
  title: PropTypes.string,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  variables: PropTypes.objectOf(PropTypes.string),
  viewport: PropTypes.oneOf(['desktop', 'tablet', 'mobile']),
  theme: PropTypes.oneOf(['light', 'dark']),
};
