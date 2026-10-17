/**
 * `"plugins": ["@ng-native/nativescript"]` in app.json: NativeScript's own config plugin, which
 * links the runtime and its metadata on iOS and applies its Gradle script on Android, without the
 * Babel config it would write. `@ng-native/metro` supplies that one, with the worklets plugin
 * configured for NativeScript's globals, so an app has no `babel.config.js` to keep.
 *
 * Options are NativeScript's, such as `{ "metadata": { "includePods": ["SomeObjCSDK"] } }`.
 */
module.exports = function withNativeScript(config, options = {}) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  let plugin;
  try {
    plugin = require(
      require.resolve('@nativescript/react-native/app.plugin.js', { paths: [projectRoot] }),
    );
  } catch (cause) {
    throw new Error(
      '[angular-native] @ng-native/nativescript needs @nativescript/react-native. Install it with ' +
        '"npx expo install @nativescript/react-native react-native-worklets".',
      { cause },
    );
  }
  return plugin(config, { ...options, babelPlugin: false });
};
