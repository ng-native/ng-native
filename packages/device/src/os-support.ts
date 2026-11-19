/**
 * What each desktop API and each macOS-only input does on each OS: the one source the support
 * table on the documentation site is drawn from, and that `os-support.test.ts` holds the code to.
 *
 * A cell is `yes`; `absent`, where `available()` is false and every call is inert; `ignored`, where
 * the input has no effect; `inert`, where an element draws nothing and calls nothing; or a few
 * words on what the OS does instead. It has no imports, so a build script can read it.
 */

/** The OSes the table has a column for, iPadOS and iPhone apart. */
export type SupportOs = 'macos' | 'linux' | 'ipados' | 'iphone' | 'android' | 'web';

export interface OsSupportRow {
  /** The row's name in the table, as Markdown. */
  readonly feature: string;
  /**
   * What the row covers: exported classes and functions, inputs by name, and events as
   * `(dblclick)`. Every one exists.
   */
  readonly covers: readonly string[];
  /**
   * The services whose `available()` follows the row, each with the host module it is made from:
   * true where the row is not `absent` and the module is there, false where it is `absent`.
   */
  readonly services?: Readonly<Record<string, string>>;
  /**
   * Services with no host module of their own, whose `available()` follows the row: absent where the
   * row says `absent`, which `every-service.test.ts` checks call by call.
   */
  readonly inert?: readonly string[];
  /** The services have no `available()`, such as a view: where absent, the row says only that. */
  readonly withoutAvailable?: true;
  readonly on: Readonly<Record<SupportOs, string>>;
}

export const SUPPORT_OSES: Readonly<Record<SupportOs, string>> = {
  macos: 'macOS',
  linux: 'Linux',
  ipados: 'iPadOS',
  iphone: 'iPhone',
  android: 'Android',
  web: 'Web host',
};

/** A row's cells, in the order of `SUPPORT_OSES`. */
type Cells = readonly [string, string, string, string, string, string];

const row = (
  feature: string,
  covers: readonly string[],
  [macos, linux, ipados, iphone, android, web]: Cells,
  services?: Readonly<Record<string, string>>,
  inert?: readonly string[],
): OsSupportRow => ({
  feature,
  covers,
  on: { macos, linux, ipados, iphone, android, web },
  ...(services && { services }),
  ...(inert && { inert }),
});

/** On both desktop OSes, and nowhere else. */
const DESKTOP_ONLY = ['yes', 'yes', 'absent', 'absent', 'absent', 'absent'] as const;

/**
 * An Expo-backed service whose `available()` is whether its module is there: the Expo module on
 * iPadOS, iPhone and Android, the desktop host's module on macOS and Linux, and nothing on the web,
 * where the Expo module is not written for it.
 */
const EXPO_MODULE = ['yes', 'yes', 'yes', 'yes', 'yes', 'absent'] as const;

/** As `EXPO_MODULE`, where the Linux host has no source for the module, so it is absent there. */
const NOT_ON_LINUX = ['yes', 'absent', 'yes', 'yes', 'yes', 'absent'] as const;

const expoRow = (service: string, hostModule: string, cells: Cells = EXPO_MODULE): OsSupportRow =>
  row(`\`${service}\``, [], cells, { [service]: hostModule });

