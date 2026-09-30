/**
 * One item in a native tab bar, and the screen behind it.
 *
 * Declared in the tabs outlet's template, the way a `<native-header>` is declared in a page's:
 *
 * ```html
 * <native-tabs-outlet>
 *   <native-tab path="library" title="Library" sfSymbol="books.vertical.fill" />
 *   <native-tab path="inbox" title="Inbox" sfSymbol="tray" [badge]="unread()" />
 * </native-tabs-outlet>
 * ```
 *
 * `path` names the child route this tab selects, the same way a `routerLink` names one, and is
 * what native identifies the tab by. Everything else is an ordinary input, which is the point of
 * declaring tabs here rather than in the route config: a badge is a count that changes, a title
 * may be translated, and a tab may not exist at all until a feature flag says so. Route data
 * cannot bind to any of that.
 *
 * **A bar item is not a view.** `UITabBarItem` is a model object - a title, an image and a badge
 * string - and UIKit has no way to put a view in its place; Android's bottom-navigation item is
 * the same. That is why this takes no content, while `<native-header-item>` does: a navigation
 * bar really does hold subviews. What customisation exists is here as inputs: images instead of
 * symbols, a different icon when selected, and the per-state appearance below.
 *
 * The host element *is* the `RNSTabsScreen`. The outlet keeps the screen mounted and creates
 * each activated route's component on a child view, so destroying a route cannot remove this
 * tab item from the bar.
 */
import { Component, ElementRef, computed, inject, input, type OnInit } from '@angular/core';
import { nativePlatform, type EngineNode, HostEngine } from '@ng-native/fabric';
import { NATIVE_TAB_DEFAULTS } from './native-bar-defaults.ts';
import { ownHost } from './own-host.ts';

/**
 * Where a tab's picture comes from.
 *
 * `template` is the one worth knowing about: the image is drawn as a mask and tinted to the bar's
 * colour, so it follows selection the way a symbol does. `image` renders as authored, which is
 * what a multi-colour logo wants and what a monochrome icon almost never does.
 */
export type TabIcon =
  | { readonly sfSymbol: string }
  /** An image in the iOS asset catalogue, by name. */
  | { readonly xcasset: string }
  /** A `require()`d asset or a `{ uri }`, drawn as authored. */
  | { readonly image: unknown }
  /** The same, drawn as a mask and tinted. */
  | { readonly template: unknown }
  /** Android: a drawable resource name. */
  | { readonly drawable: string };

/** One of Apple's standard items, which brings its own icon and title. */
export type TabSystemItem =
  | 'none'
  | 'bookmarks'
  | 'contacts'
  | 'downloads'
  | 'favorites'
  | 'featured'
  | 'history'
  | 'more'
  | 'mostRecent'
  | 'mostViewed'
  | 'recents'
  | 'search'
  | 'topRated';

export type TabBarBlurEffect =
  | 'none'
  | 'systemDefault'
  | 'extraLight'
  | 'light'
  | 'dark'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial';

/**
 * How an item looks in one state. The names are the native ones, spelled as the codegen spec
 * spells them, so this forwards rather than translates and Apple's own documentation still reads
 * across.
 */
export interface TabStateAppearance {
  tabBarItemTitleFontFamily?: string;
  tabBarItemTitleFontSize?: number;
  tabBarItemTitleFontWeight?: string | number;
  tabBarItemTitleFontStyle?: string;
  tabBarItemTitleFontColor?: string | number;
  tabBarItemTitlePositionAdjustment?: { horizontal?: number; vertical?: number };
  tabBarItemIconColor?: string | number;
  tabBarItemBadgeBackgroundColor?: string | number;
}

/** The four states an item can be in. Anything absent falls back to the platform's own. */
export interface TabItemAppearance {
  normal?: TabStateAppearance;
  selected?: TabStateAppearance;
  focused?: TabStateAppearance;
  disabled?: TabStateAppearance;
}

/**
 * How the bar looks, per layout. `stacked` is the usual icon-over-title item; `inline` and
 * `compactInline` are the side-by-side layouts iPad and a compact height use.
 */
export interface TabAppearance {
  stacked?: TabItemAppearance;
  inline?: TabItemAppearance;
  compactInline?: TabItemAppearance;
  tabBarBackgroundColor?: string | number;
  tabBarShadowColor?: string | number;
  tabBarBlurEffect?: TabBarBlurEffect;
}

/** One icon, as the props native reads it through. */
export interface TabIconProps {
  iconType?: string;
  iconResourceName?: string;
  iconImageSource?: unknown;
  drawableIconResourceName?: string;
  imageIconResource?: unknown;
}

