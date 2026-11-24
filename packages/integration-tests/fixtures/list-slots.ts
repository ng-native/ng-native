import { Component, signal } from '@angular/core';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList, VirtualListSeparator } from '../../components/src/virtual-list.ts';

/** A windowed list with a separator template and a header that can be made sticky. */
@Component({
  selector: 'x-separated',
  imports: [VirtualList, VirtualListSeparator, Text, View],
  template: `
    <virtual-list
      #list
      [items]="items()"
      [itemHeight]="40"
      [overscan]="1"
      [stickyHeader]="stickyHeader()"
      [stickyIndices]="sticky()"
      [inverted]="inverted()"
      [horizontal]="horizontal()"
      [style]="fill"
    >
      <text listHeader>Header</text>
      @for (row of list.window(); track row.index) {
        <view [style]="row.style" [nativeID]="'row' + row.index"
          ><text>{{ row.item }}</text></view
        >
      }
      <ng-template virtualListSeparator let-leading let-trailing="trailingItem">
        <view nativeID="separator"
          ><text>{{ leading }}|{{ trailing }}</text></view
        >
      </ng-template>
    </virtual-list>
  `,
})
export class Separated {
  readonly items = signal(['a', 'b', 'c', 'd', 'e']);
  readonly stickyHeader = signal(false);
  readonly sticky = signal<readonly number[]>([]);
  readonly inverted = signal(false);
  readonly horizontal = signal(false);
  readonly fill = { flex: 1 };
}

/** A scroll view whose first and third children stick. */
@Component({
  selector: 'x-sticky-scroll',
  imports: [ScrollView, Text, View],
  template: `
    <scroll-view [stickyHeaderIndices]="sticky()" [horizontal]="horizontal()">
      <view nativeID="first"><text>first</text></view>
      <view nativeID="body-1"><text>body</text></view>
      @for (n of more; track n) {
        <view [nativeID]="'more-' + n"
          ><text>{{ n }}</text></view
        >
      }
    </scroll-view>
  `,
})
export class StickyScroll {
  readonly sticky = signal<readonly number[]>([0, 2]);
  readonly horizontal = signal(false);
  readonly more = [1, 2, 3];
}
