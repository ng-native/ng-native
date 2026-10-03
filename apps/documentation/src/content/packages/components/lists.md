---
title: Lists
summary: <virtual-list> and <section-list>, the windowed replacement for FlatList and SectionList.
art: lists
---

# Lists

## Virtual list

`<virtual-list>` is this project's replacement for `FlatList`, `SectionList` and
`VirtualizedList`, none of which are reachable because they are React component trees several
layers deep. It is a native scroll view sized to the full extent of the list, with only the
visible rows and a surrounding buffer (`overscan`, four rows by default, to cover fling gaps)
actually rendered and absolutely positioned inside it - the windowing a long list needs to stay
fast.

The rendering loop is deliberately not something this component owns. `<virtual-list>` computes
_which_ rows should exist, as `window()`, and the caller's own `@for` renders them - so tracking,
reuse and destruction all behave exactly as they would for any other `@for`:

```html
<virtual-list #list [items]="rows()" [itemHeight]="56" (endReached)="loadMore()" class="flex-1">
  <text listHeader>{{ rows().length }} results</text>
  @for (row of list.window(); track row.slot) {
  <view [virtualListRow]="row">
    <text>{{ row.item.label }}</text>
  </view>
  }
  <text listFooter>End of list</text>
</virtual-list>
```

`virtualListRow` applies the row's style and reports its layout back to the list;
`[style]="row.style"` does the first half alone, which is all a list of fixed heights needs.

### Rows that size themselves

Leave `itemHeight` unset and each row takes the height its content gives it, as a feed's posts
and a chat's messages do. The rendered rows are laid out in normal flow after a spacer standing in
for the rows above them, so native places every row correctly in the frame it first appears in,
and each row's layout tells the list its height for sizing what is not rendered. A row that has not
been measured yet counts as `estimatedItemHeight` (a number, or a function of the item and its
index; 50 by default). Measurements are kept by `keyExtractor`, so they follow their item across
inserts, removals and moves:

```html
<virtual-list
  #feed
  [items]="posts()"
  [estimatedItemHeight]="estimateOf"
  [keyExtractor]="idOf"
  [maintainVisibleContentPosition]="{ minIndexForVisible: 0, autoscrollToTopThreshold: 40 }"
>
  @for (row of feed.window(); track row.slot) {
  <view [virtualListRow]="row"><app-post [post]="row.item" /></view>
  }
</virtual-list>
```

When a row above the one on screen turns out taller or shorter than its estimate, the offset is
corrected by the difference, so what the user is reading does not move. The correction is a
`scrollTo` made after the commit, so one made mid-fling lands where the last scroll event said the
list was.

### Keeping position when rows change

`maintainVisibleContentPosition` holds what is on screen still when rows are inserted or removed
before it: new posts arriving at the top of a feed, older messages loaded above the ones being
read. It takes React Native's shape. Rows before `minIndexForVisible` never anchor the position,
and within `autoscrollToTopThreshold` points of the start the list scrolls to what arrived instead,
which is what a feed at its top and a chat at its newest message want. Without it an insert above
the viewport moves the content, as `UITableView` and `FlatList` do.

### Identity, recycling and row state

A row's `key` is `keyExtractor`'s answer for its item, or the item itself without one. Each
item in the window holds a `slot`, and keeps it for as long as it stays in the window, inserts
and removals included. `track row.slot` recycles: a row scrolling in takes the slot, and so the
views, of one that has scrolled out, and only its bindings are updated. On a fast fling that is
most of the work a frame does.

A slot whose item leaves the window is not destroyed at once: up to six per row type are kept
rendered but hidden (`display: none`, marked `row.parked`, and always last in `window()`), so the
next row to arrive reuses their views however many passes later, as a `UITableView` reuse queue
does. When rows come in different kinds - a text post and a photo post, a message and a date
divider - `itemType` (a function of the item and its index) keeps a pool per kind, so a slot is
only recycled into a row of its own kind and its views fit without being rebuilt.

