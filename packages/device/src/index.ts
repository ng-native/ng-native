/**
 * The host: the device, the operating system, and the user's settings.
 *
 * Every capability here is a service with its own factory, so injecting one is the whole setup
 * and one nobody injects is never constructed. Off a device each falls back to doing nothing,
 * which is what makes the whole package importable by the test suite.
 */
export {
  Accessibility,
  type AccessibilitySettings,
  type AccessibilitySource,
} from './accessibility.ts';
export { AppState, type AppStateSource, type AppStatus } from './app-state.ts';
export { ColorScheme, type ColorSchemeSource, type Scheme } from './color-scheme.ts';
export {
  currentConditions,
  deviceTokens,
  watchConditions,
  type WatchOptions,
} from './conditions.ts';
export { DeepLinks, deepLinkSource, pathOf, type DeepLinkSource } from './deep-links.ts';
export {
  Direction,
  type DirectionContext,
  type DirectionSource,
  type LayoutDirection,
} from './direction.ts';
export {
  androidPermission,
  type AndroidPermissions,
  type PermissionAnswer,
} from './android-permissions.ts';
export { DevMenu, type DevMenuSource, type NativeDevMenu } from './dev-menu.ts';
export { Dialogs, type Choice, type NativeDialogs } from './dialogs.ts';
export {
  LayoutAnimation,
  type LayoutChange,
  type LayoutEasing,
  type NativeLayoutAnimation,
} from './layout-animation.ts';
export { Sharing, type NativeSharing, type ShareRequest } from './sharing.ts';
export { Vibration, type NativeVibration } from './vibration.ts';
export { HardwareBack, hardwareBackSource, type HardwareBackSource } from './hardware-back.ts';
export {
  KEYBOARD_MOTION,
  Keyboard,
  keyboardSource,
  type KeyboardMetrics,
  type KeyboardMotion,
  type KeyboardSource,
} from './keyboard.ts';
export type { NativeKeyboardEvent } from './react-native.ts';
export { SafeArea, type Frame, type Insets } from './safe-area.ts';
export { COMPACT_WIDTH, Screen, type ScreenSource, type Size, type Sizes } from './screen.ts';
export {
  StatusBar,
  statusBarSource,
  type PlatformStatusBarStyle,
  type StatusBarSource,
  type StatusBarState,
  type StatusBarStyle,
} from './status-bar.ts';
export {
  TopClaim,
  WindowClaims,
  onWindowFront,
  sharedBySource,
  type Claim,
} from './window-claims.ts';
export {
  NavigationBar,
  navigationBarSource,
  type NavigationBarSource,
  type NavigationBarState,
  type NavigationBarStyle,
} from './navigation-bar.ts';
export { SCREEN_IN_FRONT } from './screen-in-front.ts';
export { SCREEN_SHOWN } from './screen-shown.ts';
export { NATIVE_HISTORY } from './native-history.ts';
export { APPLE, DESKTOP, OS } from './os.ts';
export {
  MENU_MODEL,
  createMenuModel,
  defaultMenuBar,
  isSeparator,
  mergeMenuBar,
  type MenuEntry,
  type MenuGroupModel,
  type MenuGroupRole,
  type MenuItemModel,
  type MenuModel,
  type MenuRole,
  type MenuSeparator,
} from './menu-model.ts';
export {
  isEditingShortcut,
  matchesShortcut,
  parseShortcut,
  shortcutFires,
  type KeyChord,
  type ParsedShortcut,
  type ShortcutOs,
} from './shortcut.ts';
export { Processes, type NativeProcesses } from './processes.ts';
export {
  Menus,
  serializeMenu,
  type NativeMenuEntry,
  type NativeMenuEvent,
  type NativeMenus,
  type NativeShortcut,
  type SerializedMenu,
} from './menus.ts';
export { Dock, type NativeDock } from './dock.ts';
export {
  Tray,
  type NativeTray,
  type NativeTrayEvent,
  type NativeTrayIcon,
  type TrayIconModel,
} from './tray.ts';
export { SIDEBAR_SELECTION } from './sidebar-selection.ts';
export { WINDOW_NAVIGATOR, type WindowNavigator } from './window-navigator.ts';
export {
  AppWindows,
  CURRENT_WINDOW,
  MAIN_WINDOW_OPTIONS,
  WINDOW_MOUNTER,
  provideMainWindow,
  type AppWindow,
  type CloseGuard,
  type ComponentWindowOptions,
  type MainWindowOptions,
  type NativeWindowEvent,
  type NativeWindowRequest,
  type NativeWindows,
  type RouteWindowOptions,
  type TitleBar,
  type WindowMount,
  type WindowMounter,
  type WindowOptions,
} from './app-windows.ts';
export {
  APP_LIFECYCLE_OPTIONS,
  AppLifecycle,
  WILL_QUIT_DEADLINE_MS,
  provideAppLifecycle,
  quitsWithLastWindow,
  type AppLifecycleOptions,
} from './app-lifecycle.ts';
export { OS_VERSION } from './os-version.ts';
export { injectToken, type InjectTokenOptions } from './inject-token.ts';
export { type ControlSize } from './control-size.ts';
