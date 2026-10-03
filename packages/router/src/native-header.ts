/**
 * The screen's navigation bar, as a component you write inside a page's template.
 *
 * Commits as `RNSScreenStackHeaderConfig`. It is a configuration node rather than a view: the
 * native side reads its props and builds a `UINavigationItem` from them, and the only children
 * that mean anything are `native-header-item`s. `findHeaderConfig` in `RNSScreen.mm` scans the
 * screen's direct `reactSubviews` without recursing, which is why a page's host element is the
 * screen itself (ADR 0004). It can still be written anywhere in the page, inside a `safe-area-view`
 * or a layout component: `registerScreenComponents` has the engine commit it as a direct child of
 * the screen, just after the part of the page it was written in (`registerHoist`). Keep the page's
 * scroll view ahead of it. UIKit then finds that scroll view and collapses a large title into the
 * inline title as the content scrolls.
 *
 * A header owns the top inset. A page that has one should not also wrap itself in a
 * `safe-area-view`, or the content clears the notch twice.
 *
 * **A presented screen has no header.** `RNSScreenStack.mm` presents a modal or a sheet with
 * `presentViewController:`, outside the stack's `UINavigationController`, so there is no
 * navigation bar for this to configure and nothing adjusting the screen's insets either. A page
 * opened with `present()` owns its own chrome: its title, its way out, and its `safe-area-view`.
 * react-navigation has the same shape, which is why a modal there needs a stack nested inside it
 * before it has a header.
 *
 * Props are the `RNSScreenStackHeaderConfig` codegen spec. `headerLeftBarButtonItems` and
 * `headerRightBarButtonItems` are deliberately absent: native bar button items are data rather
 * than views, and they are a later opt-in rather than the primary API.
 */
import { Component, computed, input } from '@angular/core';
import { ElementRef, inject } from '@angular/core';
import { ColorScheme, OS_VERSION } from '@ng-native/device';
import { NATIVE_HEADER_DEFAULTS } from './native-bar-defaults.ts';
import { NATIVE_HEADER_PALETTE } from './native-header-palette.ts';
import type { EngineNode } from '@ng-native/fabric';
import { ownHost } from './own-host.ts';
import { nativePlatform } from '@ng-native/fabric';
import { optionalBoolean, optionalNumber } from './transforms.ts';

/** Where the back button's title comes from, on iOS 14+. */
export type BackButtonDisplayMode = 'minimal' | 'default' | 'generic';

/** Direction the bar lays out in, for right-to-left languages. */
export type HeaderDirection = 'ltr' | 'rtl';

/** How the bar blurs what scrolls under it. `none` paints `backgroundColor` instead. */
export type BlurEffect =
  | 'none'
  | 'extraLight'
  | 'light'
  | 'dark'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark';

/** Overrides the bar's light/dark appearance independently of the app's. */
export type HeaderInterfaceStyle = 'unspecified' | 'light' | 'dark';

