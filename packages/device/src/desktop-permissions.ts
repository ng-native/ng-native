/**
 * The permissions a macOS build declares, read from the Expo keys an app already sets for iOS: the
 * usage strings in `ios.infoPlist` and each `expo-*` plugin's permission option. There is no
 * second declaration for the desktop: an app that set `NSMicrophoneUsageDescription`, or
 * expo-audio's `microphonePermission`, has declared the microphone on macOS too. Plain TypeScript
 * with no imports, for the config plugin.
 */

/** The usage strings each plugin's options write, by option name, as its iOS config plugin does. */
const PLUGIN_USAGE_STRINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'expo-camera': {
    cameraPermission: 'NSCameraUsageDescription',
    microphonePermission: 'NSMicrophoneUsageDescription',
  },
  'expo-audio': { microphonePermission: 'NSMicrophoneUsageDescription' },
  'expo-image-picker': {
    photosPermission: 'NSPhotoLibraryUsageDescription',
    cameraPermission: 'NSCameraUsageDescription',
    microphonePermission: 'NSMicrophoneUsageDescription',
  },
  'expo-media-library': {
    photosPermission: 'NSPhotoLibraryUsageDescription',
    savePhotosPermission: 'NSPhotoLibraryAddUsageDescription',
  },
  'expo-location': {
    locationWhenInUsePermission: 'NSLocationWhenInUseUsageDescription',
    locationAlwaysPermission: 'NSLocationAlwaysUsageDescription',
    locationAlwaysAndWhenInUsePermission: 'NSLocationAlwaysAndWhenInUseUsageDescription',
  },
  'expo-calendar': {
    calendarPermission: 'NSCalendarsFullAccessUsageDescription',
    remindersPermission: 'NSRemindersFullAccessUsageDescription',
  },
  'expo-contacts': { contactsPermission: 'NSContactsUsageDescription' },
  'expo-local-authentication': { faceIDPermission: 'NSFaceIDUsageDescription' },
  'expo-tracking-transparency': { userTrackingPermission: 'NSUserTrackingUsageDescription' },
};

/**
 * The App Sandbox entitlement each usage string needs in a sandboxed (`mas`) build, where macOS
 * has one. A usage string with none, such as Face ID's, still goes in Info.plist.
 */
const SANDBOX_ENTITLEMENTS: Readonly<Record<string, string>> = {
  NSCameraUsageDescription: 'com.apple.security.device.camera',
  NSMicrophoneUsageDescription: 'com.apple.security.device.audio-input',
  NSPhotoLibraryUsageDescription: 'com.apple.security.personal-information.photos-library',
  NSPhotoLibraryAddUsageDescription: 'com.apple.security.personal-information.photos-library',
  NSLocationWhenInUseUsageDescription: 'com.apple.security.personal-information.location',
  NSLocationAlwaysUsageDescription: 'com.apple.security.personal-information.location',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'com.apple.security.personal-information.location',
  NSLocationUsageDescription: 'com.apple.security.personal-information.location',
  NSCalendarsUsageDescription: 'com.apple.security.personal-information.calendars',
  NSCalendarsFullAccessUsageDescription: 'com.apple.security.personal-information.calendars',
  NSRemindersUsageDescription: 'com.apple.security.personal-information.calendars',
  NSRemindersFullAccessUsageDescription: 'com.apple.security.personal-information.calendars',
  NSContactsUsageDescription: 'com.apple.security.personal-information.addressbook',
};

/** What a macOS build declares for the permissions the app asks for. */
export interface MacosPermissions {
  /** Info.plist usage strings, by key. */
  readonly usageStrings: Readonly<Record<string, string>>;
  /** The App Sandbox entitlements a `mas` build needs for them, sorted. */
  readonly sandboxEntitlements: readonly string[];
}

/** The part of an Expo config the permissions are read from. */
export interface ExpoPermissionConfig {
  readonly ios?: { readonly infoPlist?: Readonly<Record<string, unknown>> };
  readonly plugins?: readonly unknown[];
}

const USAGE_KEY = /^NS[A-Za-z]+UsageDescription$/;

/**
 * The usage strings and sandbox entitlements a macOS build declares, from the Expo config's
 * `ios.infoPlist` and plugin options. A plugin's option wins over the same key in `infoPlist`, as
 * the plugin's own iOS config does; `false` for an option leaves its key out.
 */
export function macosPermissions(config: ExpoPermissionConfig): MacosPermissions {
  const usageStrings = fromInfoPlist(config.ios?.infoPlist ?? {});
  for (const entry of config.plugins ?? []) applyPlugin(usageStrings, entry);
  const entitlements = new Set(
    Object.keys(usageStrings)
      .map((key) => SANDBOX_ENTITLEMENTS[key])
      .filter((entitlement): entitlement is string => entitlement !== undefined),
  );
  return { usageStrings, sandboxEntitlements: [...entitlements].sort() };
}

/** The usage strings `ios.infoPlist` sets. */
function fromInfoPlist(infoPlist: Readonly<Record<string, unknown>>): Record<string, string> {
  const usageStrings: Record<string, string> = {};
  for (const [key, value] of Object.entries(infoPlist)) {
    if (USAGE_KEY.test(key) && typeof value === 'string' && value !== '') usageStrings[key] = value;
  }
  return usageStrings;
}

/** Write the usage strings one `plugins` entry's options set, or take away those it turns off. */
function applyPlugin(usageStrings: Record<string, string>, entry: unknown): void {
  const [name, options] = Array.isArray(entry) ? entry : [entry, undefined];
  const keys = typeof name === 'string' ? PLUGIN_USAGE_STRINGS[name] : undefined;
  if (!keys || typeof options !== 'object' || options === null) return;
  for (const [option, key] of Object.entries(keys)) {
    const value = (options as Record<string, unknown>)[option];
    if (typeof value === 'string' && value !== '') usageStrings[key] = value;
    else if (value === false) delete usageStrings[key];
  }
}
