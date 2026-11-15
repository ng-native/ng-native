/**
 * `"plugins": [["@ng-native/desktop", { ... }]]` in app.json: the options of the macOS build that
 * have no Expo key (document types, capabilities and the deny-list). Expo runs a plugin whenever
 * it reads the config, so a mistake in the options stops `expo start`, `expo export` and
 * `ng-native-desktop` with every problem listed, rather than turning into a capability the app
 * quietly lacks.
 *
 * It changes nothing in the config: the desktop host is not a native project prebuild writes, and
 * `ng-native-desktop` reads these options and the Expo keys it shares with iOS (`bin/app-config.mjs`)
 * when it builds.
 */
const { validateDesktopOptions } = require('@ng-native/device/desktop-options');

module.exports = function withNgNativeDesktop(config, options) {
  validateDesktopOptions(options);
  return config;
};
