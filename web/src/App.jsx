import { Helmet } from '@dr.pogodin/react-helmet';
import { useCallback, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { Route, Routes } from 'react-router';

import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Layout } from './components/Layout.jsx';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import { HaproxyLiveProvider } from './hooks/useHaproxyLive.jsx';
import { KeepalivedLiveProvider } from './hooks/useKeepalivedLive.jsx';
import { PendingChangesProvider, usePendingChanges } from './hooks/usePendingChanges.jsx';
import { useStateDoc } from './hooks/useState.jsx';
import { useTheme } from './hooks/useTheme.jsx';
import { AclsPage } from './pages/AclsPage.jsx';
import { AdvancedPage } from './pages/AdvancedPage.jsx';
import { ApiDocsPage } from './pages/ApiDocsPage.jsx';
import { AuditPage } from './pages/AuditPage.jsx';
import { BackendsPage } from './pages/BackendsPage.jsx';
import { CertificatesPage } from './pages/CertificatesPage.jsx';
import { ConfigPage } from './pages/ConfigPage.jsx';
import { DashboardPage } from './pages/DashboardPage.jsx';
import { DefaultsPage } from './pages/DefaultsPage.jsx';
import { ErrorPagesPage } from './pages/ErrorPagesPage.jsx';
import { FrontendsPage } from './pages/FrontendsPage.jsx';
import { GeoIPPage } from './pages/GeoIPPage.jsx';
import { GlobalPage } from './pages/GlobalPage.jsx';
import { HaproxyHaPage } from './pages/HaproxyHaPage.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { LogsPage } from './pages/LogsPage.jsx';
import { NotificationsPage } from './pages/NotificationsPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { ProvidersPage } from './pages/ProvidersPage.jsx';
import { RawStatePage } from './pages/RawStatePage.jsx';
import { RenderedCfgPage } from './pages/RenderedCfgPage.jsx';
import { RenderedKeepalivedPage } from './pages/RenderedKeepalivedPage.jsx';
import { RoutesPage } from './pages/RoutesPage.jsx';
import { RulesPage } from './pages/RulesPage.jsx';
import { RuntimePage } from './pages/RuntimePage.jsx';
import { SetupAdminPage } from './pages/SetupAdminPage.jsx';
import { SetupPage } from './pages/SetupPage.jsx';
import { SnapshotsPage } from './pages/SnapshotsPage.jsx';
import { StatsPage } from './pages/StatsPage.jsx';
import { TopologyPage } from './pages/TopologyPage.jsx';

const wrap = element => <ErrorBoundary>{element}</ErrorBoundary>;

const AppContent = () => {
  const stateDoc = useStateDoc();
  const themeApi = useTheme();
  const pendingApi = usePendingChanges();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(null);

  const onApplyPending = useCallback(async () => {
    if (!pendingApi.pending) {
      return;
    }
    setApplying(true);
    setApplyError(null);
    try {
      await stateDoc.save(pendingApi.pending.doc);
      pendingApi.clearPending();
    } catch (err) {
      setApplyError(err);
    } finally {
      setApplying(false);
    }
  }, [pendingApi, stateDoc]);

  const onDiscardPending = useCallback(() => {
    setApplyError(null);
    pendingApi.clearPending();
  }, [pendingApi]);

  return (
    <>
      <Helmet>
        <title>patchpanel</title>
      </Helmet>
      {stateDoc.error ? (
        <Alert variant="danger" className="m-3">
          {stateDoc.error.message}
        </Alert>
      ) : null}
      <Routes>
        <Route
          path="/"
          element={
            <Layout
              status={stateDoc.saving ? 'saving…' : null}
              themePreference={themeApi.preference}
              themeEffective={themeApi.effective}
              onCycleTheme={themeApi.cyclePreference}
              pending={pendingApi.pending}
              applyingPending={applying}
              applyError={applyError}
              onApplyPending={onApplyPending}
              onDiscardPending={onDiscardPending}
            />
          }
        >
          <Route
            index
            element={wrap(
              stateDoc.loading ? (
                <Spinner animation="border" role="status" className="m-4" />
              ) : (
                <DashboardPage doc={stateDoc.doc} theme={themeApi.effective} />
              )
            )}
          />
          <Route
            path="global"
            element={wrap(<GlobalPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="defaults"
            element={wrap(<DefaultsPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="acls"
            element={wrap(<AclsPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="rules"
            element={wrap(<RulesPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="routes"
            element={wrap(<RoutesPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="backends"
            element={wrap(<BackendsPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="frontends"
            element={wrap(<FrontendsPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="providers"
            element={wrap(<ProvidersPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="certificates"
            element={wrap(<CertificatesPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="setup"
            element={wrap(<SetupPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route path="profile" element={wrap(<ProfilePage />)} />
          <Route
            path="ha"
            element={wrap(<HaproxyHaPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route path="stats" element={wrap(<StatsPage theme={themeApi.effective} />)} />
          <Route path="topology" element={wrap(<TopologyPage doc={stateDoc.doc} />)} />
          <Route path="runtime" element={wrap(<RuntimePage />)} />
          <Route path="logs" element={wrap(<LogsPage />)} />
          <Route path="audit" element={wrap(<AuditPage />)} />
          <Route path="api-docs" element={wrap(<ApiDocsPage />)} />
          <Route
            path="notifications"
            element={wrap(<NotificationsPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="error-pages"
            element={wrap(<ErrorPagesPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route path="rendered-cfg" element={wrap(<RenderedCfgPage onSave={stateDoc.save} />)} />
          <Route
            path="rendered-keepalived-cfg"
            element={wrap(<RenderedKeepalivedPage onSave={stateDoc.save} />)}
          />
          <Route path="snapshots" element={wrap(<SnapshotsPage />)} />
          <Route
            path="geoip"
            element={wrap(<GeoIPPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route
            path="advanced"
            element={wrap(<AdvancedPage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
          <Route path="config" element={wrap(<ConfigPage />)} />
          <Route
            path="raw-state"
            element={wrap(<RawStatePage doc={stateDoc.doc} onSave={stateDoc.save} />)}
          />
        </Route>
      </Routes>
    </>
  );
};

const ProtectedApp = () => (
  <ProtectedRoute>
    <PendingChangesProvider>
      <HaproxyLiveProvider>
        <KeepalivedLiveProvider>
          <AppContent />
        </KeepalivedLiveProvider>
      </HaproxyLiveProvider>
    </PendingChangesProvider>
  </ProtectedRoute>
);

export const App = () => (
  <AuthProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup-admin" element={<SetupAdminPage />} />
      <Route path="/*" element={<ProtectedApp />} />
    </Routes>
  </AuthProvider>
);
