import { Chart } from '@highcharts/react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

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

// `height` defaults to undefined → Highcharts uses the renderTo container's
// offsetHeight, which is what we want everywhere the chart lives in a flex
// chain with a definite height. Callers needing a fixed pixel size (e.g.
// the fullscreen ExpandedChartModal in StatsPage) pass an explicit number.
export const TrafficChart = ({ title, history, theme = 'light', height }) => {
  const { t } = useTranslation(['stats']);
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
        name: t('stats:traffic.in', 'in'),
        data: history.map(p => [p.ts, p.binRate / scale.divisor]),
        color: '#64b5f6',
      },
      {
        name: t('stats:traffic.out', 'out'),
        data: history.map(p => [p.ts, p.boutRate / scale.divisor]),
        color: '#ff9800',
      },
    ],
  });

  return <Chart options={options} containerProps={{ style: { width: '100%', height: '100%' } }} />;
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
