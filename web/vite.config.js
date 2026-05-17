import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Read package.json synchronously at config-load time. Vite's config file
// runs in Node ESM; the `import … with { type: 'json' }` attribute form is
// stage-4 but not universally recognised by the project's eslint parser, so
// we read the file directly instead.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const splitChunks = id => {
  // Keep highcharts + @highcharts/* + our setup wrapper together in one chunk
  // so the accessibility module loads after the core (zoneweaver-observed race).
  if (
    id.includes('node_modules/highcharts') ||
    id.includes('node_modules/@highcharts/') ||
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

// `vite build` hardcodes NODE_ENV=production regardless of --mode, which
// means React's source-time substitution still picks the production build
// (only #N error codes, no prose). To produce a genuinely-development
// React bundle for the addon's debug_ui toggle, the `build:debug` script
// runs with --mode development and we explicitly substitute NODE_ENV +
// disable minify here so the dev React build gets bundled and stays
// readable in DevTools.
export default defineConfig(({ mode }) => {
  const isDevBuild = mode === 'development';
  return {
    base: './',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      ...(isDevBuild ? { 'process.env.NODE_ENV': JSON.stringify('development') } : {}),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      minify: !isDevBuild,
      chunkSizeWarningLimit: isDevBuild ? 4096 : 1024,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: assetInfo => {
            // Vite 8 / Rolldown: `name` (single) is deprecated in favor of
            // `names` (array of all emitted names for this asset). Take the
            // first — there's almost always exactly one.
            const name = assetInfo.names?.[0];
            if (name === 'favicon.ico' || name === 'dark-favicon.ico') {
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
  };
});
