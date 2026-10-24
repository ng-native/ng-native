/**
 * `"plugins": ["@ng-native/nativescript"]` in app.json: NativeScript's own config plugin, which
 * links the runtime and its metadata on iOS and applies its Gradle script on Android, without the
 * Babel config it would write. `@ng-native/metro` supplies that one, with the worklets plugin
 * configured for NativeScript's globals, so an app has no `babel.config.js` to keep.
 *
 * On Android it sets two lines in `gradle.properties`, for a release build, which
 * `@nativescript/react-native` 9.1.2 can neither build nor run on Expo SDK 58 as it is:
 *
 * - `android.enableMinifyInReleaseBuilds=false`, over the `true` SDK 58's prebuild writes. With R8
 *   on, NativeScript's metadata filtering adds keep rules to a list Android Gradle Plugin 9 makes
 *   immutable, and the build fails with `UnsupportedOperationException` in `nativescript.gradle`;
 *   and NativeScript ships no keep rules for its own runtime, so R8 renames the classes its native
 *   code looks up by name and the app aborts at launch with `JNI DETECTED ERROR: mid == null`.
 * - `nsSkipStaticBindings=true`. The release task that pre-generates Java for named subclasses
 *   bundles the app with React Native's CLI, which an Expo app does not have; skipped, those classes
 *   are generated on the device at startup, as in a debug build.
 *
 * Options are NativeScript's, such as `{ "metadata": { "includePods": ["SomeObjCSDK"] } }`.
 */
const RELEASE = { 'android.enableMinifyInReleaseBuilds': 'false', nsSkipStaticBindings: 'true' };

// ponytail: drop once @nativescript/react-native ships keep rules AGP 9 accepts and bundles
// through the app's own React Native CLI (`react.cliFile` and `react.bundleCommand`).
function releaseProperties(properties) {
  for (const [key, value] of Object.entries(RELEASE)) {
    const found = properties.find((entry) => entry.type === 'property' && entry.key === key);
    if (found) found.value = value;
    else properties.push({ type: 'property', key, value });
  }
  return properties;
}

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
  const { withGradleProperties } = require(
    require.resolve('expo/config-plugins', { paths: [projectRoot] }),
  );
  const configured = plugin(config, { ...options, babelPlugin: false });
  return withGradleProperties(configured, (gradle) => {
    gradle.modResults = releaseProperties(gradle.modResults);
    return gradle;
  });
};

module.exports.releaseProperties = releaseProperties;
