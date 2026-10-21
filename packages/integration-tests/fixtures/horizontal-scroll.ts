import { Component, signal, viewChild } from '@angular/core';
import { Markdown } from '../../components/src/markdown.ts';
import { RefreshControl } from '../../components/src/refresh-control.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

/** A scroll view whose axis the app can turn, as a layout switching between a row and a column. */
@Component({
  selector: 'x-turning-scroll',
  imports: [ScrollView, Text, View],
  template: `
    <scroll-view
      nativeID="scroll"
      [horizontal]="horizontal()"
      [showsHorizontalScrollIndicator]="false"
    >
      <view nativeID="item"><text>wide</text></view>
    </scroll-view>
  `,
})
export class TurningScroll {
  readonly scroll = viewChild.required(ScrollView);
  readonly horizontal = signal(false);
}

/** One that refreshes, which Android wraps in its swipe layout. */
@Component({
  selector: 'x-turning-refresh',
  imports: [RefreshControl, ScrollView, Text, View],
  template: `
    <view nativeID="page">
      <scroll-view nativeID="scroll" [horizontal]="horizontal()">
        <refresh-control />
        <view nativeID="item"><text>wide</text></view>
      </scroll-view>
    </view>
  `,
})
export class TurningRefresh {
  readonly horizontal = signal(false);
}

/** The same for the windowing list. */
@Component({
  selector: 'x-turning-list',
  imports: [VirtualList, Text, View],
  template: `
    <virtual-list
      #list
      nativeID="list"
      [items]="rows"
      [itemHeight]="40"
      [horizontal]="horizontal()"
      [style]="{ flex: 1 }"
    >
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class TurningList {
  readonly rows = ['a', 'b', 'c'];
  readonly horizontal = signal(true);
}

/** A table, which markdown puts in a horizontal scroll view so a wide one can be dragged across. */
@Component({
  selector: 'x-markdown-table',
  imports: [Markdown],
  template: `<markdown [source]="source" />`,
})
export class MarkdownTable {
  readonly source = '| a | b |\n| - | - |\n| 1 | 2 |\n';
}
