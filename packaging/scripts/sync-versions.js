#!/usr/bin/env node

import fs from 'fs';

/**
 * Synchronize version between the root package.json and all version-bearing
 * files in the workspace. release-please bumps the root version on every
 * release; this script propagates it everywhere else.
 *
 * Single source of truth: ./package.json
 */

const rootPackagePath = './package.json';
const serverPackagePath = './server/package.json';
const webPackagePath = './web/package.json';
const productionConfigPath = './packaging/config/production-config.yaml';
const releasePleaseManifestPath = './.release-please-manifest.json';

try {
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const rootVersion = rootPackage.version;

  const updateJsonVersion = path => {
    if (!fs.existsSync(path)) {
      return false;
    }
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = rootVersion;
    fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
    return true;
  };

  const updated = {
    server: updateJsonVersion(serverPackagePath),
    web: updateJsonVersion(webPackagePath),
  };

  if (fs.existsSync(productionConfigPath)) {
    let productionConfig = fs.readFileSync(productionConfigPath, 'utf8');
    productionConfig = productionConfig.replace(
      /^(?<prefix>\s*version:\s*).*$/m,
      `$<prefix>${rootVersion}`
    );
    fs.writeFileSync(productionConfigPath, productionConfig);
    updated.productionConfig = true;
  }

  if (fs.existsSync(releasePleaseManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(releasePleaseManifestPath, 'utf8'));
    manifest['.'] = rootVersion;
    fs.writeFileSync(releasePleaseManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    updated.manifest = true;
  }

  console.log(`Synchronized versions to ${rootVersion}`);
  console.log(`  root:             ${rootVersion}`);
  console.log(`  server:           ${updated.server ? rootVersion : '(skipped)'}`);
  console.log(`  web:              ${updated.web ? rootVersion : '(skipped)'}`);
  console.log(`  production-config: ${updated.productionConfig ? rootVersion : '(skipped)'}`);
  console.log(`  release-please:   ${updated.manifest ? rootVersion : '(skipped)'}`);
} catch (error) {
  console.error('Version synchronization failed:', error.message);
  throw error;
}
