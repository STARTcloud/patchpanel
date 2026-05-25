import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.css';

import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router';

import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import i18n, { i18nPromise } from './i18n/index.js';
import { log } from './utils/Logger.js';

const detectBasename = () => {
  const baseUrl = new URL(document.baseURI);
  const path = baseUrl.pathname.replace(/\/+$/u, '');
  return path === '' ? '/' : path;
};

// Global error capture — wired before React mounts so we catch errors that
// fire during initial render too. ErrorBoundary handles render-time React
// errors; these listeners catch async exceptions / unhandled promise
// rejections / non-React script errors that would otherwise go to the
// browser console only.
window.addEventListener('error', event => {
  log.error.error('Uncaught error', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack,
  });
});
window.addEventListener('unhandledrejection', event => {
  const { reason } = event;
  log.error.error('Unhandled promise rejection', {
    message: reason?.message ?? String(reason),
    stack: reason?.stack,
  });
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('mount point #root missing from index.html');
}

const root = createRoot(container);

// Wait for i18n to initialize before rendering so the first paint already
// has translation data wired up. Without this, components rendered during
// the init window subscribe to a null i18n via useSyncExternalStore and
// stay stuck on fallback strings forever.
i18nPromise.then(() => {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <HelmetProvider>
          <I18nextProvider i18n={i18n}>
            <BrowserRouter basename={detectBasename()}>
              <Suspense fallback={null}>
                <App />
              </Suspense>
            </BrowserRouter>
          </I18nextProvider>
        </HelmetProvider>
      </ErrorBoundary>
    </StrictMode>
  );
});
