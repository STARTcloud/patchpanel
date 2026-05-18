import { Chart } from '@highcharts/react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { createChartOptions, seriesColor } from './chartDefaults.js';
import './Highcharts.jsx';

export const SessionsChart = ({ histories, theme = 'light', height = 260 }) => {
  const { t } = useTranslation(['stats']);
  const series = histories.map((entry, idx) => ({
    name: entry.label,
    data: entry.history.map(p => [p.ts, p.scur]),
    color: seriesColor(idx, histories.length),
  }));

  const options = createChartOptions({
    title: t('stats:sessions.chartTitle', 'Active sessions per proxy'),
    height,
    theme,
    yAxisTitle: t('stats:sessions.axisLabel', 'sessions'),
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
