// `expo export:embed --platform linux` checks the platform before it loads the Metro config, so an
// app that bundles for Linux registers it here as well (@ng-native/metro/linux.cjs).
require('@ng-native/metro/linux.cjs').registerLinux(__dirname);

module.exports = ({ config }) => config;
