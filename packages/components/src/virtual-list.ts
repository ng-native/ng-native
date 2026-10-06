import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  TemplateRef,
  afterEveryRender,
  booleanAttribute,
  computed,
  contentChild,
  effect,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  type HostNode,
  type NativeSyntheticEvent,
  type ScrollDrive,
  type ScrollRange,
  type StaticTransform,
  nativePlatform,
  pinnedRange,
} from '@ng-native/fabric';
import { HeightIndex } from './height-index.ts';
import { type KeyboardShouldPersistTaps, dismissKeyboardOnTap } from './keyboard-taps.ts';
import { RefreshControl } from './refresh-control.ts';
import { STICKY_SETTLE_MS } from './sticky-headers.ts';
import { TemplateSlot } from './template-slot.ts';
import { ZeroSizeWarning, checksZeroSize, written } from './zero-size-warning.ts';
import { View } from './view.ts';
import { ScrollViewProps } from './scroll-view-props.ts';

/** One rendered row: the item, its index, and a stable style object for its slot. */
export interface VirtualRow<T> {
  readonly index: number;
  /**
   * A key that a row keeps while its item stays in the window, and that passes to a row arriving
   * once it has left. `track row.slot` recycles rows: the view of a row scrolling out is reused for
   * the one scrolling in, with only its bindings updated, rather than one destroyed and one created
   * each time. A slot follows its item, not its position, so an insert above the window moves no
   * row to another item.
   */
  readonly slot: number;
  /**
   * The item's identity, from `keyExtractor`, or the item itself without one. `track row.key`
   * gives each item a view of its own for as long as it is in the window and never recycles one,
   * which is what a row holding state of its own, or animating, needs.
   */
  readonly key: unknown;
  readonly item: T;
  readonly style: Record<string, unknown>;
  /**
   * A slot kept rendered but hidden, still bound to the last item it showed, so the next row of
   * its type to arrive reuses its views instead of building them. Always last in the window.
   */
  readonly parked?: true;
}

/**
 * Space around the rows, inside the scrolling content: one number for every side, or a side each,
 * as FlatList's `contentContainerStyle` padding.
 */
export type VirtualListPadding =
  | number
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

/** The padding on each side, in points. */
interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A row height: one for every row, or one per item. */
export type VirtualItemHeight<T> = number | ((item: T, index: number) => number);

/**
 * Keep what is on screen where it is when rows are added or removed before it, as
 * `ScrollView`'s `maintainVisibleContentPosition` does in React Native.
 */
export interface VirtualListVisiblePosition {
  /** Rows before this index are never what the position is held by. Defaults to 0. */
  readonly minIndexForVisible?: number;
  /**
   * Within this many points of the start, show what arrived instead of holding position: a feed
   * at its top scrolls to the new posts, a chat at its newest message follows the next one.
   */
  readonly autoscrollToTopThreshold?: number;
}

/** What a separator template is given: the rows either side of it, as FlatList's `leadingItem`. */
export interface VirtualListSeparatorContext<T> {
  readonly $implicit: T;
  readonly leadingItem: T;
  readonly trailingItem: T;
  readonly leadingIndex: number;
}

/**
 * Marks the template drawn between two rows: `<ng-template virtualListSeparator let-leading>`.
 * FlatList's `ItemSeparatorComponent`.
 */
@Directive({ selector: 'ng-template[virtualListSeparator]' })
export class VirtualListSeparator<T = unknown> {
  readonly template = inject<TemplateRef<VirtualListSeparatorContext<T>>>(TemplateRef);

  static ngTemplateContextGuard<T>(
    _directive: VirtualListSeparator<T>,
    context: unknown,
  ): context is VirtualListSeparatorContext<T> {
    return true;
  }
}

/** One separator the list is drawing: its slot, and what its template is told. */
interface Gap<T> {
  readonly index: number;
  readonly style: Record<string, unknown>;
  readonly context: VirtualListSeparatorContext<T>;
}

/**
 * A parked slot: out of the flow, out of sight and out of reach, with its view kept to be used
 * again. Not `display: none`, which is an element with no view. A screen reader passes over a
 * view with no opacity, and `VirtualListRow` says so outright where a row uses it. Moved off the
 * list as well, since `pointer-events: none` is CSS's: something inside a row with a
 * `pointer-events` of its own would still take a touch where the row was left.
 */
const PARKED: Record<string, unknown> = Object.freeze({
  position: 'absolute',
  opacity: 0,
  pointerEvents: 'none',
  transform: 'translateX(-100000px)',
});

/** How many hidden slots of each row type are kept ready for reuse. */
const PARK_LIMIT = 6;

/** The style of a row that sizes itself and needs nothing else: in flow, where it falls. */
const IN_FLOW: Record<string, unknown> = Object.freeze({});

/** Points of drift below which a held position is left alone, as UIKit rounds to half-points. */
const HOLD_TOLERANCE = 0.5;

/** The row a held position is held by: its key, and how far into it the viewport starts. */
interface Anchor<T> {
  readonly key: unknown;
  readonly within: number;
  /** The items the anchor was taken against, to look for a successor in if its row goes. */
  readonly items: readonly T[];
  readonly index: number;
}

/** What the window is built from: the visible row and the edges of what is rendered. */
interface Span {
  readonly first: number;
  readonly last: number;
}

