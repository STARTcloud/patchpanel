import PropTypes from 'prop-types';
import { Spinner } from 'react-bootstrap';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '../hooks/useAuth.jsx';

// Wrap the authenticated portion of the app. Three states:
//   loading        → render spinner
//   authenticated  → render children
//   anonymous      → redirect to /login (unless we're already on /setup-admin
//                    handling the first-run flow)
//
// Mirrors Armor's ProtectedRoute (G:/Projects/armor/web/src/components/
// auth/ProtectedRoute.jsx). Preserves return-path through ?return= so
// the user lands back on the page they were trying to reach.

export const ProtectedRoute = ({ children }) => {
  const { loading, authenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: '60vh' }}
      >
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (!authenticated) {
    const ret = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?return=${ret}`} replace />;
  }

  return children;
};

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};
