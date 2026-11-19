const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withTailwind } = require('@ng-native/tailwind/config.cjs');
const path = require('node:path');

// The framework packages are workspace members, so their real files live under packages/ rather
// than inside this app's node_modules. An app installing from npm passes no options at all.
const config = withAngularNative(getDefaultConfig(__dirname), {
  workspaceRoot: path.resolve(__dirname, '../..'),
});

// Runs the Tailwind CLI over `styles.css`, and leaves it watching: a class written in a template
// appears in the generated sheet, which Metro then treats as a changed module.
const { withDeviceTests } = require('@ng-native/testing/device/metro');

// `withDeviceTests` does nothing until Metro starts with EXPO_PUBLIC_DEVICE_TESTS set, for
// `vitest --project linux` and `--project macos`.
module.exports = withDeviceTests(withTailwind(config, { input: './src/styles.css' }));
