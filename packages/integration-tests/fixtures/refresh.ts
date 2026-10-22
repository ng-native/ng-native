import { Component, signal } from '@angular/core';
import { RefreshControl } from '../../components/src/refresh-control.ts';
import { SectionItem, SectionList } from '../../components/src/section-list.ts';
import { ScrollView } from '../../components/src/scroll-view.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

/** A scroll view with pull to refresh, whose style and refresh control can both change. */
@Component({
  selector: 'x-scroll-refresh',
  imports: [ScrollView, RefreshControl, Text, View],
  template: `
    <view nativeID="page">
      <text>before</text>
      @if (shown()) {
        <scroll-view nativeID="scroller" [style]="style()">
          @if (refreshable()) {
            <refresh-control [(refreshing)]="refreshing" (refresh)="log.push('refresh')" />
          }
          <text>content</text>
        </scroll-view>
      }
      <text>after</text>
    </view>
  `,
})
export class ScrollRefresh {
  readonly shown = signal(true);
  readonly refreshable = signal(true);
  readonly refreshing = signal(false);
  readonly style = signal<Record<string, unknown>>({
    flex: 1,
    margin: 8,
    backgroundColor: 'red',
    padding: 4,
  });
  readonly log: string[] = [];
}

/** The windowed list, with the same refresh control. */
@Component({
  selector: 'x-list-refresh',
  imports: [VirtualList, RefreshControl, Text, View],
  template: `
    <view nativeID="page">
      <virtual-list #list nativeID="list" [items]="items" [itemHeight]="40" [style]="style">
        <refresh-control [(refreshing)]="refreshing" (refresh)="log.push('refresh')" />
        @for (row of list.window(); track row.index) {
          <view [style]="row.style"
            ><text>{{ row.item }}</text></view
          >
        }
      </virtual-list>
    </view>
  `,
})
export class ListRefresh {
  readonly items = Array.from({ length: 50 }, (_, i) => 'row ' + i);
  readonly refreshing = signal(false);
  readonly style = { height: 300, marginTop: 10 };
  readonly log: string[] = [];
}

/** A section list, whose scroll view is a virtual list inside its own template. */
@Component({
  selector: 'x-section-refresh',
  imports: [SectionList, SectionItem, RefreshControl, Text, View],
  template: `
    <view nativeID="page">
      <section-list [sections]="sections" [itemHeight]="40" [style]="style">
        <refresh-control [(refreshing)]="refreshing" (refresh)="log.push('refresh')" />
        <ng-template sectionItem let-item
          ><text>{{ item }}</text></ng-template
        >
      </section-list>
    </view>
  `,
})
export class SectionRefresh {
  readonly sections = [{ title: 'A', data: ['a0', 'a1'] }];
  readonly refreshing = signal(false);
  readonly style = { flex: 1 };
  readonly log: string[] = [];
}

/** A refresh control with the colours Android's spinner cycles through. */
@Component({
  selector: 'x-coloured-refresh',
  imports: [ScrollView, RefreshControl, Text],
  template: `
    <scroll-view>
      <refresh-control [colors]="colors()" progressBackgroundColor="#00ff00" />
      <text>content</text>
    </scroll-view>
  `,
})
export class ColouredRefresh {
  readonly colors = signal<readonly string[] | undefined>(['#ff0000', 'blue']);
}
