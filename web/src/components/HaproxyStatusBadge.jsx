import PropTypes from 'prop-types';

// HAProxy liveness indicator. Single icon, color reflects state — no pill,
// no "running" wordmark. `alive === null` is the "checking…" state.
//   true  → green power icon
//   false → red power icon (off variant)
//   null  → muted/spinner
export const HaproxyStatusBadge = ({ alive, title = null }) => {
  if (alive === null) {
    return (
      <i
        className="bi bi-power text-muted"
        title={title ?? 'Checking HAProxy status…'}
        aria-label="HAProxy status checking"
      />
    );
  }
  if (alive) {
    return (
      <i
        className="bi bi-power text-success"
        title={title ?? 'HAProxy is running'}
        aria-label="HAProxy running"
      />
    );
  }
  return (
    <i
      className="bi bi-power text-danger"
      title={title ?? 'HAProxy is stopped'}
      aria-label="HAProxy stopped"
    />
  );
};

HaproxyStatusBadge.propTypes = {
  alive: PropTypes.bool,
  title: PropTypes.string,
};
