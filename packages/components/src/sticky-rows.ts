import { computed, signal, type Signal } from '@angular/core';
import {
  type HostEngine,
  type HostNode,
  type ScrollDrive,
  type ScrollRange,
  type StaticTransform,
  pinnedRange,
} from '@ng-native/fabric';
import { STICKY_SETTLE_MS } from './sticky-headers.ts';
import type { VirtualListSticky } from './virtual-list-sticky.ts';

/** What `StickyRows` needs of the list whose rows it pins. */
export interface StickyRowsList {
  /** The sticky rows' indices, as `stickyIndices` gives them. */
  readonly indices: Signal<readonly number[]>;
  /** The rows' levels, when a directive on the list gives them, read from the items. */
  readonly levels: VirtualListSticky | null;
  readonly items: Signal<readonly unknown[]>;
  /** Whether the list header is pinned too, as `stickyHeader` says. */
  readonly header: Signal<boolean>;
  readonly headerHeight: Signal<number>;
  horizontal(): boolean;
  /** Rows size themselves and are laid out in flow. */
  measuring(): boolean;
  topOf(index: number): number;
  heightOf(index: number): number;
  /** An absolutely positioned row's style, at its own place. */
  slotStyle(index: number): Record<string, unknown>;
  /** What places a row in flow. */
  flowSpacing(): Record<string, unknown>;
  /** The list's flip, as transforms and as CSS text, when it is inverted. */
  flip(): readonly StaticTransform[] | undefined;
  flipText(): string | undefined;
}

/** A row as the list renders it, for what `StickyRows` reads of it. */
interface Row {
  readonly index: number;
  readonly parked?: boolean;
}

/** A sticky row: how deep it is, the rows it pins under, and the row that pushes it off. */
interface StickyRow {
  /** 0 for the outermost. The rows of `stickyIndices` are all at 0. */
  readonly level: number;
  /** The nearest row before it of each level further out, outermost first. */
  readonly above: readonly number[];
  /** The next row at its level or further out, if there is one. */
  next: number | undefined;
}

const NONE: readonly number[] = [];

/**
 * The zIndex of a level 0 row where rows have levels, each level further in one under it. Fixed,
 * not counted from the levels the list holds: a deeper level arriving would otherwise commit new
 * props on every sticky row, and a view native is moving goes back to its place for a frame.
 * Levels this deep and deeper share a zIndex of 1.
 */
const FRONT = 100;

/**
 * `<virtual-list>`'s sticky rows: which hold the leading edge, the style that pins each, the
 * header's pinned style, and, where the host moves views by the scroll on the native side, what
 * native is moving. The list's own share of `stickyIndices` and `stickyHeader`, as `StickyHeaders`
 * is `<scroll-view>`'s.
 *
 * Rows pin at levels, when `virtualListStickyLevel` gives them: a row holds the edge under the
 * rows of the levels further out than its own, and the next row at its level or further out pushes
 * it off. Without levels every sticky row is at level 0, each pushed off by the next.
 *
 * Pinning is not native: RN's `ScrollView.js` translates a sticky child against the scroll offset
 * in JavaScript, and a row here follows the offset the same way while it is the current one, by
 * its `top` when absolutely positioned and by a transform when in flow. Where native can move a
 * view by the scroll, each sticky row instead stays at its own place in the list and native
 * translates it on every frame the list scrolls, as RN's `ScrollViewStickyHeader` does; a
 * translate committed from each scroll event lands a frame or more late, and on a fast fling the
 * row shudders and comes away from the edge.
 */
export class StickyRows {
  /** Whether native moves sticky rows. */
  readonly native: boolean;
  /** The leading edge of the viewport in content space, kept only while anything is pinned. */
  private readonly leading = signal(0);
  readonly offset = this.leading.asReadonly();

  private readonly engine: HostEngine;
  private readonly node: HostNode;
  private readonly list: StickyRowsList;
  /** The offset once scrolling pauses, which the settled translate of a native-moved row is from. */
  private readonly settled = signal(0);
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** What native is moving, by row view, with the transform kept beside the translate. */
  private readonly drives = new Map<HostNode, { drive: ScrollDrive; statics: string }>();
  /** The list scrolled itself, and native has not drawn its sticky rows there yet. */
  private jumped = false;
  /** Native has reported reaching the target, so this pass's drives are the last to need telling. */
  private landed = false;
  /** Where the list scrolled itself to, in the scroll view, which native reports with its event. */
  private jumpedTo = 0;
  /** Whether that scroll is animated, so native is still at its start until it reports. */
  private jumpAnimated = false;
  /** Where native's latest event since the jump said the scroll view was, header and all. */
  private reported: number | undefined;
  /** Where native's latest event of all said it was, header and all. */
  private nativeAt = 0;
  /**
   * Scroll end events still to come, one for each jump that moved native, as iOS sends one. Kept
   * across jumps: one that landed has its end still to come, and must not be taken for the next's.
   */
  private ends = 0;
  /** The recycling type of a sticky row of each `itemType`: apart from plain rows of it. */
  private readonly typeOfKind = new Map<unknown, symbol>();
  private readonly types = new Set<unknown>();

