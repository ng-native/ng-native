import { Component, Directive, input, signal, viewChild } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList, VirtualListRow } from '../../components/src/virtual-list.ts';
import { NgIcon } from '../../icons/src/ng-icon.ts';

@Component({
  selector: 'x-virtual',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list #list [items]="rows()" [itemHeight]="40" [overscan]="2" [style]="fill">
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class Virtual {
  rows = signal(Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` })));
  fill = { flex: 1 };
}

/** The same list along x, upside down, with pinned rows and a viewability listener. */
@Component({
  selector: 'x-virtual-options',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [itemHeight]="40"
      [overscan]="2"
      [horizontal]="horizontal()"
      [inverted]="inverted()"
      [stickyIndices]="sticky()"
      [itemVisiblePercentThreshold]="50"
      (viewableItemsChanged)="onViewable($event)"
      [style]="fill"
    >
      <text listHeader>list header</text>
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
      <text listFooter>list footer</text>
    </virtual-list>
  `,
})
export class VirtualOptions {
  readonly list = viewChild.required(VirtualList);
  rows = signal(Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` })));
  fill = { flex: 1 };
  horizontal = signal(false);
  inverted = signal(false);
  sticky = signal<readonly number[]>([]);
  viewable = signal<readonly number[]>([]);
  changes = 0;

  onViewable(event: {
    entered: readonly number[];
    left: readonly number[];
    viewable: readonly { index: number }[];
  }): void {
    this.changes++;
    this.viewable.set(event.viewable.map((row) => row.index));
  }
}

/**
 * Rows of two different heights, alternating.
 *
 * The uniform fixtures cannot see a window that is measured from the wrong row: with every row
 * the same height, the rows added below by the overscan are worth exactly the rows the anchor
 * wasted above, and the arithmetic cancels. Mixed heights is where it shows.
 */
@Component({
  selector: 'x-virtual-mixed',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list #list [items]="rows()" [itemHeight]="heightOf" [overscan]="2" [style]="fill">
      @for (row of list.window(); track row.index) {
        <view [style]="row.style" [nativeID]="'row' + row.index"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualMixed {
  readonly fill = { flex: 1 };
  readonly rows = signal(Array.from({ length: 200 }, (_, i) => i));
  /**
   * A block of tall rows, then short ones.
   *
   * Alternating heights would not do: the overscan rows above the viewport and the ones added
   * below average out, and the error cancels just as it does with uniform rows. The error only
   * shows where the rows behind you are much taller than the rows ahead.
   */
  readonly heightOf = (_item: number, index: number) => (index < 30 ? 200 : 20);
}

/** The first list, recycling its rows by slot rather than keeping one per index. */
@Component({
  selector: 'x-virtual-recycled',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list #list [items]="rows()" [itemHeight]="40" [overscan]="2" [style]="fill">
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualRecycled {
  readonly list = viewChild.required(VirtualList);
  rows = signal(Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` })));
  fill = { flex: 1 };
}

/** A paged carousel: the scroll view's own props, set on the list. */
@Component({
  selector: 'x-virtual-carousel',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [itemHeight]="300"
      [horizontal]="true"
      [pagingEnabled]="true"
      [showsHorizontalScrollIndicator]="false"
      [decelerationRate]="'fast'"
      [snapToInterval]="300"
      [scrollEventThrottle]="16"
      [bounces]="false"
      [scrollsToTop]="false"
      [contentInsetAdjustmentBehavior]="'never'"
      keyboardDismissMode="on-drag"
      [style]="fill"
    >
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualCarousel {
  rows = signal(Array.from({ length: 20 }, (_, i) => ({ id: i, label: `page ${i}` })));
  fill = { flex: 1 };
}

/** A feed that loads its rows after it is laid out, and pages and filters them. */
@Component({
  selector: 'x-virtual-feed',
  imports: [VirtualList, VirtualListRow, Text, View],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [itemHeight]="40"
      [style]="fill"
      (endReached)="ended = ended + 1"
      (viewableItemsChanged)="viewable = $event.viewable.map(label)"
    >
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualFeed {
  readonly rows = signal<string[]>([]);
  readonly fill = { flex: 1 };
  ended = 0;
  viewable: string[] = [];
  readonly label = (row: { item: string }) => row.item;
}

/** Rows with an icon in each, as an app's catalog has: a parked row's icon is reused (#884). */
@Component({
  selector: 'x-virtual-icons',
  imports: [VirtualList, NgIcon, View],
  template: `
    <virtual-list #list [items]="rows" [itemHeight]="40" [overscan]="2" [style]="fill">
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style"><ng-icon [svg]="icon" color="white" /></view>
      }
    </virtual-list>
  `,
})
export class VirtualIcons {
  rows = Array.from({ length: 200 }, (_, i) => ({ id: i }));
  fill = { flex: 1 };
  icon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
}

/** An icon whose `pointerEvents` a binding sets, and then clears with null. */
@Directive({ selector: '[touches]', host: { '[pointerEvents]': 'touches()' } })
export class Touches {
  readonly touches = input<string | null>(null);
}

@Component({
  selector: 'x-bound-touch-icon',
  imports: [NgIcon, Touches],
  template: `<ng-icon [touches]="touches()" [svg]="icon" />`,
})
export class BoundTouchIcon {
  touches = signal<string | null>('none');
  icon = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
}
