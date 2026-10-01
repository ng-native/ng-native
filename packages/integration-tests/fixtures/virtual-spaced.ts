import { Component, signal, viewChild } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import {
  VirtualList,
  VirtualListRow,
  type VirtualListPadding,
} from '../../components/src/virtual-list.ts';

/** Fixed-height rows with padding around them and a gap between them. */
@Component({
  selector: 'x-virtual-spaced',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [itemHeight]="40"
      [overscan]="2"
      [contentPadding]="padding()"
      [rowGap]="gap()"
      [horizontal]="horizontal()"
      [stickyIndices]="sticky()"
      [itemVisiblePercentThreshold]="50"
      (viewableItemsChanged)="viewable.set($event.viewable.map(indexOf))"
      (endReached)="ends.push($event.distanceFromEnd)"
      [style]="fill"
    >
      @for (row of list.window(); track row.index) {
        <view [style]="row.style" [nativeID]="'row' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualSpaced {
  readonly list = viewChild.required(VirtualList);
  readonly rows = signal(Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i}` })));
  readonly fill = { flex: 1 };
  readonly padding = signal<VirtualListPadding>({ top: 20, right: 12, bottom: 30, left: 8 });
  readonly gap = signal(10);
  readonly horizontal = signal(false);
  readonly sticky = signal<readonly number[]>([]);
  readonly viewable = signal<readonly number[]>([]);
  readonly ends: number[] = [];
  readonly indexOf = (row: { index: number }) => row.index;
}

/** Rows that size themselves, with the same padding and gap. */
@Component({
  selector: 'x-virtual-spaced-measured',
  imports: [VirtualList, VirtualListRow, Text, View],
  template: `
    <virtual-list
      #list
      [items]="rows()"
      [estimatedItemHeight]="50"
      [overscan]="2"
      [contentPadding]="padding()"
      [rowGap]="gap()"
      [stickyIndices]="sticky()"
      [style]="fill"
    >
      @for (row of list.window(); track row.key) {
        <view [virtualListRow]="row" [nativeID]="'row' + row.index"
          ><text>{{ row.item.label }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualSpacedMeasured {
  readonly list = viewChild.required(VirtualList);
  readonly rows = signal(Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i}` })));
  readonly fill = { flex: 1 };
  readonly padding = signal<VirtualListPadding>({ top: 20, right: 12, bottom: 30, left: 8 });
  readonly gap = signal(10);
  readonly sticky = signal<readonly number[]>([]);
}
