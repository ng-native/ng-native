const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const path = require('node:path');

// The framework packages are workspace members, so their real files live under packages/ rather
// than inside this app's node_modules. An app installing from npm passes no options at all.
module.exports = withAngularNative(getDefaultConfig(__dirname), {
  workspaceRoot: path.resolve(__dirname, '../..'),
});
