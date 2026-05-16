import PropTypes from 'prop-types';
import { Badge } from 'react-bootstrap';

// Tri-state HAProxy liveness badge. Reads `alive` directly from
// useHaproxyLive() — null = "checking…", true = "running", false = "stopped".
// Used in the navbar power-control toggle and on the dashboard Quick actions
// card so both reflect the same single source of truth.
export const HaproxyStatusBadge = ({ alive }) => {
  if (alive === null) {
    return <Badge bg="secondary">checking…</Badge>;
  }
  if (alive) {
    return (
      <Badge bg="success">
        <i className="bi bi-check-circle me-1" />
        running
      </Badge>
    );
  }
  return (
    <Badge bg="danger">
      <i className="bi bi-x-circle me-1" />
      stopped
    </Badge>
  );
};

HaproxyStatusBadge.propTypes = {
  alive: PropTypes.bool,
};
