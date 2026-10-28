/**
 * `"plugins": ["@ng-native/firebase-messaging"]` in app.json: turns on FCM registration by
 * installation ID, which both platforms leave off (registering then fails with "API disabled"),
 * and turns off Firebase's app delegate proxy on iOS, which would swizzle the push methods
 * `expo-notifications` owns. The APNs token reaches FCM through `register()` instead.
 *
 * In the Podfile it gives `GoogleUtilities` modules, without which CocoaPods refuses to link
 * Firebase's Swift pods as the static libraries an Expo app builds.
 *
 * Firebase's config files are Expo's own `ios.googleServicesFile` and `android.googleServicesFile`.
 */
const MANIFEST_FLAG = 'firebase_messaging_installation_id_enabled';

function infoPlist(plist) {
  plist.FirebaseMessagingInstallationIdEnabled = true;
  plist.FirebaseAppDelegateProxyEnabled = false;
  return plist;
}

const MODULAR = "pod 'GoogleUtilities', :modular_headers => true";

function podfile(contents) {
  if (/^[ \t]*pod ['"]GoogleUtilities['"]/m.test(contents)) return contents;
  const expo = /^([ \t]*)use_expo_modules!.*$/m.exec(contents);
  if (!expo) throw new Error('[angular-native] The Podfile has no use_expo_modules! to add to.');
  const end = expo.index + expo[0].length;
  return `${contents.slice(0, end)}\n${expo[1]}${MODULAR}${contents.slice(end)}`;
}

function androidManifest(manifest) {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error('[angular-native] AndroidManifest.xml has no <application>.');
  const items = (application['meta-data'] ??= []);
  const found = items.find((item) => item.$['android:name'] === MANIFEST_FLAG);
  if (found) found.$['android:value'] = 'true';
  else items.push({ $: { 'android:name': MANIFEST_FLAG, 'android:value': 'true' } });
  return manifest;
}

module.exports = function withFirebaseMessaging(config) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const { withInfoPlist, withPodfile, withAndroidManifest } = require(
    require.resolve('expo/config-plugins', { paths: [projectRoot] }),
  );
  const withPlist = withInfoPlist(config, (ios) => {
    ios.modResults = infoPlist(ios.modResults);
    return ios;
  });
  const withPods = withPodfile(withPlist, (pods) => {
    pods.modResults.contents = podfile(pods.modResults.contents);
    return pods;
  });
  return withAndroidManifest(withPods, (android) => {
    android.modResults = androidManifest(android.modResults);
    return android;
  });
};

module.exports.infoPlist = infoPlist;
module.exports.podfile = podfile;
module.exports.androidManifest = androidManifest;