  constructor(engine: HostEngine, node: HostNode, list: StickyRowsList) {
    this.engine = engine;
    this.node = node;
    this.list = list;
    this.native = engine.drivesScroll;
  }

  /** Whether the scroll offset is needed as a signal, which only pinning needs. */
  private readonly pinning = computed(() => this.list.header() || this.rows().size > 0);

  /**
   * Each sticky row's level, in list order: the rows of `stickyIndices` at level 0, and with a
   * level function every row it gives one. Rows that size themselves take level 0 alone: where a
   * deeper row pins depends on the heights of the rows over it. A sticky index given for rows not
   * there yet pins nothing and pushes nothing off until its row arrives.
   */
  private readonly levels = computed<readonly (readonly [index: number, level: number])[]>(() => {
    const indices = this.list.indices();
    const levelOf = this.list.levels?.levelOf();
    const items = this.list.items();
    const levels: [number, number][] = [];
    if (!levelOf) {
      for (const index of indices) if (index < items.length) levels.push([index, 0]);
      return levels;
    }
    const outermost = new Set(indices);
    const flow = this.list.measuring();
    items.forEach((item, index) => {
      const level = outermost.has(index) ? 0 : levelOf(item, index);
      if (level !== null && !(flow && level > 0)) levels.push([index, level]);
    });
    return levels;
  });

  /** Each sticky row, with the rows it pins under and the one that pushes it off. */
  readonly rows = computed(() => {
    const rows = new Map<number, StickyRow>();
    // The rows a row here would pin under: each deeper than the one before it.
    const open: number[] = [];
    for (const [index, level] of this.levels()) {
      while (open.length > 0 && rows.get(open.at(-1)!)!.level >= level) {
        rows.get(open.pop()!)!.next = index;
      }
      rows.set(index, { level, above: [...open], next: undefined });
      open.push(index);
    }
    return rows;
  });

  /**
   * For each sticky row in list order, the least offset that reaches it or a row after it. Where a
   * row starts to hold never comes before where the row before it does, unless a negative `rowGap`
   * overlaps the rows, and this stays in order either way, so `pinned` can halve over it.
   */
  private readonly reach = computed(() => {
    const order = this.levels();
    const reach = new Array<number>(order.length);
    let least = Infinity;
    for (let at = order.length - 1; at >= 0; at--) {
      least = Math.min(least, this.startOf(order[at]![0]));
      reach[at] = least;
    }
    return reach;
  });

