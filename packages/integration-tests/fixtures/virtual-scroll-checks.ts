import { Component } from '@angular/core';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import { VirtualList } from '../../components/src/virtual-list.ts';

/** A list on a screen that counts how often its template is checked. */
@Component({
  selector: 'x-virtual-scroll-checks',
  imports: [VirtualList, Text, View],
  template: `
    <text nativeID="checks">{{ checked() }}</text>
    <text nativeID="ended">{{ ended }}</text>
    <virtual-list
      #list
      [items]="rows"
      [itemHeight]="40"
      [windowSize]="1"
      [velocityLead]="0"
      [style]="fill"
      (endReached)="ended = ended + 1"
    >
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualScrollChecks {
  readonly rows = Array.from({ length: 100 }, (_, i) => 'row ' + i);
  readonly fill = { flex: 1 };
  ended = 0;
  checks = 0;
  checked(): number {
    return ++this.checks;
  }
}

/** The same list with a scroll handler of the screen's own, writing a plain field. */
@Component({
  selector: 'x-virtual-scroll-handler',
  imports: [VirtualList, Text, View],
  template: `
    <text nativeID="scrolled">{{ scrolls }}</text>
    <virtual-list
      #list
      [items]="rows"
      [itemHeight]="40"
      [windowSize]="1"
      [velocityLead]="0"
      [style]="fill"
      (scroll)="scrolls = scrolls + 1"
    >
      @for (row of list.window(); track row.index) {
        <view [style]="row.style"
          ><text>{{ row.item }}</text></view
        >
      }
    </virtual-list>
  `,
})
export class VirtualScrollHandler {
  readonly rows = Array.from({ length: 100 }, (_, i) => 'row ' + i);
  readonly fill = { flex: 1 };
  scrolls = 0;
}
