/**
 * Anything Angular can render, placed in one of the navigation bar's slots.
 *
 * Commits as `RNSScreenStackHeaderSubview`, whose `type` picks the slot. A `right` item is the
 * usual "Done" or "Edit" button; `back` replaces the chevron, which needs
 * `backButtonInCustomView` on the header; `searchBar` expects a search bar rather than
 * arbitrary content.
 *
 * Press handling is the responder system, so a `pressable` inside one works like anywhere else.
 *
 * An item at the `left` or the `right` with nothing written in it and a `systemImageName` or a
 * `title` is a native bar button instead, a `UIBarButtonItem` as `native-toolbar-item`s are:
 *
 * ```html
 * <native-header-item type="left" systemImageName="xmark" accessibilityLabel="Close" (press)="close()" />
 * <native-header-item type="right" title="Save" barButtonItemStyle="prominent" (press)="save()" />
 * ```
 *
 * react-native-screens takes one as data on the header rather than as a view, so the element
 * commits nothing and the header commits it in `headerLeftBarButtonItems` or
 * `headerRightBarButtonItems`, in its place among the side's items as written. iOS only: Android's
 * header ignores those props, and draws nothing for the item.
 */
import {
  type AfterContentInit,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { type Engine, type EngineNode, HostEngine, nativePlatform } from '@ng-native/fabric';
import { HeaderBarButtons, type BarButtonConfig } from './header-bar-buttons.ts';
import { ownHost } from './own-host.ts';
import { optionalBoolean } from './transforms.ts';

/**
 * The bar slots. `title` and `center` are the same place: iOS draws both as the title view, and
 * `title` is committed as `center`, the only spelling Android's header knows.
 */
export type HeaderItemType = 'back' | 'left' | 'center' | 'title' | 'right' | 'searchBar';

/**
 * A title item's least size on iOS, under any the app gives it. react-native-screens makes the
 * item the bar's title view at its Yoga size, and UIKit lays out no title view of 0 by 0, so a
 * `ui-host` sized to its SwiftUI content, which has no size until it is laid out, stayed 0 by 0.
 */
const TITLE_LEAST = { minWidth: 1, minHeight: 1 } as const;

/** The id native hands back with a tap. Any text will do, as long as no two items share it. */
let created = 0;

declare const ngDevMode: unknown;

/** Whether Android has been told it draws no bar buttons, which it says once. */
let warnedAndroid = false;

@Component({
  selector: 'native-header-item',
  template: '<ng-content />',
  host: {
    '[type]': 'slot()',
    '[hidesSharedBackground]': 'hidesSharedBackground()',
    // A bar button is the header's data, not a view: committed, it would be an empty custom view.
    '[style.display]': 'isBarButton() || hidden() ? "none" : undefined',
    // An input, so it reaches an item's view only through this. A bar button commits no view.
    '[accessibilityLabel]': 'accessibilityLabel()',
  },
})
export class NativeHeaderItem implements AfterContentInit {
  private readonly node = inject(ElementRef).nativeElement as EngineNode;
  private readonly engine = (this.node.engine ?? inject(HostEngine)) as Partial<Engine>;

  constructor() {
    const node = this.node;
    ownHost(node, this.constructor);
    const engine = this.engine;
    if (nativePlatform() === 'ios') {
      effect(() => {
        engine.setDefaultStyle?.(node, this.slot() === 'center' ? TITLE_LEAST : undefined);
      });
    }
    const bar = inject(HeaderBarButtons, { optional: true });
    if (bar) {
      inject(DestroyRef).onDestroy(
        bar.add({
          node,
          side: this.side,
          hidden: computed(() => this.hidden() === true),
          button: this.button,
          press: () => this.press.emit(),
        }),
      );
    }
    effect(() => {
      if (this.isBarButton()) warnIfAndroid();
    });
  }

  ngAfterContentInit(): void {
    this.noteContent();
  }

  /** Which slot to sit in. Native defaults to `left`. */
  readonly type = input<HeaderItemType>();

  /**
   * What reaches native. react-native-screens' spec lists `title`, and iOS takes it, but Android's
   * `ScreenStackHeaderSubviewManager` throws `Unknown type title` while mounting the item, which
   * takes the screen down with it: a page that worked on iOS crashed on Android as it opened.
   */
  protected readonly slot = computed(() => {
    const type = this.type();
    return type === 'title' ? 'center' : type;
  });
  /** Opt out of the bar's shared background behind this item. */
  readonly hidesSharedBackground = input(undefined, { transform: optionalBoolean });

  // --- as a bar button -------------------------------------------------------------------

  readonly title = input<string>();
  /** An SF Symbol name. */
  readonly systemImageName = input<string>();
  readonly tintColor = input<string>();
  /** `prominent` is the filled style iOS 26 gives a screen's main action. */
  readonly barButtonItemStyle = input<'plain' | 'prominent'>();
  /** iOS 26: whether this item shares its glass with the items beside it, which it does unset. */
  readonly sharesBackground = input(undefined, { transform: optionalBoolean });
  /** Leave the item out of the bar. */
  readonly hidden = input(undefined, { transform: optionalBoolean });
  readonly disabled = input(undefined, { transform: optionalBoolean });
  /** What a screen reader says for a button with a symbol and no title, or for an item's view. */
  readonly accessibilityLabel = input<string>();

  /** The bar button was tapped. Content written in the item handles its own presses. */
  readonly press = output<void>();

  /** Whether anything is written in the element, which keeps it a view. */
  private readonly hasContent = signal(false);

  private readonly buttonId = `native-header-item-${created++}`;

  /** The side of the bar the item is in, which native defaults to the left. */
  private readonly side = computed(() => {
    const slot = this.slot();
    return slot === undefined || slot === 'left' ? 'left' : slot === 'right' ? 'right' : null;
  });

  protected readonly isBarButton = computed(
    () =>
      !this.hasContent() &&
      this.side() !== null &&
      (this.systemImageName() !== undefined || this.title() !== undefined),
  );

  /** The item as `RNSBarButtonItem.mm` reads it, with nothing unset in it. */
  private readonly button = computed((): BarButtonConfig | null => {
    if (!this.isBarButton()) return null;
    const tint = this.tintColor();
    const config: Record<string, unknown> = {
      buttonId: this.buttonId,
      title: this.title(),
      sfSymbolName: this.systemImageName(),
      variant: this.barButtonItemStyle(),
      tintColor: tint === undefined ? undefined : (this.engine.color?.(tint) ?? tint),
      disabled: this.disabled(),
      hidesSharedBackground: this.hidesSharedBackground(),
      sharesBackground: this.sharesBackground(),
      accessibilityLabel: this.accessibilityLabel(),
    };
    for (const key of Object.keys(config)) if (config[key] === undefined) delete config[key];
    return config;
  });

  /**
   * Content is projected by the time this runs. Control flow written in the element counts too,
   * as the anchor it leaves, so an item whose content is only behind an `@if` stays a view.
   */
  private noteContent(): void {
    this.hasContent.set(this.node.childList.length > 0);
  }
}

/** Says once, in development, that Android's header has no bar buttons to draw. */
function warnIfAndroid(): void {
  if (typeof ngDevMode !== 'undefined' && !ngDevMode) return;
  if (nativePlatform() !== 'android' || warnedAndroid) return;
  warnedAndroid = true;
  console.warn(
    '[angular-native] A <native-header-item> with a systemImageName or a title and no content is ' +
      'a native bar button, which only iOS draws. Write the button inside the item, as a ' +
      '<pressable>, for one Android shows too.',
  );
}