/**
 * Windowed list: a native scroll view whose content is sized to the full list, with only the
 * visible slice rendered. Commits as `RCTScrollView`.
 *
 * RN's FlatList, SectionList and VirtualizedList are a large React component tree, and none of
 * it is reachable. This is the small equivalent. Angular's own `@for` does the rendering, so
 * tracking, reuse and destruction all behave normally, and the loop stays in the caller's
 * template:
 *
 * ```html
 * <virtual-list #list [items]="rows()" [itemHeight]="44" (endReached)="loadMore()">
 *   <text listHeader>Header</text>
 *   @for (row of list.window(); track row.slot) {
 *     <view [virtualListRow]="row"><text>{{ row.item.label }}</text></view>
 *   }
 *   <text listFooter>Footer</text>
 * </virtual-list>
 * ```
 *
 * With `itemHeight`, every row's size is known up front and each is absolutely positioned at its
 * offset. Without it, rows size themselves, as a feed's posts and a chat's messages do: the window
 * is laid out in normal flow after a spacer standing in for the rows above it, so native places
 * every row correctly in the frame it first appears, and each row's layout tells the list its
 * height for sizing what is not rendered. Until a row has been measured it counts as
 * `estimatedItemHeight`. Measurements are kept by `keyExtractor`, so they follow their item across
 * inserts, removals and moves. `virtualListRow` on each row's view applies its style and reports
 * its layout; `[style]="row.style"` still works for fixed heights, which need no measuring.
 *
 * Content marked `listHeader` and `listFooter` renders above and below the rows in normal flow,
 * as FlatList's header and footer components do. A `<refresh-control>` projects like any child.
 *
 * `<ng-template virtualListSeparator let-leading let-trailing="trailingItem">` is drawn between
 * each pair of rows and not after the last, as FlatList's `ItemSeparatorComponent` is. It is drawn
 * inside the leading row's slot, at its trailing edge, so `itemHeight` includes it the way
 * `getItemLayout`'s `length` includes it in RN; a measured row has it drawn over its trailing edge
 * once its height is known. The slot it sits in lets touches through to the row underneath.
 *
 * `horizontal` swaps the axis: rows are placed by `left` and sized by `width`, and the offset is
 * read from `contentOffset.x`. `inverted` is a scale of -1 on the list and on each row, which is
 * how FlatList does it too - the list scrolls from the bottom and each row is flipped back the
 * right way up. The first item is the one at the bottom, so a chat passes its messages newest
 * first.
 *
 * `stickyIndices` pins a row to the leading edge while the rows under it scroll past, which is
 * FlatList's `stickyHeaderIndices` counted without the header. `stickyHeader` pins the
 * `listHeader` content the same way, FlatList's index 0 when it has a `ListHeaderComponent`, and
 * the first sticky row pushes it off as RN's sticky headers push each other. Neither is native:
 * RN's `ScrollView.js` translates a sticky child against the scroll offset in JavaScript, and a
 * row here follows the offset the same way while it is the current one - by its `top` when
 * absolutely positioned, by a transform when in flow.
 *
 * What is on screen stays on screen when a measured row above it turns out taller or shorter than
 * its estimate: the offset is corrected by the difference. `maintainVisibleContentPosition` does
 * the same for rows inserted or removed above it, which a feed receiving new posts and a chat
 * loading older messages above the ones being read both need.
 *
 * ponytail: viewability is `itemVisiblePercentThreshold` only: `minimumViewTime` and
 * `waitForInteraction` are timing policy on top of the same measurement, and nothing has needed
 * them. A separator is not told `highlighted`, which RN drives from the row's press state. A
 * sticky header follows the scroll a commit behind native, where RN's is on the native driver. A
 * held position is restored by a `scrollTo` after the commit, not in the mount as native
 * `maintainVisibleContentPosition` is, so a correction made mid-fling lands where the last scroll
 * event said the list was.
 */
@Component({
  selector: 'virtual-list',
  exportAs: 'virtualList',
  imports: [TemplateSlot, View],
  // One content view holds the header, the rows and the footer, as ScrollView.js's content
  // container does: Android's ScrollView takes one child and throws on a second. It is never
  // collapsed, or Fabric would flatten it away and hand the scroll view all three again.
  // See ScrollView: the canvas carries only a height, so Fabric would flatten it away and drags
  // over the gaps between rows would not scroll. Separators come after the rows so they draw over
  // the slot they share. The spacer is there only when rows are in flow.
  // A refresh control comes first, as the scroll view's own child; see ScrollView.
  template: `
    <ng-content select="refresh-control" />
    <view [style]="content()" collapsable="false">
      <view [style]="headerStyle()" (layout)="onHeaderLayout($event)"
        ><ng-content select="[listHeader]"
      /></view>
      <view #rows [style]="canvas()" collapsable="false">
        @if (measuring()) {
          <view [style]="spacer()"></view>
        }
        <ng-content />
        @if (separator(); as separator) {
          @for (gap of gaps(); track gap.index) {
            <view [style]="gap.style"
              ><ng-container
                [templateSlot]="separator.template"
                [templateSlotContext]="gap.context"
            /></view>
          }
        }
      </view>
      <view [style]="footerStyle()"><ng-content select="[listFooter]" /></view>
    </view>
  `,
  host: {
    // ScrollView.js's `baseHorizontal`: a column would stack the header, canvas and footer, and
    // the canvas, holding only absolutely positioned rows, would have no height to give them. A
    // top-level prop, as on <scroll-view>, so the caller's own [style] still applies over it.
    '[flexDirection]': "horizontal() ? 'row' : 'column'",
    '[horizontal]': 'horizontal()',
    '[nestedScrollEnabled]': 'nestedScroll()',
    // A prop rather than `[style.transform]`: Angular stringifies a style binding, and a
    // transform is a list of objects. The engine flattens style into props anyway, so this is
    // where it would have ended up.
    '[transform]': 'flip()',
    '[scrollEventThrottle]': 'scrollEventThrottle()',
    '(scroll)': 'onScroll($event)',
    '(layout)': 'onLayout($event)',
    '(contentSizeChange)': 'onContentSize($event)',
  },
})
export class VirtualList<T> extends ScrollViewProps {
  readonly items = input.required<readonly T[]>();
  /**
   * A fixed height, or a function for variable ones, when every row's size is known up front. The
   * function form builds a cumulative offset table and binary-searches it, which is what section
   * lists need: a header row and an item row are different heights, so uniform maths cannot place
   * them. Leave it unset for rows that size themselves.
   */
  readonly itemHeight = input<VirtualItemHeight<T>>();
  /**
   * What a row that sizes itself counts as until it has been measured. The closer it is, the more
   * honest the scroll bar is and the less a jump to an unmeasured row has to correct.
   */
  readonly estimatedItemHeight = input<VirtualItemHeight<T>>(50);
  /**
   * Space around the rows, inside the scrolling content. The leading side comes before the first
   * row and the trailing side after the last; the sides across the axis inset every row. The
   * header and footer sit outside it, as FlatList's do outside `contentContainerStyle`.
   */
  readonly contentPadding = input<VirtualListPadding>(0);
  /** Space between one row and the next, along the axis: not before the first or after the last. */
  readonly rowGap = input(0, { transform: numberAttribute });
  /**
   * An item's identity, as FlatList's `keyExtractor`: what a measured height, a slot and a held
   * position follow across an insert. Without it an item is its own key, which is enough for items
   * that are replaced, not copied, when they change.
   */
  readonly keyExtractor = input<(item: T, index: number) => unknown>();
  /**
   * What kind of row an item is, when rows of different kinds share the list: a text post and a
   * photo post, a message and a date divider. A slot is only ever recycled into a row of the same
   * type, so its views are reused rather than torn down for another kind's, as UIKit's reuse
   * identifiers and FlashList's `getItemType` do.
   */
  readonly itemType = input<(item: T, index: number) => unknown>();
  /** Keep what is on screen still when rows are inserted or removed before it. */
  readonly maintainVisibleContentPosition = input<VirtualListVisiblePosition>();
  /** Rows rendered beyond each edge of the viewport, to cover fling gaps. */
  readonly overscan = input(4, { transform: numberAttribute });
  /** How close to the end, in viewport heights, `(endReached)` fires. RN's default is 2. */
  readonly endReachedThreshold = input(2, { transform: numberAttribute });

