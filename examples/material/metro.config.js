const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withTailwind } = require('@ng-native/tailwind/config.cjs');
const { withWebCompat } = require('@ng-native/web-compat/metro');
const path = require('node:path');

// The framework packages are workspace members, so their real files live under packages/ rather
// than inside this app's node_modules. An app installing from npm passes no options at all.
const config = withTailwind(
  withAngularNative(getDefaultConfig(__dirname), {
    workspaceRoot: path.resolve(__dirname, '../..'),
  }),
  // The app's global sheet: Material's theme tokens and its icon font.
  { input: './src/styles.css' },
);

// Last: Angular Material and the CDK it sits on are written for a browser, so their stylesheets
// are read as a browser reads them. The app's own components stay native views.
module.exports = withWebCompat(config, { libraries: ['@angular/cdk', '@angular/material'] });
