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
export { DeepLinks, pathOf, type DeepLinkSource } from './deep-links.ts';
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
export { Keyboard, type KeyboardMetrics, type KeyboardSource } from './keyboard.ts';
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
export { SCREEN_IN_FRONT } from './screen-in-front.ts';
export { OS_VERSION } from './os-version.ts';
