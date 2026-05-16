import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.css';

import { HelmetProvider } from '@dr.pogodin/react-helmet';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';

const detectBasename = () => {
  const baseUrl = new URL(document.baseURI);
  const path = baseUrl.pathname.replace(/\/+$/u, '');
  return path === '' ? '/' : path;
};

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
