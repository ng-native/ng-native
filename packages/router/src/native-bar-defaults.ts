/**
 * How every bar in the app looks when a call site does not say, set once with
 * `withHeaderDefaults` and `withTabDefaults` beside the routes.
 *
 * A bar is configured with props, and a prop cannot read the cascade, so an app whose bars should
 * match its pages would otherwise repeat the same bindings on every `<native-header>`. These fill
 * only what a call site left unset: a header that binds `backgroundColor` keeps it.
 *
 * Either kind can be a function of the colour scheme, which is how a bar follows the system
 * appearance the way a page's `@media (prefers-color-scheme: dark)` rules do. It runs inside a
 * `computed`, so any signal it reads is followed too.
 */
import { InjectionToken, signal, type Signal } from '@angular/core';
import type { Scheme } from '@ng-native/device';
import type { BackButtonDisplayMode, BlurEffect, HeaderInterfaceStyle } from './native-header.ts';
import type { TabAppearance } from './native-tab.ts';

/** A set of defaults, fixed or chosen per colour scheme. */
export type SchemeDefaults<T> = T | ((scheme: Scheme) => T);

/** The appearance inputs of `<native-header>` that make sense for a whole app. */
export interface HeaderDefaults {
  /**
   * On iOS 26 and later, the system's own navigation bar for every header that has no background
   * of its own: clear and unlined, with the content scrolling under it and blurring out. The bar
   * is then over the page, so the page's scroll view takes
   * `contentInsetAdjustmentBehavior="automatic"` to start below it. Elsewhere it does nothing.
   */
  readonly systemBar?: boolean;
  readonly userInterfaceStyle?: HeaderInterfaceStyle;
  readonly backgroundColor?: string | number;
  readonly color?: string | number;
  readonly blurEffect?: BlurEffect;
  readonly hideShadow?: boolean;
  readonly translucent?: boolean;
  readonly titleColor?: string | number;
  readonly titleFontFamily?: string;
  readonly titleFontSize?: number;
  readonly titleFontWeight?: string;
  readonly largeTitleColor?: string | number;
  readonly largeTitleBackgroundColor?: string | number;
  readonly largeTitleFontFamily?: string;
  readonly largeTitleFontSize?: number;
  readonly largeTitleFontWeight?: string;
  readonly largeTitleHideShadow?: boolean;
  readonly backTitleFontFamily?: string;
  readonly backTitleFontSize?: number;
  readonly backButtonDisplayMode?: BackButtonDisplayMode;
}

/** The appearance inputs of `<native-tabs-outlet>` and `<native-tab>` that suit a whole app. */
export interface TabDefaults {
  readonly tintColor?: string | number;
  readonly backgroundColor?: string | number;
  readonly colorScheme?: 'inherit' | 'light' | 'dark';
  readonly standardAppearance?: TabAppearance;
  readonly scrollEdgeAppearance?: TabAppearance;
}

const none = signal({}).asReadonly();

export const NATIVE_HEADER_DEFAULTS = new InjectionToken<Signal<HeaderDefaults>>(
  'angular-native.nativeHeaderDefaults',
  { factory: () => none },
);

export const NATIVE_TAB_DEFAULTS = new InjectionToken<Signal<TabDefaults>>(
  'angular-native.nativeTabDefaults',
  { factory: () => none },
);
