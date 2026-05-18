import PropTypes from 'prop-types';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiGet, apiPost } from '../api/client.js';

// Lazy-load swagger-ui-react + its CSS. The package weighs ~1.3MB minified
// gzipped — keep it out of the main bundle so the dashboard, certs page,
// etc. don't pay for code they never touch.
const SwaggerUI = lazy(() =>
  import('swagger-ui-react').then(module => {
    import('swagger-ui-react/swagger-ui.css');
    return { default: module.default };
  })
);

const LoadingSpinner = ({ label }) => (
  <div className="d-flex justify-content-center align-items-center py-5">
    <Spinner animation="border" role="status">
      <span className="visually-hidden">{label}</span>
    </Spinner>
  </div>
);

LoadingSpinner.propTypes = {
  label: PropTypes.string.isRequired,
};

// Inline CSS for the custom DOM patchpanel injects into the swagger-ui-react
// auth modal + servers section. Kept inline so this page is self-contained.
const INJECTED_CSS = `
.swagger-ui .modal-api-keys {
  background: var(--bs-body-bg);
  border: 1px solid var(--bs-border-color);
  border-radius: 0.375rem;
  padding: 1rem;
  margin-bottom: 1rem;
}
.swagger-ui .modal-api-keys h4 {
  font-size: 1rem;
  margin: 0 0 0.5rem 0;
  color: var(--bs-body-color);
}
.swagger-ui .modal-api-keys .api-key-item {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--bs-border-color-translucent);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.swagger-ui .modal-api-keys .api-key-item:last-of-type {
  border-bottom: none;
}
.swagger-ui .modal-api-keys .api-key-name {
  font-weight: 600;
  color: var(--bs-body-color);
}
.swagger-ui .modal-api-keys .api-key-info {
  font-size: 0.75rem;
  color: var(--bs-secondary-color);
}
.swagger-ui .modal-api-keys .no-keys-msg {
  font-size: 0.85rem;
  color: var(--bs-secondary-color);
  font-style: italic;
}
.swagger-ui .modal-api-keys .api-key-separator {
  margin: 0.75rem 0;
  border: 0;
  border-top: 1px solid var(--bs-border-color);
}
.swagger-ui .modal-api-keys .temp-key-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.swagger-ui .modal-api-keys .temp-key-label {
  font-size: 0.85rem;
  color: var(--bs-body-color);
}
.swagger-ui .modal-api-keys .temp-key-btn {
  background: var(--bs-success);
  border: 1px solid var(--bs-success-border-subtle);
  color: #fff;
  padding: 0.375rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  cursor: pointer;
  align-self: flex-start;
}
.swagger-ui .modal-api-keys .temp-key-btn:hover { filter: brightness(1.1); }
.swagger-ui .modal-api-keys .temp-key-btn:disabled { opacity: 0.65; cursor: not-allowed; }
.swagger-ui .modal-api-keys .temp-key-btn.success { background: var(--bs-success-bg-subtle); color: var(--bs-success-text); }
.swagger-ui .modal-api-keys .temp-key-btn.error { background: var(--bs-danger); }
.swagger-ui .custom-server-input {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  flex-grow: 1;
}
.swagger-ui .custom-server-input input {
  flex: 1;
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--bs-border-color);
  border-radius: 0.25rem;
  background: var(--bs-body-bg);
  color: var(--bs-body-color);
  font-size: 0.875rem;
}
.swagger-ui .custom-server-input button {
  white-space: nowrap;
}

/* Dark-mode overrides. swagger-ui-react v5 has no built-in dark theme — its
 * stylesheet hard-codes near-black text colors for the title, description,
 * tag headers, endpoint summary lines, and ships unstyled native form
 * controls for the servers dropdown + filter box. When the app is in dark
 * mode (data-bs-theme='dark' on <html>), the rest of the swagger surface
 * already inherits the Bootstrap dark palette through our wrapper, but
 * those specific selectors need explicit color/background swaps. */
[data-bs-theme='dark'] .swagger-ui .info .title,
[data-bs-theme='dark'] .swagger-ui .info .title small,
[data-bs-theme='dark'] .swagger-ui .info .title small pre,
[data-bs-theme='dark'] .swagger-ui .info p,
[data-bs-theme='dark'] .swagger-ui .info li,
[data-bs-theme='dark'] .swagger-ui .info table,
[data-bs-theme='dark'] .swagger-ui .info .description,
[data-bs-theme='dark'] .swagger-ui .info .description div,
[data-bs-theme='dark'] .swagger-ui .info .base-url,
[data-bs-theme='dark'] .swagger-ui .markdown p,
[data-bs-theme='dark'] .swagger-ui .markdown li,
[data-bs-theme='dark'] .swagger-ui .markdown h1,
[data-bs-theme='dark'] .swagger-ui .markdown h2,
[data-bs-theme='dark'] .swagger-ui .markdown h3,
[data-bs-theme='dark'] .swagger-ui .markdown h4,
[data-bs-theme='dark'] .swagger-ui .renderedMarkdown p,
[data-bs-theme='dark'] .swagger-ui .renderedMarkdown li {
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] .swagger-ui .opblock-tag,
[data-bs-theme='dark'] .swagger-ui .opblock-tag a {
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] .swagger-ui .opblock-tag small,
[data-bs-theme='dark'] .swagger-ui .opblock-tag small p {
  color: var(--bs-secondary-color);
}
[data-bs-theme='dark'] .swagger-ui .opblock .opblock-summary-path,
[data-bs-theme='dark'] .swagger-ui .opblock .opblock-summary-path__deprecated,
[data-bs-theme='dark'] .swagger-ui .opblock .opblock-summary-path a,
[data-bs-theme='dark'] .swagger-ui .opblock .opblock-summary-description,
[data-bs-theme='dark'] .swagger-ui .opblock .opblock-summary-operation-id {
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] .swagger-ui select,
[data-bs-theme='dark'] .swagger-ui .servers select,
[data-bs-theme='dark'] .swagger-ui .servers > label select {
  background: var(--bs-body-bg);
  color: var(--bs-body-color);
  border-color: var(--bs-border-color);
}
[data-bs-theme='dark'] .swagger-ui .servers > label {
  color: var(--bs-body-color);
}
[data-bs-theme='dark'] .swagger-ui input.operation-filter-input,
[data-bs-theme='dark'] .swagger-ui .filter .operation-filter-input,
[data-bs-theme='dark'] .swagger-ui .filter-container input {
  background: var(--bs-body-bg);
  color: var(--bs-body-color);
  border-color: var(--bs-border-color);
}
[data-bs-theme='dark'] .swagger-ui input.operation-filter-input::placeholder,
[data-bs-theme='dark'] .swagger-ui .filter .operation-filter-input::placeholder {
  color: var(--bs-secondary-color);
}
`;