  /** Lay the rows out along x instead of y, and scroll that way. */
  readonly horizontal = input(false, { transform: booleanAttribute });
  /** Start at the end and scroll backwards, with every row flipped back the right way up. */
  readonly inverted = input(false, { transform: booleanAttribute });
  /**
   * Rows that pin to the leading edge while the ones under them scroll past. Ascending; a row is
   * pinned from the moment it would leave until the next sticky row pushes it off.
   */
  readonly stickyIndices = input<readonly number[]>([]);
  /** Pin the `listHeader` content to the leading edge until the first sticky row pushes it off. */
  readonly stickyHeader = input(false, { transform: booleanAttribute });
  /** What a tap in the list does while a text input has the keyboard up. See `ScrollView`. */
  readonly keyboardShouldPersistTaps = input<KeyboardShouldPersistTaps>('never');
  /** How much of a row must be on screen to count as viewable. RN's default is 0, meaning any. */
  readonly itemVisiblePercentThreshold = input(0, { transform: numberAttribute });

  /**
   * The scroll position is within `endReachedThreshold` of the end: once per item count, and again
   * after the list has scrolled away from the end and come back.
   */
  readonly endReached = output<{ distanceFromEnd: number }>();

  /** Which rows are on screen, and what changed since last time. */
  readonly viewableItemsChanged = output<{
    viewable: readonly VirtualRow<T>[];
    entered: readonly number[];
    left: readonly number[];
  }>();

  private readonly viewport = signal(0);
  /** The leading edge of the viewport in content space, which sticky rows and viewability need. */
  private readonly offset = signal(0);
  private readonly headerHeight = signal(0);
  /** What native reported the content measures along the axis, once it has. */
  private contentSize = 0;
  /** The item count `endReached` last fired for, cleared once the list is away from the end. */
  private endReachedFor = -1;

  /** Slot styles are cached so a scroll does not hand Fabric new prop objects for stable rows. */
  private readonly slots = new Map<number, Record<string, unknown>>();
  /** A separator's slot style, per row slot style, so it is as stable as the row's own. */
  private readonly gapStyles = new WeakMap<object, Record<string, unknown>>();
  /** The same for a measured row's separator, by key, while its place and size stay put. */
  private readonly measuredGaps = new Map<unknown, Record<string, unknown>>();

  protected readonly separator = contentChild<VirtualListSeparator<T>>(VirtualListSeparator);
  private readonly refreshControl = contentChild(RefreshControl);

  /** See ScrollView: inside Android's swipe layout the list must see a drag first. */
  protected readonly nestedScroll = computed(() =>
    nativePlatform() === 'android' && this.refreshControl() ? true : undefined,
  );

  /**
   * Whether native moves sticky rows. Each then stays at its own place in the list and native
   * translates it on every frame the list scrolls, as RN's `ScrollViewStickyHeader` does; a
   * translate committed from each scroll event lands a frame or more late, and on a fast fling
   * the row shudders and comes away from the edge.
   */
  private readonly nativeSticky = this.engine.drivesScroll;
  /** The offset once scrolling pauses, which the settled translate of a native-moved row is from. */
  private readonly settled = signal(0);
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** What native is moving, by row view, with the transform kept beside the translate. */
  private readonly drives = new Map<HostNode, { drive: ScrollDrive; statics: string }>();
  private readonly canvasView = viewChild.required('rows', { read: ElementRef });

  /** Whether the scroll offset is needed as a signal, which only pinning needs. */
  private readonly pinning = computed(() => this.stickyHeader() || this.stickyIndices().length > 0);

  /** Rows size themselves and are laid out in flow, rather than placed at a known offset. */
  readonly measuring = computed(() => this.itemHeight() === undefined);

  /** The padding on each side. */
  private readonly edges = computed<Edges>(() => {
    const padding = this.contentPadding();
    if (typeof padding === 'number') {
      return { top: padding, right: padding, bottom: padding, left: padding };
    }
    const { top = 0, right = 0, bottom = 0, left = 0 } = padding ?? {};
    return { top, right, bottom, left };
  });

  /** The padding before the first row, along the axis. */
  private readonly lead = computed(() =>
    this.horizontal() ? this.edges().left : this.edges().top,
  );

  /** The rows' insets across the axis, as the props that place an absolutely positioned row. */
  private readonly across = computed((): Record<string, number> => {
    const { top, right, bottom, left } = this.edges();
    return this.horizontal() ? { top, bottom } : { left, right };
  });

  /** Heights native has reported, by key. */
  private readonly measured = new Map<unknown, number>();
  /** Bumped when a measurement changes, which is what re-sizes the list. */
  private readonly measuredVersion = signal(0);

  /** Each item's key, or null when items are their own. */
  private readonly keys = computed<readonly unknown[] | null>(() => {
    const extract = this.keyExtractor();
    return extract ? this.items().map(extract) : null;
  });

  private keyAt(index: number): unknown {
    return this.keys()?.[index] ?? this.items()[index];
  }

  /**
   * Each row's size and where it starts, for variable heights; uniform rows need no index at all.
   * Built once per change of items. A measurement changes it in place and bumps
   * `measuredVersion`, which is what everything that reads it depends on, so a row laying out
   * costs a walk of the tree rather than a rebuild of every offset.
   */
  private readonly table = computed<HeightIndex | null>(() => {
    const height = this.itemHeight();
    if (typeof height === 'number') return null;

    // Each row's entry is its size and the gap after it, so where a row starts counts the gaps
    // before it without a second table.
    const gap = this.rowGap();
    const items = this.items();
    const sizes = new Float64Array(items.length);
    if (height) {
      for (let i = 0; i < items.length; i++) sizes[i] = height(items[i]!, i) + gap;
      return new HeightIndex(sizes);
    }
    const estimate = this.estimatedItemHeight();
    const keys = this.keys();
    for (let i = 0; i < items.length; i++) {
      const size =
        this.measured.get(keys ? keys[i] : items[i]) ??
        (typeof estimate === 'number' ? estimate : estimate(items[i]!, i));
      sizes[i] = size + gap;
    }
    return new HeightIndex(sizes);
  });

  /** Where each key is, so a measurement finds its row without a search. */
  private readonly indexOfKey = computed(() => {
    if (!this.measuring()) return null;
    const map = new Map<unknown, number>();
    (this.keys() ?? this.items()).forEach((key, index) => map.set(key, index));
    return map;
  });

  /** The index, with a dependency on its measurements for whoever is reading it. */
  private layout(): HeightIndex | null {
    const table = this.table();
    if (table) this.measuredVersion();
    return table;
  }

  /**
   * The list's own total extent along its axis: the padding at both ends, the rows, and a gap
   * between each two of them.
   */
  private readonly extent = computed(() => {
    const table = this.layout();
    const count = this.items().length;
    const rows = table ? table.total : count * this.stride();
    const { top, right, bottom, left } = this.edges();
    const padding = this.horizontal() ? left + right : top + bottom;
    return padding + (count ? rows - this.rowGap() : 0);
  });

  /** A fixed-height row and the gap after it. */
  private stride(): number {
    return (this.itemHeight() as number) + this.rowGap();
  }

