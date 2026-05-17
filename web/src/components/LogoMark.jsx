import PropTypes from 'prop-types';

// Inline SVG so `currentColor` on the strokes + circles resolves against the
// parent's text color (dark navbar = white, light surface = body color).
// Single source of truth — the standalone web/public/logo.svg is the
// favicon-ready variant; this component is what every React surface uses.
export const LogoMark = ({ size = 28, title = 'patchpanel', className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 220 220"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label={title}
    className={className}
  >
    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M50 60 C 85 30, 140 100, 170 60" />
      <path d="M50 60 C 95 130, 130 150, 170 110" />
      <path d="M50 110 C 110 80, 120 40, 170 160" />
      <path d="M50 110 C 80 160, 140 120, 170 60" />
      <path d="M50 160 C 95 110, 130 70, 170 110" />
      <path d="M50 160 C 90 130, 140 190, 170 160" />
    </g>
    <g fill="currentColor">
      <circle cx="50" cy="60" r="5" />
      <circle cx="50" cy="110" r="5" />
      <circle cx="50" cy="160" r="5" />
      <circle cx="170" cy="60" r="5" />
      <circle cx="170" cy="110" r="5" />
      <circle cx="170" cy="160" r="5" />
    </g>
  </svg>
);

LogoMark.propTypes = {
  size: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  title: PropTypes.string,
  className: PropTypes.string,
};