export const OS_SUPPORT: readonly OsSupportRow[] = [
  row(
    '`AppWindows.open`, `provideMainWindow`',
    ['AppWindows', 'CURRENT_WINDOW', 'provideMainWindow', 'provideRestorableWindows'],
    ['yes', 'yes', 'scenes, with `ios.multipleWindows`', 'absent', 'absent', 'absent'],
    { AppWindows: 'NgNativeWindows' },
  ),
  row(
    '`titleBar`, window size options',
    ['titleBar', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'resizable', 'fullScreen'],
    [
      'yes',
      '`maxWidth` and `maxHeight` only as the window opens',
      'ignored',
      'ignored',
      'ignored',
      'ignored',
    ],
  ),
  row(
    '`<menu-bar>`',
    ['MenuBar', 'MenuGroup', 'MenuItem', 'MenuSeparator', 'Menus'],
    [
      'menu bar',
      'menu bar on KDE Plasma, a menu button in the header bar elsewhere',
      'menu bar',
      'inert',
      'inert',
      'inert',
    ],
  ),
  row(
    '`[shortcut]`, menu item shortcuts',
    ['Shortcut'],
    [
      'yes',
      'yes',
      'yes',
      'hardware keyboard',
      'hardware keyboard, Keyboard Shortcuts helper',
      'yes',
    ],
  ),
  row(
    '`[contextMenu]`',
    ['ContextMenu'],
    [
      'yes',
      'secondary click',
      'long press or secondary click',
      'long press',
      'long press or right-click',
      'inert',
    ],
  ),
  row(
    '`<tray-icon>`',
    ['TrayIcon', 'Tray'],
    ['yes', 'while a StatusNotifierWatcher runs', 'absent', 'absent', 'absent', 'absent'],
    { Tray: 'NgNativeTray' },
  ),
  row('`Dock`', ['Dock'], ['yes', 'absent', 'absent', 'absent', 'absent', 'absent'], {
    Dock: 'NgNativeDock',
  }),
  row(
    '`<split-view>`, `<sidebar>`',
    ['SplitView', 'Sidebar', 'SidebarSection', 'SidebarItem', 'SidebarItemPath'],
    [
      'yes',
      'AdwNavigationSplitView, a stack at compact widths',
      'UISplitViewController, a stack at compact widths',
      'stack root',
      'list pane from 840dp, a stack below',
      'two columns',
    ],
  ),
  row('`Processes`, `Processes.env`', ['Processes'], DESKTOP_ONLY, {
    Processes: 'NgNativeProcesses',
  }),
  row('`Shell`', ['Shell'], DESKTOP_ONLY, { Shell: 'NgNativeShell' }),
  row(
    '`FileSystem.paths.home`, `desktop`, `downloads`',
    ['home', 'desktop', 'downloads'],
    DESKTOP_ONLY,
  ),
  row('`UndoStack`', ['UndoStack'], ['yes', 'yes', 'yes', 'yes', 'absent', 'absent'], {
    UndoStack: 'NgNativeUndo',
  }),
  row('`Printing.print({ window })`, File > Print...', [], DESKTOP_ONLY),
  row(
    '`Updates.checkForAppUpdate()`, `appUpdateAvailable`',
    ['appUpdateAvailable'],
    ['`dmg` builds', 'absent', 'absent', 'absent', 'absent', 'absent'],
  ),
  row(
    'Drag and drop: `(fileDrop)`, `[dragItem]`',
    ['FileDrop', 'DragItem', '(fileDrop)', '(fileDragEnter)', '(fileDragLeave)', 'dragItem'],
    ['yes', 'yes', 'yes', 'absent', 'absent', 'absent'],
  ),
  row(
    '`(mouseenter)`, `(mouseleave)`, `(mousemove)`, `(mouseover)`, `(mouseout)`',
    ['(mouseenter)', '(mouseleave)', '(mousemove)', '(mouseover)', '(mouseout)'],
    ['yes', 'yes', 'trackpad or mouse', 'ignored', 'mouse', 'yes'],
  ),
  row(
    '`(dblclick)`, `(contextmenu)`, `(wheel)`',
    ['(dblclick)', '(contextmenu)', '(wheel)'],
    ['yes', 'yes', 'ignored', 'ignored', 'ignored', 'ignored'],
  ),
  row(
    '`<native-button>`',
    ['NativeButton'],
    ['AppKit button', 'GTK button', 'UIKit button', 'UIKit button', 'drawn', 'HTML button'],
  ),
  row(
    '`controlSize`',
    ['controlSize'],
    ['yes', 'ignored', '`<native-button>`', '`<native-button>`', 'ignored', 'ignored'],
  ),
  row(
    '`anchor` on `<modal>`',
    ['anchor'],
    ['popover', 'popover', 'popover', 'ignored', 'ignored', 'ignored'],
  ),
  row(
    '`accessibilityLevel`, `aria-level`',
    ['accessibilityLevel'],
    ['macOS 26 and later', 'yes', 'ignored', 'ignored', 'ignored', 'yes'],
  ),
  row('`<refresh-control>`', ['RefreshControl'], ['inert', 'inert', 'yes', 'yes', 'yes', 'inert']),
  row(
    '`<keyboard-dock>`, `<keyboard-avoiding-view>`',
    ['KeyboardDock', 'KeyboardAvoidingView'],
    ['plain view', 'plain view', 'yes', 'yes', 'yes', 'plain view'],
  ),
  row(
    '`<input-accessory-view>`',
    ['InputAccessoryView'],
    ['plain view', 'plain view', 'yes', 'yes', 'plain view', 'docked at the bottom'],
  ),
  row(
    '`<expo-glass>`, `<expo-glass-container>`',
    [],
    ['yes', 'plain view', 'iOS 26 and later', 'iOS 26 and later', 'plain view', 'plain view'],
  ),
  row(
    'Community `slider`, `picker`, `masked-view`',
    [],
    ['absent: `ui-slider`, `ui-picker`', 'absent', 'yes', 'yes', 'yes', 'plain view'],
  ),
  row(
    '`HardwareBack`, `NavigationBar`',
    ['HardwareBack', 'NavigationBar'],
    ['absent', 'absent', 'absent', 'absent', 'yes', 'absent'],
    undefined,
    ['HardwareBack', 'NavigationBar'],
  ),
  row(
    '`StatusBar`, `Keyboard`',
    ['StatusBar', 'Keyboard'],
    ['absent', 'absent', 'yes', 'yes', 'yes', 'absent'],
    undefined,
    ['StatusBar', 'Keyboard'],
  ),
  row('`Vibration`', ['Vibration'], ['absent', 'absent', 'yes', 'yes', 'yes', 'yes'], undefined, [
    'Vibration',
  ]),
  row(
    '`BackgroundTask`, `Brightness`, `DeviceOrientation`',
    [],
    ['absent', 'absent', 'yes', 'yes', 'yes', 'absent'],
    undefined,
    ['BackgroundTask', 'Brightness', 'DeviceOrientation'],
  ),
  expoRow('AppInfo', 'NgNativeApplication', [
    'yes',
    'brand and manufacturer from the firmware, or null',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('Battery', 'NgNativeBattery', [
    'yes',
    'no battery without UPower',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('Browser', 'NgNativeWebBrowser', [
    'yes',
    'an auth session is always cancelled',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('Calendar', 'NgNativeCalendar', NOT_ON_LINUX),
  expoRow('Clipboard', 'NgNativeClipboard'),
  expoRow('Crypto', 'NgNativeCrypto', ['yes', 'no MD2 or MD4', 'yes', 'yes', 'yes', 'absent']),
  expoRow('DocumentPicker', 'NgNativeDocumentPicker'),
  expoRow('FileSystem', 'NgNativeFileSystem'),
  expoRow('Fonts', 'NgNativeFont'),
  expoRow('Haptics', 'NgNativeHaptics', NOT_ON_LINUX),
  expoRow('ImageEditor', 'NgNativeImageManipulator', [
    'yes',
    'WebP only where a WebP writer is installed',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('ImagePicker', 'NgNativeImagePicker', [
    'yes',
    'the library through the file chooser; no camera',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('KeepAwake', 'NgNativeKeepAwake'),
  expoRow('Locale', 'NgNativeLocalization'),
  expoRow('Location', 'NgNativeLocation', [
    'yes',
    'no geocoding; restricted without the Location portal',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('MediaLibrary', 'NgNativeMediaLibrary', NOT_ON_LINUX),
  expoRow('Network', 'NgNativeNetwork', [
    'yes',
    'type `OTHER` without NetworkManager',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('Notifications', 'NgNativeNotifications', [
    'yes',
    'no push token',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('Printing', 'NgNativePrint', ['yes', 'no HTML', 'yes', 'yes', 'yes', 'absent']),
  expoRow('SplashScreen', 'NgNativeSplashScreen'),
  expoRow('TextRecognition', 'NgNativeTextRecognition', [
    'yes',
    'absent',
    'yes',
    'yes',
    'absent',
    'absent',
  ]),
  expoRow('Updates', 'NgNativeUpdates', [
    'yes',
    'never fetches an update',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('AddressSearch', 'NgNativeAddressSearch', NOT_ON_LINUX),
  expoRow('AppleSignIn', 'NgNativeAppleAuthentication', [
    'signed with the Sign in with Apple entitlement',
    'absent',
    'yes',
    'yes',
    'absent',
    'absent',
  ]),
  expoRow('Biometrics', 'NgNativeLocalAuthentication', NOT_ON_LINUX),
  { ...expoRow('Camera', 'NgNativeCamera', NOT_ON_LINUX), withoutAvailable: true },
  {
    ...expoRow('MapView', 'NgNativeMaps', [
      'yes',
      'absent',
      'iPadOS 17 and later, marker taps from 18',
      'iOS 17 and later, marker taps from 18',
      'yes',
      'absent',
    ]),
    withoutAvailable: true,
  },
  expoRow('LanguageModel', 'NgNativeLocalLlm', [
    'macOS 26 and later, with Apple Intelligence on',
    'absent',
    'iPadOS 26 and later, with Apple Intelligence on',
    'iOS 26 and later, with Apple Intelligence on',
    'Gemini Nano, on the phones that ship it',
    'absent',
  ]),
  expoRow('ScreenCapture', 'NgNativeScreenCapture', [
    '`prevent` and `allow`, no screenshot count',
    'absent',
    'yes',
    'yes',
    'yes',
    'absent',
  ]),
  expoRow('StoreReview', 'NgNativeStoreReview', [
    'yes',
    'absent',
    'yes',
    'yes',
    'with the Play Store',
    'absent',
  ]),
  expoRow('Tracking', 'NgNativeTrackingTransparency', NOT_ON_LINUX),
  expoRow('Watch', 'WatchConnectivity', [
    'absent',
    'absent',
    'no watch to pair',
    'yes',
    'absent',
    'absent',
  ]),
  expoRow('Foldable', 'ExpoHinge', [
    'absent',
    'absent',
    'when a hinge is reported',
    'when a hinge is reported',
    'when a hinge is reported',
    'absent',
  ]),
  row(
    '`Accelerometer`, `Gyroscope`, `Magnetometer`, `DeviceMotion`, `Barometer`',
    [],
    ['absent', 'absent', 'yes', 'yes', 'yes', 'absent'],
    {
      Accelerometer: 'expo-sensors',
      Gyroscope: 'expo-sensors',
      Magnetometer: 'expo-sensors',
      DeviceMotion: 'expo-sensors',
      Barometer: 'expo-sensors',
    },
  ),
  row('`LightSensor`', [], ['absent', 'absent', 'absent', 'absent', 'yes', 'absent'], {
    LightSensor: 'expo-sensors',
  }),
  { ...row('`assets()`', [], EXPO_MODULE, { assets: 'NgNativeAsset' }), withoutAvailable: true },
  {
    ...row('`database()`', [], ['yes', 'yes', 'yes', 'yes', 'yes', 'yes'], {
      database: 'NgNativeSqlite',
    }),
    withoutAvailable: true,
  },
  {
    ...row('`videoPlayer()`', [], ['yes', 'absent', 'yes', 'yes', 'yes', 'yes'], {
      videoPlayer: 'NgNativeVideo',
    }),
    withoutAvailable: true,
  },
  {
    ...row(
      '`audioPlayer()`, `audioRecorder()`',
      [],
      ['yes', 'absent', 'yes', 'yes', 'yes', 'yes'],
      {
        audioPlayer: 'NgNativeAudio',
        audioRecorder: 'NgNativeAudio',
      },
    ),
    withoutAvailable: true,
  },
];

/** The row a service's `available()` follows, or undefined where the table has none for it. */
export function supportRowOf(service: string): OsSupportRow | undefined {
  // Own keys only: `constructor` is on every object, and names no service.
  return OS_SUPPORT.find(
    (one) => (one.services && Object.hasOwn(one.services, service)) || one.inert?.includes(service),
  );
}

/**
 * One line for a service's documentation page, drawn from its row: where it is available, with
 * the row's words where it is not a plain `yes`, and where it is absent. The documentation site
 * writes it under `<!-- platforms: Service -->`, so the page cannot disagree with the table.
 */
export function platformsLine(service: string): string | undefined {
  const row = supportRowOf(service);
  if (!row) return undefined;
  const oses = Object.keys(SUPPORT_OSES) as SupportOs[];
  const present = oses
    .filter((os) => row.on[os] !== 'absent')
    .map((os) => (row.on[os] === 'yes' ? SUPPORT_OSES[os] : `${SUPPORT_OSES[os]} (${row.on[os]})`));
  const absent = oses.filter((os) => row.on[os] === 'absent').map((os) => SUPPORT_OSES[os]);
  const list = (names: readonly string[]) =>
    names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const parts = [];
  if (present.length) parts.push(`Available on ${list(present)}.`);
  if (absent.length) {
    parts.push(
      row.withoutAvailable
        ? `Absent on ${list(absent)}.`
        : `Absent on ${list(absent)}, where \`available()\` is false.`,
    );
  }
  return `**Platforms.** ${parts.join(' ')}`;
}