  /** ScrollView.js's `contentContainerHorizontal`: the header, rows and footer side by side. */
  protected readonly content = computed(() =>
    this.horizontal() ? { flexDirection: 'row' } : undefined,
  );

  protected readonly canvas = computed(() =>
    this.horizontal() ? { width: this.extent(), flexDirection: 'row' } : { height: this.extent() },
  );

  /**
   * `scaleY: -1` on the list, and the same on every row.
   *
   * The list ends up scrolled from the far end with its rows in reverse, and the second flip puts
   * each row's own content back the right way up. It is what `FlatList` does, and it is why an
   * inverted list needs no reversed maths: the first item is at offset 0, which is the bottom.
   */
  protected readonly flip = computed<StaticTransform[] | undefined>(() => {
    if (!this.inverted()) return undefined;
    const scale: StaticTransform = this.horizontal() ? { scaleX: -1 } : { scaleY: -1 };
    return [scale];
  });

  /**
   * The flip as a style's transform: CSS text, which the engine turns into the list native reads.
   * A style binding validates its values as the DOM's, and warns on a list in development.
   */
  private readonly flipText = computed(() => {
    if (!this.inverted()) return undefined;
    return this.horizontal() ? 'scaleX(-1)' : 'scaleY(-1)';
  });

  /**
   * What places a row in flow: the gap after it and the padding across the axis, as margins, since
   * native lays the row out. Empty when there are none, so a plain list commits no margins.
   */
  private readonly flowSpacing = computed<Record<string, unknown>>(() => {
    const gap = this.rowGap();
    const { top, right, bottom, left } = this.edges();
    const spacing: Record<string, number> = this.horizontal()
      ? { marginRight: gap, marginTop: top, marginBottom: bottom }
      : { marginBottom: gap, marginLeft: left, marginRight: right };
    return Object.fromEntries(Object.entries(spacing).filter(([, value]) => value !== 0));
  });

  /** A row in flow, flipped back when the list is inverted. One object, so rows never re-clone. */
  private readonly flowStyle = computed(() => {
    const flip = this.flipText();
    const spacing = this.flowSpacing();
    if (!flip && Object.keys(spacing).length === 0) return IN_FLOW;
    return flip ? { ...spacing, transform: flip } : spacing;
  });

  /** Top of a row: the leading padding, and every row and gap before it. */
  private topOf(index: number): number {
    const table = this.layout();
    return this.lead() + (table ? table.topOf(index) : index * this.stride());
  }

  /** A row's own size, without the gap after it. */
  private heightOf(index: number): number {
    const table = this.layout();
    return table ? table.heightOf(index) - this.rowGap() : (this.itemHeight() as number);
  }

  /** First row whose bottom, or the gap after it, is past `y`. */
  private indexAt(y: number): number {
    const table = this.layout();
    const along = y - this.lead();
    if (!table) return Math.max(0, Math.floor(along / this.stride()));
    return table.indexAt(along);
  }

  // --- holding position -------------------------------------------------------------------

  /** The row the viewport's leading edge is in, taken at each scroll. */
  private anchor: Anchor<T> | null = null;
  /** The last offset seen. A field rather than a signal: reading it renders nothing. */
  private lastOffset = 0;
  /**
   * A correction to make once the commit that needs it is on its way to native: an offset in the
   * rows' own space, after the header, or the very start of the list.
   */
  private pendingScroll: { offset: number; animated: boolean } | 'start' | null = null;

  /** What moves the rows: which items, and where each one is. */
  private readonly placement = computed(() => ({
    items: this.items(),
    table: this.table(),
    version: this.measuredVersion(),
  }));

  /**
   * The first *visible* row, not the first rendered one, and not the raw scroll offset. A fling
   * produces a scroll event per frame, and setting a signal on each one costs a change-detection
   * pass even when the visible rows are identical. Deriving the index in the handler means most
   * scroll events change nothing and cost nothing.
   *
   * Linked to the rows' placement, because that is when the row on screen can move without the
   * user scrolling: an insert above it, or a row above it measuring differently from its estimate.
   * The index follows the anchored row there, and the offset follows it too.
   */
  private readonly visible = linkedSignal<
    { items: readonly T[]; table: HeightIndex | null; version: number },
    number
  >({
    source: this.placement,
    computation: (placement) => this.reanchor(placement.items),
  });

  /** Take the anchor at a row, keeping the viewport where it is. */
  private anchorAt(at: number, offset: number): void {
    const items = this.items();
    if (!items.length) {
      this.anchor = null;
      return;
    }
    const index = Math.min(at, items.length - 1);
    this.anchor = { key: this.keyAt(index), within: offset - this.topOf(index), items, index };
  }

  /**
   * Where the row on screen went when the rows moved under it, and the offset that keeps it where
   * the user left it. An insert or a removal is only held when the caller asked for it; a row
   * above measuring differently always is, since nothing the user did moved anything.
   */
  private reanchor(items: readonly T[]): number {
    const anchor = this.anchor;
    // Empty for a moment, as a filter typed through leaves it: the offset is kept for what comes.
    if (!items.length) return 0;
    if (!anchor) return this.atOffset();

    const index = this.heldIndex(anchor, items);
    if (index === 'start') return this.showStart();
    if (index < 0) return this.atOffset();
    const held = this.topOf(index) + anchor.within;
    if (Math.abs(held - this.lastOffset) > HOLD_TOLERANCE) {
      this.pendingScroll = { offset: held, animated: false };
      this.lastOffset = held;
    }
    this.anchor = { ...anchor, items, index };
    return index;
  }

  /**
   * The row under the offset native is still at, in rows that have just replaced the old ones, as
   * a filter replaces them. Native keeps its offset whatever the items became, so the window is
   * worked out from that, not from the old row's index, which in the new rows sits somewhere else.
   * When the new rows end before that offset, the list is scrolled back to their end: native
   * would otherwise stay scrolled past it, showing nothing until the next drag.
   */
  private atOffset(): number {
    const end = Math.max(0, this.extent() - this.viewport());
    if (this.viewport() > 0 && this.lastOffset > end + HOLD_TOLERANCE) {
      this.pendingScroll = { offset: end, animated: false };
      this.lastOffset = end;
    }
    const index = Math.max(0, Math.min(this.indexAt(this.lastOffset), this.items().length - 1));
    this.anchorAt(index, this.lastOffset);
    return index;
  }

  /**
   * The index to hold the viewport at, -1 to let it move, or the start of the list when an
   * insert lands within the autoscroll threshold of it.
   */
  private heldIndex(anchor: Anchor<T>, items: readonly T[]): number | 'start' {
    if (items === anchor.items) return anchor.index;
    const hold = this.maintainVisibleContentPosition();
    if (!hold) return -1;
    const threshold = hold.autoscrollToTopThreshold;
    if (threshold !== undefined && this.lastOffset <= threshold) return 'start';
    const index = this.successorOf(anchor, items);
    return index < (hold.minIndexForVisible ?? 0) ? -1 : index;
  }

