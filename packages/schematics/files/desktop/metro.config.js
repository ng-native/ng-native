const { getDefaultConfig } = require('expo/metro-config');
const { withAngularNative } = require('@ng-native/metro/config.cjs');
const { withDeviceTests } = require('@ng-native/testing/device/metro');

// Registers the transformer that compiles Angular ahead of time, compiles each component's CSS
// into the sheet the engine reads, and adds the polyfills Angular needs before `@angular/core`
// is first evaluated. No options: the framework packages are ordinary dependencies here.
// `withDeviceTests` does nothing until Metro starts with EXPO_PUBLIC_DEVICE_TESTS set, for the
// tests that run inside the app.
module.exports = withDeviceTests(withAngularNative(getDefaultConfig(__dirname)));
