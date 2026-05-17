import { Chart } from '@highcharts/react';
import PropTypes from 'prop-types';

import { createChartOptions } from './chartDefaults.js';
import './Highcharts.jsx';

const SCALE_UNITS = [
  { divisor: 1024 * 1024 * 1024, suffix: ' GB/s' },
  { divisor: 1024 * 1024, suffix: ' MB/s' },
  { divisor: 1024, suffix: ' KB/s' },
  { divisor: 1, suffix: ' B/s' },
];

const pickScale = history => {
  let max = 0;
  for (const point of history) {
    if (point.binRate > max) {
      max = point.binRate;
    }
    if (point.boutRate > max) {
      max = point.boutRate;
    }
  }
  for (const scale of SCALE_UNITS) {
    if (max >= scale.divisor) {
      return scale;
    }
  }
  return SCALE_UNITS[SCALE_UNITS.length - 1];
};

export const TrafficChart = ({ title, history, theme = 'light', height = 260 }) => {
  const scale = pickScale(history);
  const options = createChartOptions({
    title,
    height,
    theme,
    yAxisTitle: scale.suffix.trim(),
    tooltipValueSuffix: scale.suffix,
    tooltipValueDecimals: 2,
    series: [
      {
        name: 'in',
        data: history.map(p => [p.ts, p.binRate / scale.divisor]),
        color: '#64b5f6',
      },
      {
        name: 'out',
        data: history.map(p => [p.ts, p.boutRate / scale.divisor]),
        color: '#ff9800',
      },
    ],
  });

  return <Chart options={options} />;
};

TrafficChart.propTypes = {
  title: PropTypes.string.isRequired,
  history: PropTypes.arrayOf(
    PropTypes.shape({
      ts: PropTypes.number.isRequired,
      binRate: PropTypes.number.isRequired,
      boutRate: PropTypes.number.isRequired,
    })
  ).isRequired,
  theme: PropTypes.oneOf(['light', 'dark']),
  height: PropTypes.number,
};