  /** Scroll to what arrived at the start, rather than holding the viewport past it. */
  private showStart(): number {
    this.anchorAt(0, 0);
    if (this.lastOffset !== 0) this.pendingScroll = 'start';
    this.lastOffset = 0;
    return 0;
  }

  /**
   * The anchored row's new index, or the first row after it that survived when it did not. Only
   * the rows that were rendered are searched for a successor: past those the viewport has moved
   * on, and holding it by something off screen would be holding it by nothing the user saw.
   */
  private successorOf(anchor: Anchor<T>, items: readonly T[]): number {
    const keys = this.keys() ?? items;
    const index = keys.indexOf(anchor.key);
    if (index !== -1) return index;
    const extract = this.keyExtractor();
    const was = anchor.items;
    const limit = Math.min(was.length, anchor.index + this.overscan() * 4 + 1);
    for (let i = anchor.index + 1; i < limit; i++) {
      const successor = keys.indexOf(extract ? extract(was[i]!, i) : was[i]);
      if (successor !== -1) return successor;
    }
    return -1;
  }

  /** Make a queued correction, after the commit that moved the rows has gone to native. */
  private flushScroll(): void {
    const pending = this.pendingScroll;
    if (!pending) return;
    this.pendingScroll = null;
    if (pending === 'start') this.scrollToOffset({ offset: 0, animated: true });
    else this.scrollToOffset({ offset: this.headerHeight() + pending.offset, animated: false });
  }

  /** In development, a list with rows that stays at zero size; see `ZeroSizeWarning`. */
  private readonly zeroSize = checksZeroSize()
    ? new ZeroSizeWarning(
        () => written(this.node),
        () => !!this.horizontal(),
      )
    : null;

  constructor() {
    super();
    afterEveryRender(() => {
      this.flushScroll();
      if (this.nativeSticky) this.driveStickyRows();
    });
    const stop = dismissKeyboardOnTap(this.engine, this.node, () =>
      this.keyboardShouldPersistTaps(),
    );
    inject(DestroyRef).onDestroy(() => {
      stop();
      clearTimeout(this.settleTimer);
      this.zeroSize?.stop();
      for (const held of this.drives.values()) held.drive.stop();
    });
    if (this.zeroSize) this.checkZeroSize(this.zeroSize);
  }

  /** Whether the viewport has been laid out yet, so a zero in it is a measurement. */
  private viewportMeasured = false;

  /**
   * In development, rows that arrive in a list already measured at zero, or go from one, with no
   * new layout to say so: an update to `items` alone does not lay the viewport out again.
   */
  private checkZeroSize(warning: ZeroSizeWarning): void {
    effect(() => {
      const hasRows = this.items().length > 0;
      if (this.viewportMeasured) warning.laidOut(untracked(this.viewport), hasRows);
    });
  }

  // --- the window ---------------------------------------------------------------------------

  /** The rows to render, and the edges of the run they sit in. */
  private readonly span = computed<Span | null>(() => {
    const items = this.items();
    const viewport = this.viewport();
    const overscan = this.overscan();
    if (!items.length) return null;

    const visible = Math.min(this.visible(), items.length - 1);
    const first = Math.max(0, visible - overscan);
    // Before the first layout we have no viewport, so render a screen's worth optimistically
    // rather than nothing: an empty first frame is worse than a few extra rows.
    const budget = viewport > 0 ? viewport : this.heightOf(first) * overscan * 2;
    /*
     * Measured from the top of the first *visible* row, not the first rendered one.
     *
     * Anchoring it at `first` - which is already backed off by the overscan - spent the budget
     * on rows above the viewport, so the window ran out that far before the bottom of the
     * screen. The trailing `+ overscan` hid it whenever every row was the same height, because
     * then the rows added below happened to be worth exactly the rows wasted above. With mixed
     * heights they are not, and the list clips short of its own bottom.
     */
    const top = this.topOf(visible);

    let last = visible;
    while (last < items.length && this.topOf(last) < top + budget) last++;
    return { first, last: Math.min(items.length, last + overscan) };
  });

  readonly window = computed<VirtualRow<T>[]>(() => {
    const span = this.span();
    if (!span) return [];
    const rows = this.rowsFor(this.items(), span.first, span.last);
    this.trimParked();
    for (const pool of this.parked.values()) rows.push(...pool);
    // The cache exists for rows that stay in the window between scrolls; anything that has left
    // it is rebuilt if it comes back, so the map stays the size of the window, not of the list.
    for (const index of this.slots.keys()) {
      if (index < span.first || index >= span.last) this.slots.delete(index);
    }
    return rows;
  });

  /**
   * What stands in for the rows above the window when rows are in flow: their total extent, less
   * a pinned row's, which is rendered in flow ahead of the window.
   */
  protected readonly spacer = computed(() => {
    const span = this.span();
    let lead = span ? this.topOf(span.first) : 0;
    const pinned = this.pinnedIndex();
    if (span && pinned !== null && pinned < span.first) {
      lead = this.nativeSticky ? this.topOf(pinned) : lead - this.heightOf(pinned) - this.rowGap();
    }
    return this.horizontal() ? { width: Math.max(0, lead) } : { height: Math.max(0, lead) };
  });

  /** The rows from `first` up to `last`, and the pinned row above them if there is one. */
  private rowsFor(items: readonly T[], first: number, last: number): VirtualRow<T>[] {
    const rows: VirtualRow<T>[] = [];
    const pinned = this.pinnedIndex();
    const pinnedAbove = pinned !== null && pinned < first;
    this.releaseRecycled(first, last, pinnedAbove ? pinned : null);
    // The pinned row is on screen even when its own place in the list is not, which is the whole
    // point of it, so it is rendered whether or not the window reaches that far.
    if (pinnedAbove) {
      const key = this.keyAt(pinned);
      rows.push(
        this.hold({
          index: pinned,
          slot: this.recycledSlot(key, items[pinned]!, pinned),
          key,
          item: items[pinned]!,
          style: this.nativeSticky
            ? this.stickyStyle(pinned)
            : this.measuring()
              ? this.pinnedFlowStyle(this.topOf(first) - this.heightOf(pinned) - this.rowGap())
              : this.slotStyle(pinned, this.offset()),
        }),
      );
    }
    for (let index = first; index < last; index++) {
      const key = this.keyAt(index);
      rows.push(
        this.hold({
          index,
          slot: this.recycledSlot(key, items[index]!, index),
          key,
          item: items[index]!,
          style: this.styleFor(index, index === pinned),
        }),
      );
    }
    if (pinnedAbove && this.nativeSticky && this.measuring()) this.leadWindow(rows, pinned, first);
    return rows;
  }