  /**
   * The sticky rows currently holding the leading edge, outermost first: the last one the offset
   * has reached, under the rows it pins under. Empty when the list has scrolled back above the
   * first of them.
   */
  readonly pinned = computed<readonly number[]>(
    () => {
      const order = this.levels();
      if (order.length === 0) return NONE;
      const offset = this.offset();

      // The last row the offset has reached is the last whose `reach` it has, found by halving.
      const reach = this.reach();
      let low = 0;
      let high = order.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (reach[middle]! <= offset) low = middle + 1;
        else high = middle;
      }
      if (low === 0) return NONE;
      const pinned = order[low - 1]![0];
      return [...this.rows().get(pinned)!.above, pinned];
    },
    // The same rows are the same pinning: where native moves them, a scroll then re-renders none.
    { equal: (a, b) => a.length === b.length && a.every((index, at) => index === b[at]) },
  );

  /**
   * The header's translation while it is pinned: the scroll position, held back at zero by an
   * overscroll and at the first sticky row, which pushes it off.
   */
  readonly headerStyle = computed(() => {
    const flip = this.list.flipText();
    if (!this.list.header()) return flip ? { transform: flip } : undefined;
    const along = this.offset() + this.list.headerHeight();
    const [first] = this.rows().keys();
    const limit = first === undefined ? Infinity : this.list.topOf(first);
    const shift = Math.min(Math.max(0, along), limit);
    const move =
      shift > 0 ? `${this.list.horizontal() ? 'translateX' : 'translateY'}(${shift}px)` : '';
    const transform = [move, flip ?? ''].filter(Boolean).join(' ');
    return transform ? { zIndex: 1, transform } : { zIndex: 1 };
  });

  /**
   * The pinned row `index` in flow, moved by a transform from `at`, where flow put it, to the leading
   * edge, until the next sticky row reaches it there and pushes it off.
   */
  flowStyle(index: number, at: number): Record<string, unknown> {
    const shift = Math.max(0, Math.min(this.offset(), this.stopOf(index)) - at);
    const move = `${this.list.horizontal() ? 'translateX' : 'translateY'}(${shift}px)`;
    const flip = this.list.flipText();
    return { ...this.list.flowSpacing(), zIndex: 1, transform: flip ? `${move} ${flip}` : move };
  }

  /**
   * A pinned row placed by its `top`: under the rows it pins under, until the next row at its
   * level or further out reaches it there and pushes it off.
   */
  slotStyle(index: number): Record<string, unknown> {
    const at = Math.min(this.offset(), this.stopOf(index)) + this.above(index);
    return {
      ...this.list.slotStyle(index),
      [this.list.horizontal() ? 'left' : 'top']: at,
      zIndex: this.zIndexOf(index),
    };
  }

  /**
   * A sticky row native moves: at its own place, with the translate native had reached when
   * scrolling paused, so the props agree with what is on screen.
   */
  style(index: number): Record<string, unknown> {
    const horizontal = this.list.horizontal();
    const style: Record<string, unknown> = this.list.measuring()
      ? { ...this.list.flowSpacing() }
      : { ...this.list.slotStyle(index) };
    style['zIndex'] = this.zIndexOf(index);
    const start = this.startOf(index);
    const shift = Math.min(Math.max(0, this.settled() - start), this.stopOf(index) - start);
    const move = shift > 0 ? `${horizontal ? 'translateX' : 'translateY'}(${shift}px)` : '';
    const transform = [move, this.list.flipText() ?? ''].filter(Boolean).join(' ');
    if (transform) style['transform'] = transform;
    return style;
  }

  /**
   * The recycling type of a row: a sticky row is a type of its own, since native keeps the
   * translate it moved one by, and a plain row taking its slot commits no transform to put it
   * back. Apart from that, `kind`, the row's `itemType`.
   */
  recyclingType(index: number, kind: unknown): unknown {
    if (!this.rows().has(index)) return kind;
    let type = this.typeOfKind.get(kind);
    if (!type) {
      type = Symbol('sticky');
      this.typeOfKind.set(kind, type);
      this.types.add(type);
    }
    return type;
  }

  /** Whether a recycling type is a sticky row's. */
  isType(type: unknown): boolean {
    return this.types.has(type);
  }

  /** The list scrolled, to `offset` in content space and `along` in the scroll view. */
  scrolled(offset: number, along: number): void {
    this.nativeAt = along;
    if (this.jumped) {
      this.reported = along;
      // An event from before the jump, or on the way, is not where it lands.
      if (Math.abs(along - this.jumpedTo) <= 1) this.landed = true;
    }
    // A pinned row follows the scroll continuously, so the offset is a signal. Nothing reads it
    // until a row or the header is pinned, so without them this stays out of change detection,
    // and a fling that moves no row in or out of the window costs none. It is kept all the same:
    // a row that turns sticky in a scrolled list is pinned where the list is, not where it was.
    this.leading.set(offset);
    if (!this.native) return;
    clearTimeout(this.settleTimer);
    if (!this.pinning()) return this.settled.set(offset);
    // See `STICKY_SETTLE_MS`.
    this.settleTimer = setTimeout(() => this.settled.set(offset), STICKY_SETTLE_MS);
  }

  /** The list is scrolling itself, to `to` in the scroll view, where native has not drawn yet. */
  jumping(to: number, animated: boolean): void {
    // To where native last said it was, with no earlier jump on its way: it moves nothing and
    // reports nothing. With one, native moves and comes back, and reports that.
    const pending = this.jumped && !this.landed;
    if (Math.abs(to - (pending ? this.jumpedTo : this.nativeAt)) > 1) this.ends++;
    this.jumped = pending || Math.abs(to - this.nativeAt) > 1;
    this.landed = false;
    this.jumpedTo = to;
    this.jumpAnimated = animated;
    this.reported = undefined;
  }

  /** The user took the scroll over: native's own events move the rows from here. */
  dragged(): void {
    this.jumped = this.landed = false;
    // Android sends no end for a jump that is not animated, so none is waited for past a drag.
    this.ends = 0;
  }

  /**
   * A scroll came to rest. The last of the jumps on their way has landed, wherever it did: iOS
   * does not stop a scroll at the end of the content, so it can rest past where the list said,
   * and what moves it next (a tap on the status bar) is not a drag.
   */
  rested(): void {
    if (this.ends > 0) this.ends--;
    if (this.jumped && this.ends === 0) this.landed = true;
  }

  /**
   * Hand each rendered sticky row's view to native to move, and let go of the rest. `views` are
   * the rendered rows' views in the same order as `rows`. Each is only asked for where there is a
   * drive to make or let go.
   */
  drive(rows: () => readonly Row[], views: () => readonly HostNode[]): void {
    if (!this.pinning() && this.drives.size === 0) return;
    const rendered = views();
    const axis = this.list.horizontal() ? 'x' : 'y';
    const live = new Set<HostNode>();
    // After the list scrolled itself, where native is: it draws a graph when its offset changes,
    // and after a jump the offset of a drive just made may not. What native last reported, or
    // before it has, the target of a jump that is not animated. An animated one only once it has
    // landed: on the way native's offset changes every frame, so it draws a new graph anyway, and
    // the offset here trails native's and would set every pinned row back a frame. The same holds
    // mid-fling, which is why nothing is told outside a jump.
    const from = !this.jumped
      ? undefined
      : this.jumpAnimated
        ? this.landed
          ? this.reported
          : undefined
        : (this.reported ?? this.jumpedTo);
    rows().forEach((row, at) => {
      const view = rendered[at];
      const next = this.driveOf(row);
      if (!view || !next) return;
      live.add(view);
      const statics = JSON.stringify(next.statics);
      const held = this.drives.get(view);
      if (held?.statics === statics) return held.drive.update(next.range, from);
      held?.drive.stop();
      const drive = this.engine.driveByScroll(
        view,
        this.node,
        axis,
        next.range,
        next.statics,
        from,
      );
      if (drive) this.drives.set(view, { drive, statics });
    });
    for (const [view, held] of this.drives) {
      if (live.has(view)) continue;
      held.drive.stop();
      this.drives.delete(view);
    }
    if (this.landed) this.jumped = this.landed = false;
  }

  destroy(): void {
    clearTimeout(this.settleTimer);
    for (const held of this.drives.values()) held.drive.stop();
  }

  /** The size of the rows a sticky row pins under, which is how far from the edge it holds. */
  private above(index: number): number {
    let size = 0;
    for (const over of this.rows().get(index)?.above ?? NONE) size += this.list.heightOf(over);
    return size;
  }

  /**
   * A deeper row is drawn under the rows it pins under, and every sticky row over the rest. See
   * `FRONT`. Without levels a sticky row's zIndex is 1, as it was before there were any.
   */
  private zIndexOf(index: number): number {
    if (!this.list.levels?.levelOf()) return 1;
    return Math.max(1, FRONT - (this.rows().get(index)?.level ?? 0));
  }

  /** The offset a sticky row starts to hold from: where its top meets the rows it pins under. */
  private startOf(index: number): number {
    return this.list.topOf(index) - this.above(index);
  }

  /**
   * The offset a sticky row stops holding at, pushed off by the next: where that row's top meets
   * this row's far edge.
   */
  private stopOf(index: number): number {
    const next = this.rows().get(index)?.next;
    if (next === undefined) return Infinity;
    return this.list.topOf(next) - this.list.heightOf(index) - this.above(index);
  }

  /**
   * How native moves a rendered row, or null when it does not: along the scroll view's own
   * offset, which counts the header, from where the row meets the rows it pins under until the
   * next sticky row pushes it off. A row the next one follows with no space between them holds
   * nowhere, so native moves it nowhere: it is not let go, since native keeps the translate it
   * had moved a row by.
   */
  private driveOf(row: Row): { range: ScrollRange; statics: readonly StaticTransform[] } | null {
    if (!this.native || row.parked || !this.rows().has(row.index)) return null;
    const header = this.list.headerHeight();
    const start = header + this.startOf(row.index);
    const stop = header + this.stopOf(row.index);
    return {
      range:
        stop > start ? pinnedRange(start, stop) : { input: [start, start + 1], output: [0, 0] },
      statics: this.list.flip() ?? [],
    };
  }
}
