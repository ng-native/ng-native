/**
 * A screen's bottom toolbar, iOS only: the bar a navigation controller floats over the content
 * and the tab bar, where Mail has its filter, its search field and its compose button.
 *
 * ```html
 * <native-toolbar>
 *   <native-toolbar-item systemImageName="line.3.horizontal.decrease" (press)="filter()" />
 *   <native-toolbar-item type="searchBar" />
 *   <native-toolbar-item systemImageName="square.and.pencil" (press)="compose()" />
 * </native-toolbar>
 * ```
 *
 * react-native-screens has no toolbar, so these commit as Expo Router's native toolbar views,
 * `ExpoRouterToolbarModule`'s: the host finds the react-native-screens screen it is inside, gives
 * its view controller the items and shows the toolbar. An app that uses them installs
 * `expo-router` for that native half; none of its JavaScript is imported. Expo Go has it built in.
 *
 * It needs iOS 18. Written anywhere in a screen's page, it is that screen's toolbar, and it goes
 * when the element does. A presented screen has no navigation controller, so no toolbar either.
 */
import { Component, DestroyRef, ElementRef, inject, input, output } from '@angular/core';
import { type EngineNode, HostEngine } from '@ng-native/fabric';
import { ownHost } from './own-host.ts';
import { optionalBoolean, optionalNumber } from './transforms.ts';

@Component({
  selector: 'native-toolbar',
  template: '<ng-content />',
  // Out of the screen's layout, as Expo Router's own wrapper styles it: the items are bar button
  // items, which the host hands to the screen rather than draws.
  host: {
    '[style.position]': '"absolute"',
    '[style.top]': '0',
    '[style.left]': '0',
    '[style.width]': '1',
    '[style.height]': '1',
  },
})
export class NativeToolbar {
  constructor() {
    ownHost(inject(ElementRef).nativeElement as EngineNode, this.constructor);
  }
}

/**
 * What a toolbar item is. Unset, a button. `fluidSpacer` takes all the room there is, which
 * pushes what follows to the trailing edge, and `fixedSpacer` is a gap of `width` points.
 * `searchBar` is where the screen's `native-search-bar` goes when iOS 26 integrates it into the
 * toolbar, so buttons can sit either side of it.
 */
export type ToolbarItemType = 'normal' | 'fixedSpacer' | 'fluidSpacer' | 'searchBar';

/** The identifier native keys each item by. Any text will do, as long as no two items share it. */
let created = 0;

@Component({
  selector: 'native-toolbar-item',
  template: '',
  host: {
    '[identifier]': 'identifier',
    '[type]': 'type()',
    '[title]': 'title()',
    '[systemImageName]': 'systemImageName()',
    '[tintColor]': 'tintColor()',
    '[barButtonItemStyle]': 'barButtonItemStyle()',
    '[hidesSharedBackground]': 'hidesSharedBackground()',
    '[sharesBackground]': 'sharesBackground()',
    '[width]': 'width()',
    '[hidden]': 'hidden()',
    '[disabled]': 'disabled()',
    '[accessibilityLabel]': 'accessibilityLabel()',
  },
})
export class NativeToolbarItem {
  readonly type = input<ToolbarItemType>();
  readonly title = input<string>();
  /** An SF Symbol name. */
  readonly systemImageName = input<string>();
  readonly tintColor = input<string>();
  /** `prominent` is the filled style iOS 26 gives a screen's main action. */
  readonly barButtonItemStyle = input<'plain' | 'prominent'>();
  /** iOS 26: draw this item with no glass behind it. */
  readonly hidesSharedBackground = input(undefined, { transform: optionalBoolean });
  /** iOS 26: whether this item shares its glass with the items beside it, which it does unset. */
  readonly sharesBackground = input(undefined, { transform: optionalBoolean });
  /** The width of a `fixedSpacer`, in points. */
  readonly width = input(undefined, { transform: optionalNumber });
  /** Leave the item out of the toolbar while keeping its place among the others. */
  readonly hidden = input(undefined, { transform: optionalBoolean });
  readonly disabled = input(undefined, { transform: optionalBoolean });
  /** What a screen reader says for a button with a symbol and no title. */
  readonly accessibilityLabel = input<string>();

  /** The button was tapped. */
  readonly press = output<void>();

  protected readonly identifier = `native-toolbar-item-${created++}`;

  constructor() {
    const node = ownHost(inject(ElementRef).nativeElement as EngineNode, NativeToolbarItem);
    const engine = node.host ?? inject(HostEngine);
    inject(DestroyRef).onDestroy(
      engine.setEventListener(node, 'topSelected', () => this.press.emit()),
    );
  }
}
