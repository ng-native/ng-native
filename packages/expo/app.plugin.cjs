/**
 * `"plugins": [["@ng-native/expo", { "pointerEvents": true }]]` in app.json: turns on React Native's
 * W3C pointer events, which both platforms leave off, so a trackpad, a mouse or a pencil reaches
 * `Pressable.hovered` and `@defer (on hover)`. The option goes in the app's Info.plist and manifest,
 * and this package's native code reads it at launch, before the first surface exists.
 */
const PLIST_KEY = 'NgNativePointerEvents';
const INDIRECT_INPUT_KEY = 'UIApplicationSupportsIndirectInputEvents';
const ADDED_KEY = 'NgNativeAddedIndirectInputEvents';
const MANIFEST_NAME = 'dev.ngnative.expo.POINTER_EVENTS';

function pointerEvents(options) {
  const value = options?.pointerEvents === undefined ? false : options.pointerEvents;
  if (typeof value !== 'boolean') {
    throw new Error(`[angular-native] pointerEvents takes true or false, not ${String(value)}.`);
  }
  return value;
}

function infoPlist(plist, options) {
  if (pointerEvents(options)) {
    plist[PLIST_KEY] = true;
    // Absent, iOS 16 presents a trackpad or a mouse as a finger: no hover recognizer sees it.
    // An app can set it for its own reasons, so a second key says when this plugin added it.
    if (plist[INDIRECT_INPUT_KEY] !== true) plist[ADDED_KEY] = true;
    plist[INDIRECT_INPUT_KEY] = true;
  } else {
    delete plist[PLIST_KEY];
    if (plist[ADDED_KEY]) delete plist[INDIRECT_INPUT_KEY];
    delete plist[ADDED_KEY];
  }
  return plist;
}

function androidManifest(manifest, options) {
  const on = pointerEvents(options);
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error('[angular-native] AndroidManifest.xml has no <application>.');
  const others = (application['meta-data'] ?? []).filter(
    (item) => item.$['android:name'] !== MANIFEST_NAME,
  );
  const flag = { $: { 'android:name': MANIFEST_NAME, 'android:value': 'true' } };
  application['meta-data'] = on ? [...others, flag] : others;
  return manifest;
}

module.exports = function withNgNativeExpo(config, options) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const { withInfoPlist, withAndroidManifest } = require(
    require.resolve('expo/config-plugins', { paths: [projectRoot] }),
  );
  const withPlist = withInfoPlist(config, (ios) => {
    ios.modResults = infoPlist(ios.modResults, options);
    return ios;
  });
  return withAndroidManifest(withPlist, (android) => {
    android.modResults = androidManifest(android.modResults, options);
    return android;
  });
};

module.exports.infoPlist = infoPlist;
module.exports.androidManifest = androidManifest;