// swagger-ui-react renders the bearer field as a standard React-controlled
// input. Native HTMLInputElement value setters + synthetic events are
// required to make React's state pick up programmatic edits.
const fillBearerInput = value => {
  const input = document.querySelector('#auth-bearer-value');
  if (!input) {
    return false;
  }
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  nativeSetter.call(input, value);
  for (const eventType of ['input', 'change', 'keyup', 'keydown', 'blur', 'focus']) {
    input.dispatchEvent(new Event(eventType, { bubbles: true }));
  }
  return true;
};

// Build a temp-token banner DOM node. Returns the root element so the caller
// can insert/remove it. Kept out of React because the swagger-ui modal is
// rendered imperatively by swagger-ui-react and React can't reach inside.
const buildApiKeysSection = ({ tokens, swaggerConfig, onTempMint, onError, t }) => {
  const root = document.createElement('div');
  root.className = 'modal-api-keys';

  const title = document.createElement('h4');
  title.textContent = t('common:apiDocs.tokensTitle', 'patchpanel API tokens');
  root.appendChild(title);

  if (tokens.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-keys-msg';
    empty.textContent = t(
      'common:apiDocs.noTokens',
      'No API tokens minted yet. Use the Generate Temp Token button below for testing, or mint a long-lived token from Profile → API tokens.'
    );
    root.appendChild(empty);
  } else {
    tokens.forEach(token => {
      const item = document.createElement('div');
      item.className = 'api-key-item';
      const name = document.createElement('div');
      name.className = 'api-key-name';
      name.textContent = token.name;
      const info = document.createElement('div');
      info.className = 'api-key-info';
      const created = new Date(token.createdAt).toLocaleDateString();
      const expires = token.expiresAt
        ? t('common:apiDocs.expires', 'expires {{date}}', {
            date: new Date(token.expiresAt).toLocaleDateString(),
          })
        : t('common:apiDocs.noExpiry', 'no expiry');
      const lastUsed = token.lastUsedAt
        ? t('common:apiDocs.lastUsed', 'last used {{date}}', {
            date: new Date(token.lastUsedAt).toLocaleDateString(),
          })
        : t('common:apiDocs.neverUsed', 'never used');
      info.textContent = t(
        'common:apiDocs.tokenInfo',
        '{{keyId}} • created {{created}} • {{expires}} • {{lastUsed}}',
        { keyId: token.keyId, created, expires, lastUsed }
      );
      item.appendChild(name);
      item.appendChild(info);
      root.appendChild(item);
    });

    const hint = document.createElement('div');
    hint.className = 'no-keys-msg';
    hint.style.marginTop = '0.5rem';
    hint.textContent = t(
      'common:apiDocs.hint',
      'patchpanel stores token secrets bcrypt-hashed — existing token plaintexts cannot be retrieved. Use Generate Temp Token below to test.'
    );
    root.appendChild(hint);
  }

  if (!swaggerConfig?.allowTempKeyGeneration) {
    return root;
  }

  const sep = document.createElement('hr');
  sep.className = 'api-key-separator';
  root.appendChild(sep);

  const tempSection = document.createElement('div');
  tempSection.className = 'temp-key-section';
  const tempLabel = document.createElement('div');
  tempLabel.className = 'temp-key-label';
  const hours = swaggerConfig.tempKeyExpirationHours ?? 1;
  tempLabel.textContent = t(
    'common:apiDocs.tempLabel',
    'Generate a temporary token (expires after {{hours}}h) and fill the Bearer field automatically.',
    { hours }
  );
  tempSection.appendChild(tempLabel);

  const tempBtn = document.createElement('button');
  tempBtn.type = 'button';
  tempBtn.className = 'temp-key-btn';
  const tempBtnLabel = t('common:apiDocs.tempBtn', 'Generate Temp Token');
  tempBtn.textContent = tempBtnLabel;
  tempSection.appendChild(tempBtn);

  tempBtn.addEventListener('click', async () => {
    tempBtn.disabled = true;
    tempBtn.textContent = t('common:apiDocs.generating', 'Generating…');
    try {
      const result = await onTempMint();
      const filled = fillBearerInput(result.wire);
      if (filled) {
        tempBtn.textContent = t('common:apiDocs.filled', 'Filled with Temp Token!');
        tempBtn.classList.add('success');
        setTimeout(() => {
          tempBtn.textContent = tempBtnLabel;
          tempBtn.classList.remove('success');
          tempBtn.disabled = false;
        }, 3000);
      } else {
        throw new Error(
          t(
            'common:apiDocs.bearerNotFound',
            'Could not find the bearer auth input — open the Authorize modal again and retry.'
          )
        );
      }
    } catch (err) {
      onError(err);
      tempBtn.textContent = t('common:apiDocs.errorBtn', 'Error');
      tempBtn.classList.add('error');
      setTimeout(() => {
        tempBtn.textContent = tempBtnLabel;
        tempBtn.classList.remove('error');
        tempBtn.disabled = false;
      }, 2500);
    }
  });

  root.appendChild(tempSection);
  return root;
};

