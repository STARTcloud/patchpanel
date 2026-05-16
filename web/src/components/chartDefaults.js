const LIGHT_THEME = Object.freeze({
  background: 'transparent',
  textPrimary: '#212529',
  textMuted: '#6c757d',
  axisLine: '#dee2e6',
  gridLine: '#e9ecef',
  tooltipBg: '#ffffff',
  tooltipBorder: '#dee2e6',
});

const DARK_THEME = Object.freeze({
  background: 'transparent',
  textPrimary: '#f8f9fa',
  textMuted: '#adb5bd',
  axisLine: '#495057',
  gridLine: '#343a40',
  tooltipBg: '#212529',
  tooltipBorder: '#495057',
});

export const themeColors = theme => (theme === 'dark' ? DARK_THEME : LIGHT_THEME);

export const seriesColor = (index, total) => `hsl(${(index * 360) / Math.max(1, total)}, 65%, 55%)`;

export const createChartOptions = ({
  title,
  height = 260,
  series = [],
  yAxisTitle = '',
  yAxisMin = 0,
  yAxisAllowDecimals = true,
  tooltipValueSuffix = '',
  tooltipValueDecimals,
  theme = 'light',
  animation = true,
}) => {
  const colors = themeColors(theme);
  return {
    chart: {
      type: 'spline',
      height,
      backgroundColor: colors.background,
      animation: animation ? { duration: 500 } : false,
      style: { fontFamily: 'inherit' },
    },
    time: { useUTC: false },
    title: {
      text: title,
      style: { fontSize: '14px', fontWeight: 'bold', color: colors.textPrimary },
    },
    xAxis: {
      type: 'datetime',
      tickPixelInterval: 150,
      labels: { style: { color: colors.textMuted, fontSize: '10px' } },
      lineColor: colors.axisLine,
      tickColor: colors.axisLine,
      gridLineColor: colors.gridLine,
    },
    yAxis: {
      title: { text: yAxisTitle, style: { color: colors.textMuted, fontSize: '11px' } },
      min: yAxisMin,
      allowDecimals: yAxisAllowDecimals,
      labels: { style: { color: colors.textMuted, fontSize: '10px' } },
      lineColor: colors.axisLine,
      tickColor: colors.axisLine,
      gridLineColor: colors.gridLine,
    },
    legend: {
      enabled: true,
      itemStyle: { color: colors.textPrimary, fontSize: '10px' },
      itemHoverStyle: { color: colors.textMuted },
    },
    plotOptions: { spline: { marker: { enabled: false }, lineWidth: 2 } },
    series,
    credits: { enabled: false },
    tooltip: {
      shared: true,
      valueSuffix: tooltipValueSuffix,
      ...(tooltipValueDecimals !== undefined ? { valueDecimals: tooltipValueDecimals } : {}),
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      style: { color: colors.textPrimary, fontSize: '11px' },
    },
  };
};