@Component({
  selector: 'native-header',
  template: '<ng-content />',
  host: {
    '[title]': 'title()',
    '[titleColor]': 'resolvedTitleColor()',
    '[titleFontFamily]': 'titleFontFamily() ?? defaults().titleFontFamily',
    '[titleFontSize]': 'titleFontSize() ?? defaults().titleFontSize',
    '[titleFontWeight]': 'titleFontWeight() ?? defaults().titleFontWeight',
    '[backgroundColor]': 'resolvedBackgroundColor()',
    '[color]': 'resolvedColor()',
    '[blurEffect]': 'blurEffect() ?? defaults().blurEffect',
    '[hidden]': 'hidden()',
    '[hideShadow]': 'hideShadow() ?? defaults().hideShadow ?? isLiquidGlass()',
    '[translucent]':
      'translucent() ?? defaults().translucent ?? iosLargeTitle() ?? isLiquidGlass()',
    '[direction]': 'direction()',
    '[topInsetEnabled]': 'topInsetEnabled()',
    '[userInterfaceStyle]': 'userInterfaceStyle() ?? defaults().userInterfaceStyle',
    '[largeTitle]': 'largeTitle()',
    '[largeTitleColor]': 'largeTitleColor() ?? defaults().largeTitleColor',
    '[largeTitleBackgroundColor]': 'resolvedLargeTitleBackgroundColor()',
    '[largeTitleFontFamily]': 'largeTitleFontFamily() ?? defaults().largeTitleFontFamily',
    '[largeTitleFontSize]': 'largeTitleFontSize() ?? defaults().largeTitleFontSize',
    '[largeTitleFontWeight]': 'largeTitleFontWeight() ?? defaults().largeTitleFontWeight',
    '[largeTitleHideShadow]':
      'largeTitleHideShadow() ?? defaults().largeTitleHideShadow ?? iosLargeTitle()',
    '[backTitle]': 'backTitle()',
    '[backTitleFontFamily]': 'backTitleFontFamily() ?? defaults().backTitleFontFamily',
    '[backTitleFontSize]': 'backTitleFontSize() ?? defaults().backTitleFontSize',
    '[backTitleVisible]': 'backTitleVisible()',
    '[backButtonDisplayMode]': 'backButtonDisplayMode() ?? defaults().backButtonDisplayMode',
    '[backButtonInCustomView]': 'backButtonInCustomView()',
    '[disableBackButtonMenu]': 'disableBackButtonMenu()',
    '[hideBackButton]': 'hideBackButton()',
    '[consumeTopInset]': 'consumeTopInset()',
    '[consumeLeftInset]': 'consumeLeftInset()',
    '[consumeRightInset]': 'consumeRightInset()',
    '[consumeBottomInset]': 'consumeBottomInset()',
  },
})
export class NativeHeader {
  private readonly scheme = inject(ColorScheme);
  private readonly palette = inject(NATIVE_HEADER_PALETTE);
  /** The app's `withHeaderDefaults`, for whatever this header does not bind itself. */
  protected readonly defaults = inject(NATIVE_HEADER_DEFAULTS);

  constructor() {
    ownHost(inject(ElementRef).nativeElement as EngineNode, this.constructor);
  }

  /**
   * The palette for the scheme the app is wearing, for whichever colours were not bound.
   *
   * A header prop cannot read the cascade, so left alone each platform chooses: iOS follows the
   * system appearance and looks about right, Android takes the app theme's `colorPrimary` and is
   * the framework blue on every screen. These fill the gap without overriding anything a call site
   * or `withHeaderDefaults` did say. See `native-header-palette.ts` for retuning them.
   */
  private readonly colours = computed(() => this.palette[this.scheme.current()]);

  /** iOS 26 and later, where the system's own bar is clear and floats over the content. */
  private readonly glass = nativePlatform() === 'ios' && (inject(OS_VERSION) ?? 0) >= 26;

  /**
   * Whether the bar is iOS 26's Liquid Glass one, which `liquidGlass` asks for here or through
   * `withHeaderDefaults`: clear, over the content, with no line under it, where the system blurs
   * what scrolls beneath and floats the buttons. Only on iOS 26 and later, and only while nothing
   * gave the bar a background of its own.
   */
  protected readonly isLiquidGlass = computed(() =>
    this.glass &&
    (this.liquidGlass() ?? this.defaults().liquidGlass) &&
    this.backgroundColor() === undefined &&
    this.defaults().backgroundColor === undefined
      ? true
      : undefined,
  );

  protected readonly resolvedBackgroundColor = computed(
    () =>
      this.backgroundColor() ??
      this.defaults().backgroundColor ??
      (this.isLiquidGlass() ? 'transparent' : this.colours().background),
  );
  protected readonly resolvedColor = computed(
    () => this.color() ?? this.defaults().color ?? this.colours().foreground,
  );
  protected readonly resolvedTitleColor = computed(
    () => this.titleColor() ?? this.defaults().titleColor ?? this.colours().foreground,
  );

  /**
   * A large title on iOS, drawn as UIKit draws one unless the call site says otherwise: over the
   * content with the bar clear and unlined at the top, so the page's scroll view (with
   * `contentInsetAdjustmentBehavior="automatic"`) collapses it into the bar as it scrolls. Since
   * iOS 26 the large title sits in the scroll view, above its content, where a bar with a
   * background paints over it; and over an opaque bar the inline title never fades in.
   */
  protected readonly iosLargeTitle = computed(() =>
    this.largeTitle() && nativePlatform() === 'ios' ? true : undefined,
  );
  protected readonly resolvedLargeTitleBackgroundColor = computed(
    () =>
      this.largeTitleBackgroundColor() ??
      this.defaults().largeTitleBackgroundColor ??
      (this.iosLargeTitle() ? 'transparent' : undefined),
  );

  // --- title ---------------------------------------------------------------------------

