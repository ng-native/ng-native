/**
 * `"plugins": ["@ng-native/nativescript"]` in app.json: NativeScript's own config plugin, which
 * links the runtime and its metadata on iOS and applies its Gradle script on Android, without the
 * Babel config it would write. `@ng-native/metro` supplies that one, with the worklets plugin
 * configured for NativeScript's globals, so an app has no `babel.config.js` to keep.
 *
 * On Android it also sets `nsFilterMetadata=false` in `gradle.properties`, unless the app sets it.
 * NativeScript's metadata filtering adds keep rules to each minified build type's ProGuard files,
 * a list Android Gradle Plugin 9 (Expo SDK 58) makes immutable, so the build fails with
 * `UnsupportedOperationException` in `nativescript.gradle` whenever release minification is on,
 * as SDK 58 has it by default. Without filtering the metadata covers the whole classpath; R8 still
 * shrinks the app's code.
 *
 * Options are NativeScript's, such as `{ "metadata": { "includePods": ["SomeObjCSDK"] } }`.
 */
const FILTER = 'nsFilterMetadata';

// ponytail: drop once @nativescript/react-native adds its keep rules in a way AGP 9 accepts.
function withoutMetadataFilter(properties) {
  if (!properties.some((entry) => entry.type === 'property' && entry.key === FILTER)) {
    properties.push({ type: 'property', key: FILTER, value: 'false' });
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
    gradle.modResults = withoutMetadataFilter(gradle.modResults);
    return gradle;
  });
};

module.exports.withoutMetadataFilter = withoutMetadataFilter;
