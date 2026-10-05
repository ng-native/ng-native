/**
 * `@angular/router` on a native stack: the outlet that maps activated routes onto `RNSScreen`,
 * the `PlatformLocation` that stands in for the browser's history, and the reuse strategy that
 * keeps a popped screen's component alive while it animates out.
 *
 * Two of these are decorated, so the same caveat as the components barrel applies: a Node test
 * reaches the source file, not this.
 */
export { followLink, type LinkParent } from './native-links.ts';
export {
  NativeNavigation,
  type NativeNavigationOptions,
  type NavigationCommands,
  type PresentOptions,
} from './native-navigation.ts';
export { NativePlatformLocation, type LinkSource } from './native-platform-location.ts';
export { NativeRouterLink } from './native-router-link.ts';
export {
  NATIVE_HEADER_DEFAULTS,
  NATIVE_TAB_DEFAULTS,
  type HeaderDefaults,
  type SchemeDefaults,
  type TabDefaults,
} from './native-bar-defaults.ts';
export {
  NativeHeader,
  type BackButtonDisplayMode,
  type BlurEffect,
  type HeaderDirection,
  type HeaderInterfaceStyle,
} from './native-header.ts';
export {
  DEFAULT_HEADER_PALETTE,
  NATIVE_HEADER_PALETTE,
  type HeaderColors,
} from './native-header-palette.ts';
export { NativeHeaderItem, type HeaderItemType } from './native-header-item.ts';
export { NativeSearchBar, type SearchBarPlacement } from './native-search-bar.ts';
export { NativeStackOutlet } from './native-stack-outlet.ts';
export {
  NativeTab,
  type TabAppearance,
  type TabBarBlurEffect,
  type TabIcon,
  type TabIconProps,
  type TabItemAppearance,
  type TabStateAppearance,
  type TabSystemItem,
} from './native-tab.ts';
export { NativeTabsOutlet } from './native-tabs-outlet.ts';
export { ScreenSafeAreaView, type ScreenSafeAreaEdge } from './screen-safe-area-view.ts';
export { TabSafeAreaView, type TabSafeAreaEdge } from './tab-safe-area-view.ts';
export { NativeStackReuseStrategy, reuseScreen } from './native-stack-reuse-strategy.ts';
export {
  provideNativeRouter,
  withHeaderDefaults,
  withLinkParent,
  withTabDefaults,
  type NativeRouterFeature,
} from './provide-native-router.ts';
export {
  type GestureResponseDistance,
  type ReplaceAnimation,
  type ScreenPresentation,
  type StackAnimation,
  type StackPresentation,
  type SwipeDirection,
} from './screen-presentation.ts';
export { ActivityState, type ActivityStateValue } from './screens.ts';
export {
  fileRoutes,
  type FileRoutesOptions,
  type PageContext,
  type PageFiles,
  type RouteMeta,
} from './file-routes.ts';
export {
  MARKDOWN_PAGE,
  injectMarkdownPage,
  markdownPageFile,
  type MarkdownPageFile,
} from './markdown-page.ts';
export { FullWindowOverlay } from './full-window-overlay.ts';