  /**
   * A pinned row native moves stays at its own place, so the rows between it and the window are
   * made up before the window rather than after the row: new props on a view native is moving
   * put its transform back for a frame.
   */
  private leadWindow(rows: VirtualRow<T>[], pinned: number, first: number): void {
    const lead = rows[1];
    // The pinned row's own gap already follows it in flow.
    const between = this.topOf(first) - this.topOf(pinned) - this.heightOf(pinned) - this.rowGap();
    if (!lead || between <= 0) return;
    const margin = this.horizontal() ? 'marginLeft' : 'marginTop';
    rows[1] = this.hold({ ...lead, style: { ...lead.style, [margin]: between } });
  }

  private styleFor(index: number, pinned: boolean): Record<string, unknown> {
    if (this.nativeSticky && this.nextSticky().has(index)) return this.stickyStyle(index);
    if (this.measuring()) {
      return pinned ? this.pinnedFlowStyle(this.topOf(index)) : this.flowStyle();
    }
    return pinned ? this.slotStyle(index, this.offset()) : this.slotStyle(index);
  }

  /** A pinned row in flow, moved from where flow put it to the leading edge by a transform. */
  private pinnedFlowStyle(at: number): Record<string, unknown> {
    const shift = Math.max(0, this.offset() - at);
    const move = `${this.horizontal() ? 'translateX' : 'translateY'}(${shift}px)`;
    const flip = this.flipText();
    return { ...this.flowSpacing(), zIndex: 1, transform: flip ? `${move} ${flip}` : move };
  }

  /**
   * A sticky row native moves: at its own place, with the translate native had reached when
   * scrolling paused, so the props agree with what is on screen.
   */
  private stickyStyle(index: number): Record<string, unknown> {
    const horizontal = this.horizontal();
    const style: Record<string, unknown> = this.measuring()
      ? { ...this.flowSpacing() }
      : { ...this.slotStyle(index) };
    style['zIndex'] = 1;
    const top = this.topOf(index);
    const shift = Math.min(Math.max(0, this.settled() - top), this.stopOf(index) - top);
    const move = shift > 0 ? `${horizontal ? 'translateX' : 'translateY'}(${shift}px)` : '';
    const transform = [move, this.flipText() ?? ''].filter(Boolean).join(' ');
    if (transform) style['transform'] = transform;
    return style;
  }

  /** Each sticky row, and the one after it, which pushes it off. */
  private readonly nextSticky = computed(() => {
    const sticky = this.stickyIndices();
    return new Map(sticky.map((index, at) => [index, sticky[at + 1]]));
  });

  /** Where a sticky row stops, pushed off by the next: that row's top, less this row's size. */
  private stopOf(index: number): number {
    const next = this.nextSticky().get(index);
    return next === undefined ? Infinity : this.topOf(next) - this.heightOf(index);
  }

  /**
   * How native moves a rendered row, or null when it does not: along the scroll view's own
   * offset, which counts the header, from the row's top until the next sticky row pushes it off.
   */
  private stickyDrive(
    row: VirtualRow<T>,
  ): { range: ScrollRange; statics: readonly StaticTransform[] } | null {
    if (!this.nativeSticky || row.parked || !this.nextSticky().has(row.index)) return null;
    const header = this.headerHeight();
    const start = header + this.topOf(row.index);
    return {
      range: pinnedRange(start, header + this.stopOf(row.index)),
      statics: this.flip() ?? [],
    };
  }

  /**
   * Hand each rendered sticky row's view to native to move, and let go of the rest. The rows'
   * views are the canvas's element children in window order, after the spacer, which is how
   * `@for` over `window()` leaves them.
   */
  private driveStickyRows(): void {
    if (!this.pinning() && this.drives.size === 0) return;
    const canvas = this.canvasView().nativeElement as HostNode;
    const views = canvas.children
      .filter((child) => child.kind === 'element')
      .slice(this.measuring() ? 1 : 0);
    const axis = this.horizontal() ? 'x' : 'y';
    const live = new Set<HostNode>();
    this.window().forEach((row, at) => {
      const view = views[at];
      const next = this.stickyDrive(row);
      if (!view || !next) return;
      live.add(view);
      const statics = JSON.stringify(next.statics);
      const held = this.drives.get(view);
      if (held?.statics === statics) return held.drive.update(next.range);
      held?.drive.stop();
      const drive = this.engine.driveByScroll(view, this.node, axis, next.range, next.statics);
      if (drive) this.drives.set(view, { drive, statics });
    });
    for (const [view, held] of this.drives) {
      if (live.has(view)) continue;
      held.drive.stop();
      this.drives.delete(view);
    }
  }

  /** Which recycling slot each rendered item holds, by key: its type, and the row it last drew. */
  private readonly recycled = new Map<
    unknown,
    { slot: number; type: unknown; row: VirtualRow<T> | null }
  >();
  /** Slots that have left the window and are kept hidden, by the type of row that held them. */
  private readonly parked = new Map<unknown, VirtualRow<T>[]>();
  private nextSlot = 0;

  /** Note the row a slot is drawing, for parking it once it leaves. */
  private hold(row: VirtualRow<T>): VirtualRow<T> {
    const held = this.recycled.get(row.key);
    if (held) held.row = row;
    return row;
  }

  /**
   * Park the slots of the items that have left the window, for the items arriving.
   *
   * Parked rather than freed: a slot missing from the window is destroyed by `@for`, so a slot is
   * only reused if a row of its type arrives in the same pass as it left. Kept rendered and
   * hidden, it waits for the next row of its type however many passes later, which is what a
   * reuse queue of cells does in UIKit.
   */
  private releaseRecycled(first: number, last: number, pinned: number | null): void {
    const keep = new Set<unknown>();
    for (let index = first; index < last; index++) keep.add(this.keyAt(index));
    if (pinned !== null) keep.add(this.keyAt(pinned));
    for (const [key, held] of this.recycled) {
      if (keep.has(key)) continue;
      this.recycled.delete(key);
      let pool = this.parked.get(held.type);
      if (!pool) this.parked.set(held.type, (pool = []));
      pool.push({ ...(held.row ?? this.placeholder(key, held.slot)), parked: true, style: PARKED });
    }
  }

  /**
   * Keep a few hidden slots of each type once this pass has taken what it needs, dropping the
   * oldest: `@for` destroys the views of a slot that leaves the window for good.
   */
  private trimParked(): void {
    for (const pool of this.parked.values()) {
      if (pool.length > PARK_LIMIT) pool.splice(0, pool.length - PARK_LIMIT);
    }
  }

  /** A parked row for a slot that never drew, which only a slot taken and left in one pass is. */
  private placeholder(key: unknown, slot: number): VirtualRow<T> {
    return { index: -1, slot, key, item: this.items()[0]!, style: PARKED };
  }

  private recycledSlot(key: unknown, item: T, index: number): number {
    const held = this.recycled.get(key);
    if (held) return held.slot;
    const type = this.itemType()?.(item, index);
    const slot = this.parked.get(type)?.pop()?.slot ?? this.nextSlot++;
    this.recycled.set(key, { slot, type, row: null });
    return slot;
  }

