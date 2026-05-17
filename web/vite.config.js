import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const splitChunks = id => {
  // Keep highcharts + helper + our wrapper together in one chunk so the
  // accessibility module loads after the core (zoneweaver-observed race).
  if (
    id.includes('node_modules/highcharts') ||
    id.includes('node_modules/highcharts-react-official') ||
    id.includes('/components/Highcharts.jsx')
  ) {
    return 'charts';
  }
  if (id.includes('node_modules/react-bootstrap')) {
    return 'ui';
  }
  if (
    id.includes('node_modules/@dr.pogodin/react-helmet') ||
    id.includes('node_modules/prop-types')
  ) {
    return 'utils';
  }
  if (
    id.includes('node_modules/react-dom') ||
    id.includes('node_modules/react/') ||
    id.includes('node_modules/react-router')
  ) {
    return 'vendor';
  }
  return undefined;
};

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: assetInfo => {
          if (assetInfo.name === 'favicon.ico' || assetInfo.name === 'dark-favicon.ico') {
            return '[name][extname]';
          }
          return 'assets/[name].[ext]';
        },
        manualChunks: splitChunks,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8099',
    },
  },
});
