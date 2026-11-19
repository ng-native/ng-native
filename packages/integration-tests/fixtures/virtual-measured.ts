import { Component, input, signal, viewChild } from '@angular/core';
import { Pressable } from '../../components/src/pressable.ts';
import { Text } from '../../components/src/text.ts';
import { View } from '../../components/src/view.ts';
import {
  VirtualList,
  VirtualListRow,
  VirtualListSeparator,
} from '../../components/src/virtual-list.ts';

export interface Post {
  readonly id: number;
  readonly text: string;
}

export const posts = (from: number, count: number): Post[] =>
  Array.from({ length: count }, (_, i) => ({ id: from + i, text: `post ${from + i}` }));

/** A row with state of its own, which has to stay with its post and not with its position. */
@Component({
  selector: 'x-post-row',
  imports: [Pressable, Text],
  template: `
    <pressable [nativeID]="'toggle' + post().id" (press)="toggle()">
      <text>{{ post().text }} {{ expanded() ? 'open' : 'closed' }}</text>
    </pressable>
  `,
})
export class PostRow {
  readonly post = input.required<Post>();
  protected readonly expanded = signal(false);

  protected toggle(): void {
    this.expanded.set(!this.expanded());
  }
}

/** A feed whose rows size themselves: no height is known until native has laid a row out. */
@Component({
  selector: 'x-measured',
  imports: [VirtualList, VirtualListRow, VirtualListSeparator, PostRow, View],
  template: `
    <virtual-list
      #list
      [items]="items()"
      [estimatedItemHeight]="estimate"
      [keyExtractor]="keyOf"
      [overscan]="2"
      [maintainVisibleContentPosition]="anchoring()"
      [stickyIndices]="sticky()"
      [style]="fill"
    >
      <view listHeader nativeID="header"></view>
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row" [nativeID]="'post' + row.item.id"
          ><x-post-row [post]="row.item"
        /></view>
      }
      @if (separated()) {
        <ng-template virtualListSeparator>
          <view nativeID="separator"></view>
        </ng-template>
      }
    </virtual-list>
  `,
})
export class Measured {
  readonly list = viewChild.required<VirtualList<Post>>('list');
  readonly items = signal(posts(0, 200));
  readonly anchoring = signal<
    { minIndexForVisible?: number; autoscrollToTopThreshold?: number } | undefined
  >(undefined);
  readonly sticky = signal<readonly number[]>([]);
  readonly separated = signal(false);
  readonly fill = { flex: 1 };
  readonly keyOf = (post: Post) => post.id;
  /** How many times a row's height has been estimated. */
  estimates = 0;
  readonly estimate = () => {
    this.estimates++;
    return 100;
  };
}

/** Fixed heights, keyed, with anchoring available. */
@Component({
  selector: 'x-keyed-fixed',
  imports: [VirtualList, VirtualListRow, PostRow, View],
  template: `
    <virtual-list
      #list
      [items]="items()"
      [itemHeight]="40"
      [keyExtractor]="keyOf"
      [itemType]="typed() ? typeOf : undefined"
      [stickyIndices]="sticky()"
      [overscan]="2"
      [maintainVisibleContentPosition]="anchoring()"
      [style]="fill"
    >
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row" [nativeID]="'post' + row.item.id"
          ><x-post-row [post]="row.item"
        /></view>
      }
    </virtual-list>
  `,
})
export class KeyedFixed {
  readonly list = viewChild.required<VirtualList<Post>>('list');
  readonly typed = signal(false);
  readonly sticky = signal<readonly number[]>([]);
  /** Every third post is a different kind of row, as a photo post among text posts is. */
  readonly typeOf = (post: Post) => (post.id % 3 === 0 ? 'photo' : 'text');
  readonly items = signal(posts(0, 1000));
  readonly anchoring = signal<
    { minIndexForVisible?: number; autoscrollToTopThreshold?: number } | undefined
  >(undefined);
  readonly fill = { flex: 1 };
  readonly keyOf = (post: Post) => post.id;
}