/**
 * An icon and its selected counterpart, as one set of props.
 *
 * Native carries a single `iconType` for both states, so the two have to be the same kind of
 * thing: a template image cannot become a symbol when selected. React Native Screens throws on
 * that pairing and so does this, because the alternative - what happened before this checked - is
 * that native quietly keeps the unselected icon and nothing anywhere says why.
 */
export function tabIconProps(
  icon: TabIconProps,
  selectedIcon: TabIconProps,
): TabIconProps & {
  selectedIconResourceName?: string;
  selectedIconImageSource?: unknown;
  selectedDrawableIconResourceName?: string;
  selectedImageIconResource?: unknown;
} {
  const hasBase = icon.iconType !== undefined || icon.drawableIconResourceName !== undefined;
  const hasSelected =
    selectedIcon.iconType !== undefined || selectedIcon.drawableIconResourceName !== undefined;

  if (hasSelected && !hasBase) {
    throw new Error('[angular-native] <native-tab> has a selectedIcon but no icon to select from');
  }
  if (hasSelected && icon.iconType !== selectedIcon.iconType) {
    throw new Error(
      `[angular-native] <native-tab> icon and selectedIcon must be the same kind: native has ` +
        `one iconType for both, so '${icon.iconType}' and '${selectedIcon.iconType}' cannot pair.`,
    );
  }

  return {
    ...icon,
    selectedIconResourceName: selectedIcon.iconResourceName,
    selectedIconImageSource: selectedIcon.iconImageSource,
    selectedDrawableIconResourceName: selectedIcon.drawableIconResourceName,
    selectedImageIconResource: selectedIcon.imageIconResource,
  };
}

declare const ngDevMode: unknown;

/** The paths already warned about, so a tab bar rebuilt by a navigation says it once. */
const warnedTabs = new Set<string>();

/**
 * Says, once per path and in development only, that a tab has no icon on the platform running it
 * because it names only the other platform's shorthand. A tab written against the iOS simulator
 * with `sfSymbol` shows a title and nothing above it on Android.
 */
function warnIfIconOnOnePlatform(tab: NativeTab): void {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
  if (tab.icon() || tab.systemItem()) return;
  const [own, other, missing, platform] =
    nativePlatform() === 'android'
      ? [tab.drawable(), tab.sfSymbol(), 'drawable', 'Android']
      : nativePlatform() === 'ios'
        ? [tab.sfSymbol(), tab.drawable(), 'sfSymbol', 'iOS']
        : [];
  if (own || !other) return;
  const path = tab.path();
  if (warnedTabs.has(path)) return;
  warnedTabs.add(path);
  console.warn(
    `[angular-native] <native-tab path="${path}"> has no icon on ${platform}: ${platform} reads ` +
      `only ${missing}. Add ${missing}="...", or bind [icon] for a tab meant for one platform.`,
  );
}

@Component({
  selector: 'native-tab',
  template: '',
  host: {
    '[screenKey]': 'path()',
    '[title]': 'title()',
    '[badgeValue]': 'badge()',
    '[tabBarItemAccessibilityLabel]': 'accessibilityLabel()',
    '[systemItem]': 'systemItem()',
    // `isTitleUndefined` is what `TabsScreen.ios.tsx` derives from the title, and it is not a
    // synonym for "no title": with a title set and this left at its default, the item renders as
    // an icon with a gap where the label belongs.
    '[isTitleUndefined]': 'title() === undefined',
    '[iconType]': 'icons().iconType',
    '[iconResourceName]': 'icons().iconResourceName',
    '[iconImageSource]': 'icons().iconImageSource',
    '[selectedIconResourceName]': 'icons().selectedIconResourceName',
    '[selectedIconImageSource]': 'icons().selectedIconImageSource',
    '[drawableIconResourceName]': 'icons().drawableIconResourceName',
    '[imageIconResource]': 'icons().imageIconResource',
    '[selectedDrawableIconResourceName]': 'icons().selectedDrawableIconResourceName',
    '[selectedImageIconResource]': 'icons().selectedImageIconResource',
    '[standardAppearance]': 'standard()',
    '[scrollEdgeAppearance]': 'scrollEdge()',
  },
})
export class NativeTab implements OnInit {
  private readonly engine = inject(HostEngine);
  /** The app's `withTabDefaults`, for an appearance this tab does not bind itself. */
  private readonly defaults = inject(NATIVE_TAB_DEFAULTS);

  /**
   * The `RNSTabsScreen` this tab is. The outlet creates the activated route's component inside
   * it, which is why it is public: a tab is a slot as well as a bar item.
   */
  readonly screen: EngineNode;

  constructor() {
    this.screen = ownHost(inject(ElementRef).nativeElement as EngineNode, this.constructor);
  }