A recycled row's components keep their fields, as a reused `UITableViewCell` does, so state held
in a row component passes to whichever item arrives in its slot. Keep per-item state outside the
row (in the list's data, or a store keyed by id), or derive it from the item so it resets when the
item changes, which is `prepareForReuse` in Angular's terms:

```ts
readonly expanded = linkedSignal({ source: () => this.post().id, computation: () => false });
```

Track by `row.key` instead when a row must never be recycled - a focused text input, a row
mid-animation. `track row.index` keeps a view with a position rather than an item, so after an
insert above it shows a different item; avoid it for rows with any state of their own.

Content marked `listHeader` or `listFooter` renders above and below the windowed rows in normal
flow, the way `FlatList`'s header and footer components do. `itemHeight` takes either a fixed number
or a function of the item and its index, for rows that are not all the same height. `horizontal`
lays rows out along `x` instead of `y`; `inverted` flips the list to scroll from the bottom, with
every row flipped back the right way up. Its first item is the one at the bottom, as `FlatList`'s
is, so a chat passes its messages newest first. `stickyIndices` pins specific rows to the leading
edge while the rest scroll underneath them, and `stickyHeader` pins the `listHeader` content until
the first sticky row pushes it off - between them, `FlatList`'s `stickyHeaderIndices`. A
`<refresh-control>` (see the [scroll view page](/packages/components/scroll-view)) projects like any
other child. The list is a native scroll view and takes the scroll view's own props as `FlatList`
does: `pagingEnabled`, `snapToInterval`, `decelerationRate`, `showsHorizontalScrollIndicator`,
`scrollEventThrottle`, `keyboardDismissMode`, `contentInsetAdjustmentBehavior` and the rest, with
the same defaults, so a horizontal list rubber-bands sideways and `'fast'` is resolved to the rate
UIKit takes. `horizontal`, `maintainVisibleContentPosition` and `keyboardShouldPersistTaps` are the
list's own, described above.

A separator is an `<ng-template virtualListSeparator>`, drawn between each pair of rows and not
after the last, and told the rows either side as `FlatList`'s `ItemSeparatorComponent` is. It is
drawn at the trailing edge of the leading row's slot, so `itemHeight` includes it, as
`getItemLayout`'s `length` does in React Native. A row that sizes itself has its separator drawn
over its trailing edge once its height is known:

```html
<virtual-list #list [items]="rows()" [itemHeight]="57">
  @for (row of list.window(); track row.slot) {
  <view [virtualListRow]="row"><text>{{ row.item.label }}</text></view>
  }
  <ng-template virtualListSeparator let-leading let-trailing="trailingItem">
    <view [style]="{ height: 1, backgroundColor: '#ddd' }"></view>
  </ng-template>
</virtual-list>
```

### Row actions

A row that swipes aside to show an action is a pan on the row, built on the
[gesture](/packages/components/gestures) and [worklet](/packages/components/animation) entry
points. The action sits behind the row's content, and the content slides over it:

```ts
import { Component, effect, input, output } from '@angular/core';
import { Gesture } from 'react-native-gesture-handler';
import { withTiming } from 'react-native-reanimated';
import { Pressable, Text, View } from '@ng-native/components';
import { NativeGesture } from '@ng-native/components/gestures';
import { WorkletStyle, sharedValue, workletStyle } from '@ng-native/components/reanimated';

/** How far the row opens: the width of the action behind it. */
const OPEN = 88;

@Component({
  selector: 'app-swipe-row',
  imports: [NativeGesture, Pressable, Text, View, WorkletStyle],
  template: `
    <pressable class="action" accessibilityRole="button" (press)="remove.emit()">
      <text>Delete</text>
    </pressable>
    <view class="front" [gesture]="swipe" [workletStyle]="slide"><ng-content /></view>
  `,
  styles: `
    .action {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 88px;
      align-items: center;
      justify-content: center;
      background-color: #d92d20;
    }
    .front {
      background-color: #ffffff;
    }
  `,
})
export class SwipeRow {
  /** What the row shows, so a row recycled for another item closes. */
  readonly item = input.required<unknown>();
  readonly remove = output<void>();

  private readonly x = sharedValue(0);
  protected readonly slide;
  protected readonly swipe;

  constructor() {
    // Locals, since a worklet cannot close over `this`.
    const x = this.x;
    const from = sharedValue(0);
    this.slide = workletStyle([x], (offset) => {
      'worklet';
      return { transform: [{ translateX: offset.value }] };
    });
    this.swipe = Gesture.Pan()
      .activeOffsetX([-12, 12]) // a sideways drag is the row's
      .failOffsetY([-10, 10]) // a vertical one fails it, and the list scrolls
      .onBegin(() => {
        'worklet';
        from.value = x.value;
      })
      .onUpdate((event) => {
        'worklet';
        x.value = Math.min(0, Math.max(-OPEN, from.value + event.translationX));
      })
      .onEnd(() => {
        'worklet';
        x.value = withTiming(x.value < -OPEN / 2 ? -OPEN : 0);
      });
    // The list recycles a row's views for another item: close before it shows the next one.
    effect(() => {
      this.item();
      x.value = 0;
    });
  }
}
```

```html
@for (row of list.window(); track row.slot) {
<view [virtualListRow]="row">
  <app-swipe-row [item]="row.item" (remove)="remove(row.item)">
    <text>{{ row.item.label }}</text>
  </app-swipe-row>
</view>
}
```

Three things make it sit well in a list. `failOffsetY` fails the pan on a vertical drag, so the
list keeps its scroll. The content has a background, or the action shows through it. And the
`item` input closes the row when its slot is recycled: without it, a row left open scrolls out and
the next item to take its views arrives already open, since a recycled row keeps its fields.

A long press for a menu is `(longPress)` on the row's `<pressable>` with
[`Dialogs.choose()`](/packages/device/dialogs). The system's own context menu, with a preview, is
[`UiContextMenu`](/packages/expo/expo-ui#a-context-menu), whose trigger is SwiftUI content rather
than a row of the app's own.

### Padding and gaps

`contentPadding` puts space around the rows inside the scrolling content, as `FlatList`'s
`contentContainerStyle` padding does: one number for every side, or `{ top, right, bottom, left }`.
The leading side comes before the first row and the trailing side after the last, and the sides
across the axis inset every row. `rowGap` puts space between one row and the next, and not before
the first or after the last. The list places its rows itself, so these are numbers it counts in
every offset, rather than classes on a container:

```html
<virtual-list #list [items]="rows()" [itemHeight]="72" [contentPadding]="24" [rowGap]="12">
  @for (row of list.window(); track row.slot) {
  <view [virtualListRow]="row" class="card"><text>{{ row.item.label }}</text></view>
  }
</virtual-list>
```

`itemHeight` stays the row's own size, without the gap. A row that sizes itself is measured
without it too. `scrollToIndex` puts a row's own top at the start of the viewport, past the
leading padding, as `FlatList`'s does. Sticky rows, viewability and `endReached` count the padding
and gaps. The header and footer sit outside the padding. An inverted list turns the padding over
with everything else, so its `top` is at the bottom of the screen. A separator is still drawn at
the trailing edge of its row, before the gap.

`endReached` fires once per change in item count, when the scroll position comes within
`endReachedThreshold` viewport-heights of the end - the hook for loading another page. Scrolling
away from the end and back fires it again, so a page that failed to load is retried.
`viewableItemsChanged` reports which rows are currently on screen by
`itemVisiblePercentThreshold`.

<!-- api: VirtualList -->

## Section list

`<section-list>` is `SectionList`: `sections` of `{ title, data }`, drawn from templates for the
section header, each item, the section footer, the separator between items of one section and the
separator at each edge of a section.
Like React Native's, it is the windowed list over flattened rows - a header, the items, then a
footer for each section - so it windows exactly as `<virtual-list>` does.

```html
<section-list
  #contacts="sectionList"
  [sections]="sections()"
  [itemHeight]="itemHeight"
  [sectionHeaderHeight]="28"
  (endReached)="loadMore()"
>
  <ng-template sectionHeader let-section><text>{{ section.title }}</text></ng-template>
  <ng-template sectionItem let-item let-index="index"><text>{{ item.name }}</text></ng-template>
  <ng-template sectionSeparator><view [style]="line"></view></ng-template>
  <ng-template sectionEdgeSeparator><view [style]="rule"></view></ng-template>
</section-list>
```

`sectionSeparator` is `ItemSeparatorComponent`, drawn between two items of one section and told
`leadingItem` and `trailingItem`. `sectionEdgeSeparator` is `SectionSeparatorComponent`, drawn
between a section's header and its first item and between its last item and its footer, and told
the `section`, `leadingSection` and `trailingSection`, plus whichever of `leadingItem` and
`trailingItem` is there. A section with no items draws neither.

Heights are fixed per row, as `getItemLayout` makes them: `itemHeight`, `sectionHeaderHeight` and
`sectionFooterHeight` are numbers or functions, and an item's height includes its separators.
A section separator is drawn in the first and last item's slots, so a section's first and last
items are taller by its height, which a number cannot express:

```ts
// 44pt items, a 1pt item separator and an 8pt section separator.
protected readonly itemHeight = (_item: Contact, index: number, section: ContactSection) =>
  44 + (index === 0 ? 8 : 0) + (index === section.data.length - 1 ? 8 : 1);
```

`stickySectionHeadersEnabled` defaults to on for iOS and off for Android, as in React Native.
`scrollToLocation({ sectionIndex, itemIndex })` counts the header as item 0, as React Native does,
and allows for a pinned header. `listHeader` and `listFooter` content, a `<refresh-control>`,
`contentPadding` and `keyboardShouldPersistTaps` pass through, as `<virtual-list>` takes them.

It has no `horizontal` or `inverted` and no viewability events, a separator is not told
`highlighted`, and its host is a plain view with the list filling it, so it takes no scroll-view
props. It has no `keyExtractor` or `maintainVisibleContentPosition` either: rows are fixed height,
so there is no measured height for a key to carry across an insert.

<!-- api: SectionList -->