  /**
   * A row laid itself out; what `virtualListRow` calls. Only a row that sizes itself is measured,
   * and a height that has not changed changes nothing.
   */
  measureRow(row: VirtualRow<T>, layout: { width?: number; height?: number } | undefined): void {
    if (!this.measuring() || !layout || row.parked) return;
    const size = this.horizontal() ? layout.width : layout.height;
    if (size === undefined || this.measured.get(row.key) === size) return;
    this.measured.set(row.key, size);
    this.forgetDeparted();
    const index = this.indexOfKey()?.get(row.key);
    if (index === undefined) return;
    this.table()?.set(index, size + this.rowGap());
    this.measuredVersion.update((version) => version + 1);
  }

  /** Drop the measurements of items long gone, so churn cannot grow the map without bound. */
  private forgetDeparted(): void {
    const items = this.items();
    if (this.measured.size <= items.length * 2 + 64) return;
    const current = new Set(this.keys() ?? items);
    for (const key of this.measured.keys()) if (!current.has(key)) this.measured.delete(key);
  }

  /** A separator for every rendered row but the list's last, in its leading row's slot. */
  protected readonly gaps = computed<Gap<T>[]>(() => {
    if (!this.separator()) return [];
    const items = this.items();
    const gaps: Gap<T>[] = [];
    for (const row of this.window()) {
      if (row.parked || row.index >= items.length - 1) continue;
      const style = this.measuring() ? this.measuredGapStyle(row) : this.gapStyle(row);
      if (!style) continue;
      const trailingItem = items[row.index + 1]!;
      gaps.push({
        index: row.index,
        style,
        context: {
          $implicit: row.item,
          leadingItem: row.item,
          trailingItem,
          leadingIndex: row.index,
        },
      });
    }
    return gaps;
  });

  /** The row's own slot, laid out to put the separator at its trailing edge. */
  private gapStyle(row: VirtualRow<T>): Record<string, unknown> {
    let style = this.gapStyles.get(row.style);
    if (!style) {
      style = {
        ...row.style,
        flexDirection: this.horizontal() ? 'row' : 'column',
        justifyContent: 'flex-end',
        pointerEvents: 'box-none',
      };
      this.gapStyles.set(row.style, style);
    }
    return style;
  }

  /**
   * A measured row's slot, over the row itself: nothing until its height is known, since drawing
   * it at the estimate would put a line through the middle of a row that turns out taller.
   */
  private measuredGapStyle(row: VirtualRow<T>): Record<string, unknown> | null {
    if (!this.measured.has(row.key)) return null;
    const start = this.topOf(row.index);
    const size = this.heightOf(row.index);
    const horizontal = this.horizontal();
    const flip = this.flipText();
    const across = this.across();
    const cached = this.measuredGaps.get(row.key);
    const placed = horizontal
      ? { ...across, left: start, width: size, transform: flip }
      : { ...across, top: start, height: size, transform: flip };
    if (cached && holds(cached, placed)) return cached;
    const style: Record<string, unknown> = horizontal
      ? { position: 'absolute', ...across, left: start, width: size, flexDirection: 'row' }
      : { position: 'absolute', ...across, top: start, height: size };
    style['justifyContent'] = 'flex-end';
    style['pointerEvents'] = 'box-none';
    if (flip) style['transform'] = flip;
    this.measuredGaps.set(row.key, style);
    if (this.measuredGaps.size > 256) this.measuredGaps.clear();
    return style;
  }

  /**
   * The header's translation while it is pinned: the scroll position, held back at zero by an
   * overscroll and at the first sticky row, which pushes it off.
   */
  protected readonly headerStyle = computed(() => {
    const flip = this.flipText();
    if (!this.stickyHeader()) return flip ? { transform: flip } : undefined;
    const along = this.offset() + this.headerHeight();
    const first = this.stickyIndices()[0];
    const limit = first === undefined ? Infinity : this.topOf(first);
    const shift = Math.min(Math.max(0, along), limit);
    const move = shift > 0 ? `${this.horizontal() ? 'translateX' : 'translateY'}(${shift}px)` : '';
    const transform = [move, flip ?? ''].filter(Boolean).join(' ');
    return transform ? { zIndex: 1, transform } : { zIndex: 1 };
  });

  /**
   * The footer, flipped back like every row when the list is inverted, as FlatList inverts its
   * header and footer cells too; otherwise both read upside down.
   */
  protected readonly footerStyle = computed(() => {
    const flip = this.flipText();
    return flip ? { transform: flip } : undefined;
  });

  /**
   * The sticky row currently holding the leading edge: the last one at or before the offset.
   * Null when the list has scrolled back above the first of them.
   */
  private readonly pinnedIndex = computed<number | null>(() => {
    const sticky = this.stickyIndices();
    if (sticky.length === 0) return null;
    const offset = this.offset();

    let pinned: number | null = null;
    for (const index of sticky) {
      if (this.topOf(index) <= offset) pinned = index;
      else break;
    }
    return pinned;
  });

  /** Which rows are on screen far enough to count, by the caller's threshold. */
  private viewableAt(offset: number): number[] {
    const viewport = this.viewport();
    if (!viewport) return [];

    const threshold = this.itemVisiblePercentThreshold() / 100;
    const rows: number[] = [];
    for (const row of this.window()) {
      if (row.parked) continue;
      const start = this.topOf(row.index);
      const size = this.heightOf(row.index);
      const shown = Math.min(start + size, offset + viewport) - Math.max(start, offset);
      if (shown > 0 && shown >= size * threshold) rows.push(row.index);
    }
    return rows;
  }

  /** The last set announced, so the output fires on a change rather than on every frame. */
  private announced: number[] = [];

  /**
   * Announce a change in what is on screen.
   *
   * Deliberately not a `computed` over a signal offset. A fling produces a scroll event per
   * frame, and writing a signal on each one costs a change-detection pass whether or not anything
   * moved into view; comparing here costs an array walk over the window and emits only when the
   * set really changed.
   */
  private announceViewable(offset: number): void {
    const viewable = this.viewableAt(offset);
    const entered = viewable.filter((index) => !this.announced.includes(index));
    const left = this.announced.filter((index) => !viewable.includes(index));
    if (entered.length === 0 && left.length === 0) return;

    this.announced = viewable;
    const items = this.items();
    this.viewableItemsChanged.emit({
      viewable: viewable.map((index) => {
        const key = this.keyAt(index);
        return {
          index,
          // What is viewable is in the window, so it holds a slot already.
          slot: this.recycled.get(key)?.slot ?? -1,
          key,
          item: items[index]!,
          style: this.styleFor(index, false),
        };
      }),
      entered,
      left,
    });
  }

