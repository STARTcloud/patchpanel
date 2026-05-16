import PropTypes from 'prop-types';

const iconFor = (active, direction) => {
  if (!active) {
    return 'bi-arrow-down-up';
  }
  return direction === 'asc' ? 'bi-sort-down-alt' : 'bi-sort-up';
};

export const SortableHeader = ({ label, field, sort, onToggle, className = '' }) => {
  const active = sort?.field === field;
  const icon = iconFor(active, sort?.direction);
  return (
    <th
      className={`${className} user-select-none`}
      style={{ cursor: 'pointer' }}
      onClick={() => onToggle(field)}
    >
      <span className="d-inline-flex align-items-center gap-1">
        {label}
        <i className={`bi ${icon} text-muted small`} />
      </span>
    </th>
  );
};

SortableHeader.propTypes = {
  label: PropTypes.string.isRequired,
  field: PropTypes.oneOfType([PropTypes.string, PropTypes.func]).isRequired,
  sort: PropTypes.shape({
    field: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
    direction: PropTypes.oneOf(['asc', 'desc']),
  }),
  onToggle: PropTypes.func.isRequired,
  className: PropTypes.string,
};
