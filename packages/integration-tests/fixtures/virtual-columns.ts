import { Component, signal, viewChild } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import {
  VirtualList,
  VirtualListRow,
  VirtualListSeparator,
  type VirtualItemHeight,
  type VirtualListPadding,
} from '../../components/src/virtual-list.ts';
import { VirtualListNumColumns } from '../../components/src/virtual-list-num-columns.ts';

interface Tile {
  readonly id: number;
  readonly label: string;
}

/** Items side by side, a line of them at a time, with padding, gaps and sticky lines. */
@Component({
  selector: 'x-virtual-columns',
  imports: [VirtualList, VirtualListNumColumns, Text, View],
  template: `
    <virtual-list
      #list
      [items]="tiles()"
      [itemHeight]="height()"
      [overscan]="1"
      [contentPadding]="padding()"
      [rowGap]="rowGap()"
      [stickyIndices]="sticky()"
      [horizontal]="horizontal()"
      [itemVisiblePercentThreshold]="50"
      [windowSize]="windowSize()"
      [contentInset]="inset()"
      [virtualListNumColumns]="columns()"
      [virtualListColumnGap]="columnGap()"
      (viewableItemsChanged)="viewable.set($event.viewable.map(indexOf))"
      (endReached)="ends.push($event.distanceFromEnd)"
      [style]="fill"
    >
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style" [nativeID]="'tile' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualColumns {
  readonly list = viewChild.required(VirtualList);
  readonly tiles = signal<readonly Tile[]>(tiles(100));
  readonly fill = { flex: 1 };
  readonly height = signal<VirtualItemHeight<Tile>>(40);
  readonly padding = signal<VirtualListPadding>(0);
  readonly rowGap = signal(0);
  readonly columns = signal(3);
  readonly columnGap = signal(0);
  readonly sticky = signal<readonly number[]>([]);
  readonly horizontal = signal(false);
  readonly windowSize = signal(5);
  readonly inset = signal<{ top?: number; bottom?: number } | undefined>(undefined);
  readonly viewable = signal<readonly number[]>([]);
  readonly ends: number[] = [];
  readonly indexOf = (row: { index: number }) => row.index;
}

/** The same, with rows that size themselves, which columns do not take. */
@Component({
  selector: 'x-virtual-columns-measured',
  imports: [VirtualList, VirtualListRow, VirtualListNumColumns, Text, View],
  template: `
    <virtual-list
      #list
      [items]="tiles"
      [estimatedItemHeight]="40"
      [virtualListNumColumns]="3"
      [style]="fill"
    >
      @for (row of list.window(); track row.key) {
        <view [virtualListRow]="row" [nativeID]="'tile' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualColumnsMeasured {
  readonly tiles = tiles(30);
  readonly fill = { flex: 1 };
}

function tiles(count: number): Tile[] {
  return Array.from({ length: count }, (_, id) => ({ id, label: `tile ${id}` }));
}

/** Six items in three columns, with a separator between rows. */
@Component({
  selector: 'x-virtual-columns-separated',
  imports: [VirtualList, VirtualListNumColumns, VirtualListSeparator, Text, View],
  template: `
    <virtual-list
      #list
      [items]="tiles"
      [itemHeight]="40"
      [virtualListNumColumns]="3"
      [style]="fill"
    >
      <ng-template virtualListSeparator let-index="leadingIndex" let-trailing="trailingItem"
        ><view [nativeID]="'sep' + index + '-' + trailing.id"></view
      ></ng-template>
      @for (row of list.window(); track row.slot) {
        <view [style]="row.style"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualColumnsSeparated {
  readonly tiles = tiles(6);
  readonly fill = { flex: 1 };
}
