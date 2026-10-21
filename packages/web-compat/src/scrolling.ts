import type { EngineNode } from '@ng-native/fabric';
import { border, clientSize, contentOf, drawn, frameOf, layOut } from './geometry.ts';
import {
  distance,
  scrollAsked,
  scrollOf,
  scrollPromise,
  scrollTo,
  type ScrollAsked,
} from './scroll-offset.ts';
import { engineOf } from './window.ts';

/**
 * Scrolling an element: `scrollTop` and `scrollLeft`, `scroll`, `scrollTo`, `scrollBy` and
 * `scrollIntoView`. Only an element that scrolls is scrolled: one that does not stays at the
 * top, as it does in a browser, and native is sent nothing for it.
 */
type Dom = EngineNode & Record<string, (...args: unknown[]) => unknown>;

const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

/**
 * Whether an element scrolls: its style says its overflow scrolls, as of what is written so far,
 * or it is a scroll view of its own. The page does not: nothing scrolls the window here.
 */
function scrolls(node: EngineNode): boolean {
  layOut(engineOf(node));
  return node.scrollView === true || node.tag === 'scroll-view';
}

const clamp = (value: number, most: number) => Math.max(0, Math.min(value, Math.max(0, most)));

const offsetOf = (node: EngineNode) => (scrolls(node) ? scrollOf(node) : { x: 0, y: 0 });

/**
 * Scroll an element to a place, or by a distance, where it scrolls. Not back past its start, and
 * not on past the end of what it holds, where it has been laid out and so has an end.
 */
function scroll(node: EngineNode, asked: ScrollAsked, by: boolean): void {
  if (!scrolls(node)) return;
  const at = scrollOf(node);
  const room = clientSize(node);
  const content = contentOf(node);
  const most = (size: number, held: number) => (size ? held - size : Infinity);
  const to = (now: number, value: number | undefined, end: number) =>
    value === undefined ? now : clamp((by ? now : 0) + value, end);
  scrollTo(
    node,
    to(at.x, asked.left, most(room.width, content.width)),
    to(at.y, asked.top, most(room.height, content.height)),
    asked.smooth,
  );
}

type Align = 'start' | 'center' | 'end' | 'nearest';
const ALIGNS = new Set(['start', 'center', 'end', 'nearest']);

function align(value: unknown, otherwise: Align): Align {
  if (value === undefined) return otherwise;
  if (!ALIGNS.has(String(value))) {
    throw new TypeError(
      `The provided value '${String(value)}' is not a valid ScrollLogicalPosition.`,
    );
  }
  return value as Align;
}

interface IntoView {
  readonly block: Align;
  readonly inline: Align;
  readonly smooth: boolean;
}

/** What `scrollIntoView` was called with: `true` or nothing for the start, `false` for the end. */
function intoViewAsked(arg: unknown): IntoView {
  if (arg === null || (typeof arg !== 'object' && typeof arg !== 'function')) {
    return { block: arg === false ? 'end' : 'start', inline: 'nearest', smooth: false };
  }
  const { block, inline, behavior } = arg as Record<string, unknown>;
  const { smooth } = scrollAsked([{ behavior }]);
  return { block: align(block, 'start'), inline: align(inline, 'nearest'), smooth };
}

/**
 * How far to scroll along one side for a box at `start`, `size` long, to be where it is asked to
 * be in a port at `from`, `room` long. `nearest` moves it the least that shows it, and not at
 * all where it is in sight already or is over the whole of the port.
 */
function along(asked: Align, start: number, size: number, from: number, room: number): number {
  const end = start + size;
  const to = from + room;
  if (asked === 'start') return start - from;
  if (asked === 'end') return end - to;
  if (asked === 'center') return start + size / 2 - (from + room / 2);
  if ((start >= from && end <= to) || (start < from && end > to)) return 0;
  return start < from === size <= room ? start - from : end - to;
}

/**
 * Bring an element into sight: each element it is in that scrolls is scrolled, the nearest
 * first, each by as far as what is in it was moved by those inside it. The window does not
 * scroll here, so nothing is done for it.
 *
 * ponytail: `scroll-margin` and `scroll-padding` are not read. Allow for them if a list that
 * keeps its active item clear of a sticky header is seen to need it.
 */
function intoView(node: EngineNode, asked: IntoView): void {
  if (!drawn(node)) return;
  let { x, y, width, height } = frameOf(node);
  for (let at = node.parent; at; at = at.parent) {
    if (!scrolls(at)) continue;
    const port = frameOf(at);
    const room = clientSize(at);
    if (!room.width && !room.height) continue;
    const now = scrollOf(at);
    const content = contentOf(at);
    const startX = port.x + border(at, 'Left');
    const startY = port.y + border(at, 'Top');
    const left = clamp(
      now.x + along(asked.inline, x, width, startX, room.width),
      content.width - room.width,
    );
    const top = clamp(
      now.y + along(asked.block, y, height, startY, room.height),
      content.height - room.height,
    );
    if (left !== now.x || top !== now.y) scrollTo(at, left, top, asked.smooth);
    x -= left - now.x;
    y -= top - now.y;
  }
}

export const scrollingMembers: PropertyDescriptorMap = {
  // How far it has been scrolled, as native last said, and scrolled to what is written.
  scrollTop: {
    get(this: EngineNode) {
      return offsetOf(this).y;
    },
    set(this: EngineNode, value: unknown) {
      scroll(this, { top: distance(value), smooth: false }, false);
    },
  },
  scrollLeft: {
    get(this: EngineNode) {
      return offsetOf(this).x;
    },
    set(this: EngineNode, value: unknown) {
      scroll(this, { left: distance(value), smooth: false }, false);
    },
  },
  scroll: method(function (...args: unknown[]) {
    return scrollPromise(() => scroll(this, scrollAsked(args), false));
  }),
  scrollTo: method(function (...args: unknown[]) {
    return scrollPromise(() => scroll(this, scrollAsked(args), false));
  }),
  scrollBy: method(function (...args: unknown[]) {
    return scrollPromise(() => scroll(this, scrollAsked(args), true));
  }),
  scrollIntoView: method(function (arg?: unknown) {
    return scrollPromise(() => intoView(this, intoViewAsked(arg)));
  }),
};