const ARROW_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';
const CHECK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"></path></svg>';

// Adds a Custom Server input + Set button next to swagger-ui's server picker.
// Lets users probe an arbitrary patchpanel deployment from the docs site
// without editing the spec. Mirrors armor's reclassing of `.scheme-container`
// → `.wrapper.swagger-servers-section` + `.schemes` → `.block.schemes-flex-container`
// so the JTD-wider color scheme styles apply the same way on GH Pages.
const installCustomServerInput = t => {
  const schemeContainer =
    document.querySelector('.swagger-ui .scheme-container') ||
    document.querySelector('.swagger-ui .swagger-servers-section');
  if (!schemeContainer) {
    return;
  }
  if (schemeContainer.querySelector('.custom-server-input')) {
    return;
  }
  schemeContainer.classList.remove('scheme-container');
  schemeContainer.classList.add('wrapper', 'swagger-servers-section');

  const schemesSection = schemeContainer.querySelector('.schemes');
  const serverSelect = schemeContainer.querySelector('#servers');
  const authWrapper = schemeContainer.querySelector('.auth-wrapper');
  if (!schemesSection || !serverSelect) {
    return;
  }
  schemesSection.classList.remove('col-12', 'wrapper');
  schemesSection.classList.add('block', 'schemes-flex-container');

  const wrap = document.createElement('div');
  wrap.className = 'custom-server-input';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = t(
    'common:apiDocs.customServerPlaceholder',
    'Custom server URL — e.g. https://patchpanel.example.com:8099'
  );

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn authorize unlocked';
  btn.innerHTML = ARROW_ICON_SVG;

  const setCustom = () => {
    const url = input.value.trim();
    if (!url) {
      return;
    }
    const opt = document.createElement('option');
    opt.value = url;
    opt.textContent = t('common:apiDocs.customLabel', '{{url}} - Custom', { url });
    serverSelect.appendChild(opt);
    serverSelect.value = url;
    serverSelect.dispatchEvent(new Event('change', { bubbles: true }));
    btn.innerHTML = CHECK_ICON_SVG;
    btn.className = 'btn authorize unlocked success';
    setTimeout(() => {
      btn.innerHTML = ARROW_ICON_SVG;
      btn.className = 'btn authorize unlocked';
    }, 1500);
  };

  btn.addEventListener('click', setCustom);
  input.addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setCustom();
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(btn);
  if (authWrapper) {
    schemesSection.insertBefore(wrap, authWrapper);
  } else {
    schemesSection.appendChild(wrap);
  }
};

