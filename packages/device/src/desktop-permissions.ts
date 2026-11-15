/**
 * The permissions a macOS build declares, read from the Expo keys an app already sets for iOS: the
 * usage strings in `ios.infoPlist` and each `expo-*` plugin's permission option. There is no
 * second declaration for the desktop: an app that set `NSMicrophoneUsageDescription`, or
 * expo-audio's `microphonePermission`, has declared the microphone on macOS too. Plain TypeScript
 * with no imports, for the config plugin.
 */

/** One usage string a plugin writes: the option it reads, the key, and its own default. */
type Usage = readonly [option: string, key: string, fallback: string];

/** A plugin's default, as Expo writes it: `$(PRODUCT_NAME)` is the app's name. */
const allow = (what: string): string => `Allow $(PRODUCT_NAME) to ${what}`;

const CAMERA: Usage = ['cameraPermission', 'NSCameraUsageDescription', allow('access your camera')];
const MICROPHONE: Usage = [
  'microphonePermission',
  'NSMicrophoneUsageDescription',
  allow('access your microphone'),
];
const PHOTOS: Usage = [
  'photosPermission',
  'NSPhotoLibraryUsageDescription',
  allow('access your photos'),
];
const LOCATION = (option: string, key: string): Usage => [
  option,
  key,
  allow('access your location'),
];

/**
 * The usage strings each plugin writes, as its iOS config plugin does: the option's string, else
 * what `ios.infoPlist` has, else the plugin's own default. Each default reads `Allow <app> to ...`.
 */
const PLUGIN_USAGE: Readonly<
  Record<string, (options: Readonly<Record<string, unknown>>) => readonly Usage[]>
> = {
  'expo-camera': () => [CAMERA, MICROPHONE],
  'expo-audio': () => [MICROPHONE],
  'expo-image-picker': () => [PHOTOS, CAMERA, MICROPHONE],
  'expo-media-library': () => [
    PHOTOS,
    ['savePhotosPermission', 'NSPhotoLibraryAddUsageDescription', allow('save photos')],
  ],
  'expo-location': () => [
    LOCATION(
      'locationAlwaysAndWhenInUsePermission',
      'NSLocationAlwaysAndWhenInUseUsageDescription',
    ),
    LOCATION('locationAlwaysPermission', 'NSLocationAlwaysUsageDescription'),
    LOCATION('locationWhenInUsePermission', 'NSLocationWhenInUseUsageDescription'),
  ],
  'expo-calendar': (options) => [
    ['calendarPermission', 'NSCalendarsUsageDescription', allow('access your calendars')],
    ['remindersPermission', 'NSRemindersUsageDescription', allow('access your reminders')],
    [
      'remindersPermission',
      'NSRemindersFullAccessUsageDescription',
      allow('access your reminders'),
    ],
    options['writeOnlyAccess']
      ? [
          'writeOnlyCalendarPermission',
          'NSCalendarsWriteOnlyAccessUsageDescription',
          allow('add events to your calendars'),
        ]
      : [
          'calendarPermission',
          'NSCalendarsFullAccessUsageDescription',
          allow('access your calendars'),
        ],
  ],
  'expo-contacts': () => [
    ['contactsPermission', 'NSContactsUsageDescription', allow('access your contacts')],
  ],
  'expo-local-authentication': () => [
    ['faceIDPermission', 'NSFaceIDUsageDescription', allow('use Face ID')],
  ],
  'expo-tracking-transparency': () => [
    [
      'userTrackingPermission',
      'NSUserTrackingUsageDescription',
      'Allow this app to collect app-related data that can be used for tracking you or your device.',
    ],
  ],
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
  NSCalendarsWriteOnlyAccessUsageDescription: 'com.apple.security.personal-information.calendars',
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
  /** The app's name, which a plugin's default string and `$(PRODUCT_NAME)` stand for. */
  readonly name?: string;
  readonly ios?: { readonly infoPlist?: Readonly<Record<string, unknown>> };
  readonly plugins?: readonly unknown[];
}

const USAGE_KEY = /^NS[A-Za-z]+UsageDescription$/;

/**
 * The usage strings and sandbox entitlements a macOS build declares, from the Expo config's
 * `ios.infoPlist` and plugins. A plugin's option wins over the same key in `infoPlist`, which wins
 * over the plugin's own default, as the plugin's iOS config does; `false` for an option leaves its
 * key out. `$(PRODUCT_NAME)`, which Xcode fills in on iOS, is the app's name.
 */
export function macosPermissions(config: ExpoPermissionConfig): MacosPermissions {
  const usageStrings = fromInfoPlist(config.ios?.infoPlist ?? {});
  for (const entry of config.plugins ?? []) applyPlugin(usageStrings, entry);
  const name = config.name ?? 'this app';
  for (const [key, value] of Object.entries(usageStrings)) {
    usageStrings[key] = value.replaceAll('$(PRODUCT_NAME)', name);
  }
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

/** Write the usage strings one `plugins` entry writes, or take away those it turns off. */
function applyPlugin(usageStrings: Record<string, string>, entry: unknown): void {
  const [name, given] = Array.isArray(entry) ? entry : [entry, undefined];
  const options = (typeof given === 'object' && given !== null ? given : {}) as Record<
    string,
    unknown
  >;
  const usages = typeof name === 'string' ? PLUGIN_USAGE[name]?.(options) : undefined;
  for (const [option, key, fallback] of usages ?? []) {
    const value = options[option];
    if (value === false) delete usageStrings[key];
    else if (typeof value === 'string' && value !== '') usageStrings[key] = value;
    else usageStrings[key] ??= fallback;
  }
}
