import { Chart } from '@highcharts/react';
import PropTypes from 'prop-types';

import { createChartOptions, seriesColor } from './chartDefaults.js';
import './Highcharts.jsx';

export const SessionsChart = ({ histories, theme = 'light', height = 260 }) => {
  const series = histories.map((entry, idx) => ({
    name: entry.label,
    data: entry.history.map(p => [p.ts, p.scur]),
    color: seriesColor(idx, histories.length),
  }));

  const options = createChartOptions({
    title: 'Active sessions per proxy',
    height,
    theme,
    yAxisTitle: 'sessions',
    yAxisAllowDecimals: false,
    tooltipValueDecimals: 0,
    series,
  });

  return <Chart options={options} />;
};

SessionsChart.propTypes = {
  histories: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      history: PropTypes.arrayOf(
        PropTypes.shape({
          ts: PropTypes.number.isRequired,
          scur: PropTypes.number.isRequired,
        })
      ).isRequired,
    })
  ).isRequired,
  theme: PropTypes.oneOf(['light', 'dark']),
  height: PropTypes.number,
};