export const ApiDocsPage = () => {
  const { t } = useTranslation(['common']);
  const [spec, setSpec] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [swaggerConfig, setSwaggerConfig] = useState(null);
  const [error, setError] = useState(null);
  const [injectionError, setInjectionError] = useState(null);
  const tokensRef = useRef(tokens);
  const swaggerConfigRef = useRef(swaggerConfig);

  // Refs let the imperative DOM observer below see the latest values without
  // closing over stale state when the spec finishes loading before the
  // tokens fetch completes. Sync the refs in an effect (not at render time)
  // so the react-hooks/refs rule is satisfied — the observer fires after
  // user interaction (modal open), so the one-tick lag vs. render is fine.
  useEffect(() => {
    tokensRef.current = tokens;
    swaggerConfigRef.current = swaggerConfig;
  }, [tokens, swaggerConfig]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([apiGet('api/openapi.json'), apiGet('api/api-tokens/swagger-config')])
      .then(([specResult, configResult]) => {
        if (cancelled) {
          return;
        }
        if (specResult.status === 'rejected') {
          setError(specResult.reason);
          return;
        }
        const fetched = specResult.value;
        const origin = `${window.location.protocol}//${window.location.host}`;
        const next = {
          ...fetched,
          servers: [
            { url: origin, description: t('common:apiDocs.currentServer', 'Current server') },
            ...(fetched.servers ?? []),
          ],
        };
        setSpec(next);
        if (configResult.status === 'fulfilled') {
          setTokens(configResult.value.tokens ?? []);
          setSwaggerConfig(configResult.value.swaggerConfig ?? null);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  // DOM-mutation effects run after SwaggerUI has rendered. swagger-ui-react
  // is uncontrolled below this point — we attach observers to inject the
  // patchpanel-specific UX (custom server input + temp-token UI in the
  // Authorize modal).
  useEffect(() => {
    if (!spec) {
      return undefined;
    }
    let disposed = false;

    const handleTempMint = () => apiPost('api/api-tokens/temp');
    const handleInjectError = err => setInjectionError(err);

    const processModal = modal => {
      if (modal.dataset.patchpanelProcessed === '1') {
        return;
      }
      modal.dataset.patchpanelProcessed = '1';

      // Click-outside-to-close: clicking the backdrop should close the modal.
      const backdrop = modal.querySelector('.backdrop-ux');
      const closeBtn = modal.querySelector('.close-modal');
      if (backdrop && closeBtn) {
        backdrop.addEventListener('click', () => closeBtn.click());
      }

      // Inject the api-keys section at the top of the modal content. Run
      // after a tick so swagger-ui finishes wiring the modal internals.
      // Refetches tokens + config each time the modal opens (matches armor's
      // pattern) so tokens minted after page-mount are visible too.
      setTimeout(async () => {
        const content = modal.querySelector('.modal-ux-content');
        if (!content || content.querySelector('.modal-api-keys')) {
          return;
        }
        let tokensSnapshot = tokensRef.current;
        let swaggerConfigSnapshot = swaggerConfigRef.current;
        try {
          const fresh = await apiGet('api/api-tokens/swagger-config');
          tokensSnapshot = fresh.tokens ?? tokensSnapshot;
          swaggerConfigSnapshot = fresh.swaggerConfig ?? swaggerConfigSnapshot;
        } catch (err) {
          handleInjectError(err);
        }
        const section = buildApiKeysSection({
          tokens: tokensSnapshot,
          swaggerConfig: swaggerConfigSnapshot,
          onTempMint: handleTempMint,
          onError: handleInjectError,
          t,
        });
        content.insertBefore(section, content.firstChild);
      }, 100);
    };

    // Wire the custom server URL input — runs once after swagger-ui-react
    // has populated the scheme-container. Re-run periodically for the first
    // few seconds in case the render is delayed.
    let attempts = 0;
    const installInterval = setInterval(() => {
      if (disposed || attempts > 20) {
        clearInterval(installInterval);
        return;
      }
      installCustomServerInput(t);
      attempts += 1;
    }, 250);

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          if (node.classList?.contains('dialog-ux')) {
            const modal = node.querySelector('.modal-ux');
            if (modal) {
              processModal(modal);
            }
          } else if (node.classList?.contains('modal-ux')) {
            processModal(node);
          } else {
            const nested = node.querySelector?.('.modal-ux');
            if (nested) {
              processModal(nested);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      disposed = true;
      clearInterval(installInterval);
      observer.disconnect();
    };
  }, [spec, t]);

  if (error) {
    return (
      <Alert variant="danger">
        <Alert.Heading>
          {t('common:apiDocs.loadFailed', 'Failed to load API documentation')}
        </Alert.Heading>
        <p className="mb-0">{error.message}</p>
      </Alert>
    );
  }

  if (!spec) {
    return <LoadingSpinner label={t('common:apiDocs.loading', 'Loading API documentation…')} />;
  }

  return (
    <div className="swagger-container">
      <style>{INJECTED_CSS}</style>
      {injectionError ? (
        <Alert
          variant="warning"
          dismissible
          onClose={() => setInjectionError(null)}
          className="small mb-2"
        >
          {t('common:apiDocs.helperFailed', 'Swagger UI helper failed: {{message}}', {
            message: injectionError.message,
          })}
        </Alert>
      ) : null}
      <Suspense
        fallback={<LoadingSpinner label={t('common:apiDocs.loadingUi', 'Loading Swagger UI…')} />}
      >
        <SwaggerUI
          spec={spec}
          deepLinking
          docExpansion="list"
          displayOperationId={false}
          defaultModelsExpandDepth={1}
          defaultModelExpandDepth={1}
          defaultModelRendering="example"
          displayRequestDuration
          filter
          showExtensions
          showCommonExtensions
          tryItOutEnabled
          validatorUrl={null}
          requestInterceptor={request => {
            // Rewrite host-relative URLs to absolute so "Try it out" works
            // regardless of ingress / reverse-proxy path prefixes.
            if (request.url.startsWith('/')) {
              request.url = `${window.location.protocol}//${window.location.host}${request.url}`;
            }
            return request;
          }}
          responseInterceptor={response => response}
        />
      </Suspense>
    </div>
  );
};
