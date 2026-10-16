/**
 * Anything Angular can render, placed in one of the navigation bar's slots.
 *
 * Commits as `RNSScreenStackHeaderSubview`, whose `type` picks the slot. A `right` item is the
 * usual "Done" or "Edit" button; `back` replaces the chevron, which needs
 * `backButtonInCustomView` on the header; `searchBar` expects a search bar rather than
 * arbitrary content.
 *
 * Press handling is the responder system, so a `pressable` inside one works like anywhere else.
 * Native bar button items would look truer to the platform and bring menus and system symbols
 * with them, but they are data rather than views; they are a later opt-in.
 */
import { Component, ElementRef, computed, effect, inject, input } from '@angular/core';
import { type Engine, type EngineNode, HostEngine, nativePlatform } from '@ng-native/fabric';
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

@Component({
  selector: 'native-header-item',
  template: '<ng-content />',
  host: {
    '[type]': 'slot()',
    '[hidesSharedBackground]': 'hidesSharedBackground()',
  },
})
export class NativeHeaderItem {
  constructor() {
    const node = inject(ElementRef).nativeElement as EngineNode;
    ownHost(node, this.constructor);
    const engine = (node.host ?? inject(HostEngine)) as Partial<Engine>;
    if (nativePlatform() === 'ios') {
      effect(() => {
        engine.setDefaultStyle?.(node, this.slot() === 'center' ? TITLE_LEAST : undefined);
      });
    }
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
}
