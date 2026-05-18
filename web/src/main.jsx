import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.css';

import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
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
root.render(
  <StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <BrowserRouter basename={detectBasename()}>
          <App />
        </BrowserRouter>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>
);