  /**
   * Scroll so that a row is at the start of the viewport, less `viewOffset`. The window moves
   * there at once, and the row is held there while the rows around it are measured.
   */
  scrollToIndex(options: { index: number; animated?: boolean; viewOffset?: number }): void {
    const items = this.items();
    if (!items.length) return;
    const index = Math.max(0, Math.min(options.index, items.length - 1));
    const within = -(options.viewOffset ?? 0);
    const offset = this.topOf(index) + within;
    this.lastOffset = offset;
    this.anchor = { key: this.keyAt(index), within, items, index };
    this.visible.set(index);
    this.scrollToOffset({ offset: this.headerHeight() + offset, animated: options.animated });
  }

  /** Scroll to an offset along the list's own axis: x when it is horizontal, y otherwise. */
  scrollToOffset(options: { offset: number; animated?: boolean }): void {
    const { offset, animated = true } = options;
    const [x, y] = this.horizontal() ? [offset, 0] : [0, offset];
    this.engine.dispatchCommand(this.node, 'scrollTo', [x, y, animated]);
  }

  scrollToEnd(options: { animated?: boolean } = {}): void {
    this.engine.dispatchCommand(this.node, 'scrollToEnd', [options.animated ?? true]);
  }

  private slotStyle(index: number, pinnedAt?: number): Record<string, unknown> {
    const start = pinnedAt ?? this.topOf(index);
    const size = this.heightOf(index);
    const horizontal = this.horizontal();
    const key = horizontal ? 'left' : 'top';
    const extent = horizontal ? 'width' : 'height';

    const flip = this.flipText();
    const across = this.across();

    let style = this.slots.get(index);
    // The flip is part of the comparison because turning the list over changes every row, and a
    // cached slot would otherwise keep the orientation it was built with.
    const placed = { ...across, [extent]: size, [key]: start, transform: flip };
    const stale = !style || pinnedAt !== undefined || !holds(style, placed);

    if (stale) {
      style = horizontal
        ? { position: 'absolute', ...across, left: start, width: size }
        : { position: 'absolute', ...across, top: start, height: size };
      // A pinned row draws over the ones sliding under it; the transform is the row's half of
      // the inversion.
      if (pinnedAt !== undefined) style['zIndex'] = 1;
      if (flip) style['transform'] = flip;
      this.slots.set(index, style);
      return style;
    }
    return style!;
  }

  protected onScroll(
    event: NativeSyntheticEvent<{ contentOffset?: { x?: number; y?: number } }>,
  ): void {
    const contentOffset = event.nativeEvent?.contentOffset;
    const along = (this.horizontal() ? contentOffset?.x : contentOffset?.y) ?? 0;
    const content = along - this.headerHeight();

    // The first *visible* row, not the first rendered one. The overscan is applied where the
    // window is built, so that both edges can be measured from the same place.
    // Not clamped to the items: an input set in the same task as this event has not reached the
    // list yet, and the window clamps when it renders.
    const visible = this.indexAt(content);
    if (visible !== this.visible()) this.visible.set(visible);
    this.lastOffset = content;
    this.anchorAt(visible, content);
    // A pinned row follows the scroll continuously, so with sticky rows the offset has to be a
    // signal - and only then. Without them this stays a field, and a fling that moves no row in
    // or out of the window costs no change detection at all.
    if (this.pinning()) this.offset.set(content);
    if (this.nativeSticky && this.pinning()) this.settleAfterPause(content);
    this.checkEnd(along);
    this.announceViewable(content);
  }

  /** A pinned row's translate, settled once scrolling pauses: see `STICKY_SETTLE_MS`. */
  private settleAfterPause(content: number): void {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.settled.set(content), STICKY_SETTLE_MS);
  }

  protected onLayout(
    event: NativeSyntheticEvent<{ layout?: { width?: number; height?: number } }>,
  ): void {
    const layout = event.nativeEvent?.layout;
    this.viewport.set((this.horizontal() ? layout?.width : layout?.height) ?? 0);
    this.viewportMeasured = true;
    this.zeroSize?.laidOut(this.viewport(), this.items().length > 0);
    this.announceViewable(this.lastOffset);
  }

  /** The header's extent along the axis, which every row sits after. */
  protected onHeaderLayout(
    event: NativeSyntheticEvent<{ layout?: { width?: number; height?: number } }>,
  ): void {
    const layout = event.nativeEvent?.layout;
    const height = (this.horizontal() ? layout?.width : layout?.height) ?? 0;
    if (height === this.headerHeight()) return;
    this.headerHeight.set(height);
    this.holdPastHeader();
  }

  /**
   * The header grew or shrank - a typing indicator in a chat's, a banner in a feed's - and every
   * row moved with it. Held like an insert when the caller asked for that and the viewport is
   * past the header, among the rows; at the start the user is looking at the header, and it is
   * left to push the rows along. Made at once rather than after a render, because a layout arrives
   * outside change detection and nothing else may be about to render.
   */
  private holdPastHeader(): void {
    const hold = this.maintainVisibleContentPosition();
    if (!hold || this.lastOffset <= (hold.autoscrollToTopThreshold ?? 0)) return;
    this.scrollToOffset({ offset: this.headerHeight() + this.lastOffset, animated: false });
  }

  protected onContentSize(event: NativeSyntheticEvent<{ width?: number; height?: number }>): void {
    const size = event.nativeEvent;
    this.contentSize = (this.horizontal() ? size?.width : size?.height) ?? 0;
  }

  private checkEnd(y: number): void {
    const count = this.items().length;
    const viewport = this.viewport();
    if (!count || !viewport) return;
    const total = this.contentSize || this.headerHeight() + this.extent();
    const distanceFromEnd = total - (y + viewport);
    // Away from the end again re-arms it, as React Native does, so a load that failed is retried
    // the next time the user comes back down.
    if (distanceFromEnd > this.endReachedThreshold() * viewport) {
      this.endReachedFor = -1;
      return;
    }
    if (this.endReachedFor === count) return;
    this.endReachedFor = count;
    this.endReached.emit({ distanceFromEnd });
  }
}

/** Whether a cached slot style already has every one of these props. */
function holds(style: Record<string, unknown>, props: Record<string, unknown>): boolean {
  return Object.entries(props).every(([prop, value]) => style[prop] === value);
}

/**
 * Put on each row's view: `<view [virtualListRow]="row">`. Applies the row's style, and reports
 * the row's layout to the list, which is how a list of rows that size themselves learns how tall
 * each one is.
 */
@Directive({
  selector: '[virtualListRow]',
  host: {
    '[style]': 'row().style',
    // A parked row is not read out: see `PARKED`.
    '[attr.aria-hidden]': 'row().parked ? true : null',
    '(layout)': 'onLayout($event)',
  },
})
export class VirtualListRow<T = unknown> {
  readonly row = input.required<VirtualRow<T>>({ alias: 'virtualListRow' });
  private readonly list = inject<VirtualList<T>>(VirtualList);

  protected onLayout(
    event: NativeSyntheticEvent<{ layout?: { width?: number; height?: number } }>,
  ): void {
    this.list.measureRow(this.row(), event.nativeEvent?.layout);
  }
}