  /**
   * The child route this tab selects, as a path segment: `library` for `/tabs/library`. Native
   * identifies the tab by it too, so it must be unique in the bar.
   */
  readonly path = input.required<string>();

  /** The label under the icon. Absent gives an icon-only item. */
  readonly title = input<string>();

  /** iOS: an SF Symbol name, e.g. `books.vertical.fill`. Shorthand for `[icon]`. */
  readonly sfSymbol = input<string>();

  /** Android: a drawable resource name. Shorthand for `[icon]`. */
  readonly drawable = input<string>();

  /** Anything a symbol name cannot say: an image, a template image, an asset-catalogue name. */
  readonly icon = input<TabIcon>();

  /** Shown while this tab is the selected one. Absent leaves the platform to tint `icon`. */
  readonly selectedIcon = input<TabIcon>();

  /** One of Apple's standard items, which supplies its own icon and title. */
  readonly systemItem = input<TabSystemItem>();

  /** The badge on the item: a count, or a single character for a dot. */
  readonly badge = input<string>();

  /** Announced instead of the title. */
  readonly accessibilityLabel = input<string>();

  /** How the item looks. Colours are processed here, because native never sees the object's keys. */
  readonly standardAppearance = input<TabAppearance>();

  /** The same, for when the scroll view behind the bar is at its edge. */
  readonly scrollEdgeAppearance = input<TabAppearance>();

  ngOnInit(): void {
    warnIfIconOnOnePlatform(this);
  }

  protected readonly standard = computed(() =>
    this.processAppearance(this.standardAppearance() ?? this.defaults().standardAppearance),
  );
  protected readonly scrollEdge = computed(() =>
    this.processAppearance(this.scrollEdgeAppearance() ?? this.defaults().scrollEdgeAppearance),
  );

  protected readonly icons = computed(() =>
    tabIconProps(
      this.iconProps(this.icon() ?? this.shorthand()),
      this.iconProps(this.selectedIcon()),
    ),
  );

  /**
   * `sfSymbol` and `drawable` say the same thing as `icon`, in the form most tabs want. A tab
   * names both to have an icon on both platforms, so the running platform's own comes first:
   * Android reads only a drawable, and iOS only a symbol.
   */
  private shorthand(): TabIcon | undefined {
    const symbol = this.sfSymbol();
    const drawable = this.drawable();
    const icons = [symbol && { sfSymbol: symbol }, drawable && { drawable }];
    if (nativePlatform() === 'android') icons.reverse();
    return icons.find((icon) => icon) || undefined;
  }

  /**
   * One icon, as the four props native reads it through. A `require()`d asset is an id until the
   * host resolves it, which is the same thing an `<image src>` needs and the engine only does for
   * props it knows by name.
   */
  private iconProps(icon: TabIcon | undefined): TabIconProps {
    if (!icon) return {};
    if ('sfSymbol' in icon) return { iconType: 'sfSymbol', iconResourceName: icon.sfSymbol };
    if ('xcasset' in icon) return { iconType: 'xcasset', iconResourceName: icon.xcasset };
    if ('drawable' in icon) return { drawableIconResourceName: icon.drawable };

    const source = this.engine.resolveAsset('image' in icon ? icon.image : icon.template);
    return nativePlatform() === 'android'
      ? { imageIconResource: source }
      : { iconType: 'image' in icon ? 'image' : 'template', iconImageSource: source };
  }

  private processAppearance(appearance: TabAppearance | undefined): object | undefined {
    if (!appearance) return undefined;
    return {
      ...appearance,
      stacked: this.processItem(appearance.stacked),
      inline: this.processItem(appearance.inline),
      compactInline: this.processItem(appearance.compactInline),
      tabBarBackgroundColor: this.engine.color(appearance.tabBarBackgroundColor),
      tabBarShadowColor: this.engine.color(appearance.tabBarShadowColor),
    };
  }

  private processItem(item: TabItemAppearance | undefined): object | undefined {
    if (!item) return undefined;
    return {
      normal: this.processState(item.normal),
      selected: this.processState(item.selected),
      focused: this.processState(item.focused),
      disabled: this.processState(item.disabled),
    };
  }

  private processState(state: TabStateAppearance | undefined): object | undefined {
    if (!state) return undefined;
    return {
      ...state,
      // Native declares the weight as a string, and `600` is the natural way to write one.
      tabBarItemTitleFontWeight:
        state.tabBarItemTitleFontWeight === undefined
          ? undefined
          : String(state.tabBarItemTitleFontWeight),
      tabBarItemTitleFontColor: this.engine.color(state.tabBarItemTitleFontColor),
      tabBarItemIconColor: this.engine.color(state.tabBarItemIconColor),
      tabBarItemBadgeBackgroundColor: this.engine.color(state.tabBarItemBadgeBackgroundColor),
    };
  }
}
