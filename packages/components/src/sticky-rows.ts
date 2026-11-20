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

/** What `StickyRows` needs of the list whose rows it pins. */
export interface StickyRowsList {
  /** The sticky rows' indices, as `stickyIndices` gives them. */
  readonly indices: Signal<readonly number[]>;
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

/**
 * `<virtual-list>`'s sticky rows: which one holds the leading edge, the style that pins it, the
 * header's pinned style, and, where the host moves views by the scroll on the native side, what
 * native is moving. The list's own share of `stickyIndices` and `stickyHeader`, as `StickyHeaders`
 * is `<scroll-view>`'s.
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
  private readonly pinning = computed(() => this.list.header() || this.list.indices().length > 0);

  /** Each sticky row, and the one after it, which pushes it off. */
  readonly next = computed(() => {
    const sticky = this.list.indices();
    return new Map(sticky.map((index, at) => [index, sticky[at + 1]]));
  });

  /**
   * The sticky row currently holding the leading edge: the last one at or before the offset.
   * Null when the list has scrolled back above the first of them.
   */
  readonly pinned = computed<number | null>(() => {
    const sticky = this.list.indices();
    if (sticky.length === 0) return null;
    const offset = this.offset();

    let pinned: number | null = null;
    for (const index of sticky) {
      if (this.list.topOf(index) <= offset) pinned = index;
      else break;
    }
    return pinned;
  });

  /**
   * The header's translation while it is pinned: the scroll position, held back at zero by an
   * overscroll and at the first sticky row, which pushes it off.
   */
  readonly headerStyle = computed(() => {
    const flip = this.list.flipText();
    if (!this.list.header()) return flip ? { transform: flip } : undefined;
    const along = this.offset() + this.list.headerHeight();
    const first = this.list.indices()[0];
    const limit = first === undefined ? Infinity : this.list.topOf(first);
    const shift = Math.min(Math.max(0, along), limit);
    const move =
      shift > 0 ? `${this.list.horizontal() ? 'translateX' : 'translateY'}(${shift}px)` : '';
    const transform = [move, flip ?? ''].filter(Boolean).join(' ');
    return transform ? { zIndex: 1, transform } : { zIndex: 1 };
  });

  /** A pinned row in flow, moved from where flow put it to the leading edge by a transform. */
  flowStyle(at: number): Record<string, unknown> {
    const shift = Math.max(0, this.offset() - at);
    const move = `${this.list.horizontal() ? 'translateX' : 'translateY'}(${shift}px)`;
    const flip = this.list.flipText();
    return { ...this.list.flowSpacing(), zIndex: 1, transform: flip ? `${move} ${flip}` : move };
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
    style['zIndex'] = 1;
    const top = this.list.topOf(index);
    const shift = Math.min(Math.max(0, this.settled() - top), this.stopOf(index) - top);
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
    if (!this.next().has(index)) return kind;
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
    // A pinned row follows the scroll continuously, so with sticky rows the offset has to be a
    // signal - and only then. Without them this stays out of change detection, and a fling that
    // moves no row in or out of the window costs none.
    if (!this.pinning()) return;
    this.leading.set(offset);
    if (!this.native) return;
    // See `STICKY_SETTLE_MS`.
    clearTimeout(this.settleTimer);
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

  /** Where a sticky row stops, pushed off by the next: that row's top, less this row's size. */
  private stopOf(index: number): number {
    const next = this.next().get(index);
    return next === undefined ? Infinity : this.list.topOf(next) - this.list.heightOf(index);
  }

  /**
   * How native moves a rendered row, or null when it does not: along the scroll view's own
   * offset, which counts the header, from the row's top until the next sticky row pushes it off.
   */
  private driveOf(row: Row): { range: ScrollRange; statics: readonly StaticTransform[] } | null {
    if (!this.native || row.parked || !this.next().has(row.index)) return null;
    const header = this.list.headerHeight();
    const start = header + this.list.topOf(row.index);
    return {
      range: pinnedRange(start, header + this.stopOf(row.index)),
      statics: this.list.flip() ?? [],
    };
  }
}