  /** The bar's title. Absent leaves whatever the platform would show, which is nothing. */
  readonly title = input<string>();
  /** Title colour. */
  readonly titleColor = input<string | number>();
  readonly titleFontFamily = input<string>();
  readonly titleFontSize = input(undefined, { transform: optionalNumber });
  /** A CSS font weight, `'600'` or `'bold'`. */
  readonly titleFontWeight = input<string>();

  // --- the bar itself ------------------------------------------------------------------

  /**
   * On iOS 26 and later, the Liquid Glass navigation bar for this header, where it has no
   * background of its own: clear and unlined, with the content scrolling under it. `false` keeps
   * the neutral bar on a page of an app whose `withHeaderDefaults` asks for the glass one. The
   * bar is over the page, so its scroll view takes `contentInsetAdjustmentBehavior="automatic"`.
   */
  readonly liquidGlass = input(undefined, { transform: optionalBoolean });
  /** The bar's background. Ignored unless `blurEffect` is `none`. */
  readonly backgroundColor = input<string | number>();
  /** Tint colour: the back chevron, and any header item that does not set its own. */
  readonly color = input<string | number>();
  /** iOS blur material behind the bar. */
  readonly blurEffect = input<BlurEffect>();
  /** Hide the bar entirely, keeping the screen's gestures and safe areas. */
  readonly hidden = input(undefined, { transform: optionalBoolean });
  /** Drop the hairline under the bar. */
  readonly hideShadow = input(undefined, { transform: optionalBoolean });
  /** Let content scroll under the bar rather than starting below it. */
  readonly translucent = input(undefined, { transform: optionalBoolean });
  /** Lay the bar out right to left. */
  readonly direction = input<HeaderDirection>();
  /** Android: add the status bar inset to the bar's height. */
  readonly topInsetEnabled = input(undefined, { transform: optionalBoolean });
  /** Force the bar light or dark regardless of the app's appearance. */
  readonly userInterfaceStyle = input<HeaderInterfaceStyle>();

  // --- large title (iOS) ---------------------------------------------------------------

  /** iOS large title, which collapses into the bar as content scrolls. */
  readonly largeTitle = input(undefined, { transform: optionalBoolean });
  readonly largeTitleColor = input<string | number>();
  readonly largeTitleBackgroundColor = input<string | number>();
  readonly largeTitleFontFamily = input<string>();
  readonly largeTitleFontSize = input(undefined, { transform: optionalNumber });
  readonly largeTitleFontWeight = input<string>();
  readonly largeTitleHideShadow = input(undefined, { transform: optionalBoolean });

  // --- the back button -----------------------------------------------------------------

  /**
   * What *this* screen's back button says. `RNSScreenStackHeaderConfig.mm` writes it onto the
   * previous screen's navigation item, falling back to that screen's title, which is why an
   * unset back title reads as the title of the screen you came from.
   */
  readonly backTitle = input<string>();
  readonly backTitleFontFamily = input<string>();
  readonly backTitleFontSize = input(undefined, { transform: optionalNumber });
  /** Show the back button's title at all. Native defaults this to true. */
  readonly backTitleVisible = input(undefined, { transform: optionalBoolean });
  /** iOS 14+: how aggressively the back title is shortened when space is tight. */
  readonly backButtonDisplayMode = input<BackButtonDisplayMode>();
  /** Put the back button in the custom view slot, so a `back` header item can replace it. */
  readonly backButtonInCustomView = input(undefined, { transform: optionalBoolean });
  /** Drop the long-press menu of the screens below. */
  readonly disableBackButtonMenu = input(undefined, { transform: optionalBoolean });
  /** Hide the back button without disabling the swipe-back gesture. */
  readonly hideBackButton = input(undefined, { transform: optionalBoolean });

  // --- insets (experimental in react-native-screens) -------------------------------------

  /**
   * Android: whether the bar takes the status bar's height as padding, so its title sits below
   * it rather than under it.
   *
   * Defaulted per platform because getting it wrong is invisible in a screenshot until you look
   * for it: react-native-screens leaves it false, Android 15 draws every app edge to edge, and
   * the result is a title behind the clock. iOS has a navigation controller doing this itself.
   */
  readonly consumeTopInset = input(nativePlatform() === 'android', {
    transform: optionalBoolean,
  });
  readonly consumeLeftInset = input(undefined, { transform: optionalBoolean });
  readonly consumeRightInset = input(undefined, { transform: optionalBoolean });
  readonly consumeBottomInset = input(undefined, { transform: optionalBoolean });
}
