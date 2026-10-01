import { Component, signal } from '@angular/core';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

/** A scroll view with content, which a test lays out at whatever height it likes. */
@Component({
  selector: 'x-zero-scroll',
  imports: [ScrollView, Text],
  template: `
    <scroll-view class="feed">
      <text>a row</text>
    </scroll-view>
  `,
})
export class ZeroScroll {}

/** A virtual list with rows, or none. */
@Component({
  selector: 'x-zero-list',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list #list class="feed" [items]="rows()" [itemHeight]="40">
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class ZeroList {
  rows = signal<string[]>(['one', 'two']);
}

/** The same list with no rows. */
@Component({
  selector: 'x-zero-empty-list',
  imports: [VirtualList],
  template: `<virtual-list class="feed" [items]="[]" [itemHeight]="40" />`,
})
export class ZeroEmptyList {}
