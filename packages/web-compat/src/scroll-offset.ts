import { engineOf } from './window.ts';
import type { EngineNode } from '@ng-native/fabric';

/** How far an element has been scrolled, and the view native said it of. */
interface Offset {
  x: number;
  y: number;
  /** The tag of the view it was heard from: a view made again starts at the top. */
  tag: number | null;
}

/** How far each element asked about has been scrolled: what its last scroll event said. */
const scrolls = new WeakMap<EngineNode, Offset>();

/**
 * How far an element has been scrolled, heard from native from the first time it is asked. A
 * virtual list reads it as it hears a scroll, to render what is then in sight. A view native
 * made again for the element, as where it stopped scrolling or was put back in the page, starts
 * at the top: what was heard of the one before is let go.
 *
 * ponytail: nothing until it is first asked, so an element scrolled before then reads as at the
 * top until it next moves. Listen from when the element starts to scroll if that is ever read.
 */
export function scrollOf(node: EngineNode): Offset {
  const engine = engineOf(node);
  const tag = engine.tagOf(node);
  let at = scrolls.get(node);
  if (at) {
    if (at.tag !== tag) Object.assign(at, { x: 0, y: 0, tag });
    return at;
  }
  scrolls.set(node, (at = { x: 0, y: 0, tag }));
  const heard = at;
  engine.setEventListener(node, 'topScroll', (event) => {
    const offset = (event as { nativeEvent?: { contentOffset?: { x?: number; y?: number } } })
      .nativeEvent?.contentOffset;
    heard.x = offset?.x ?? 0;
    heard.y = offset?.y ?? 0;
    heard.tag = engine.tagOf(node);
  });
  return at;
}

/** Scroll an element to a place, and say it is there: native says so itself as it arrives. */
export function scrollTo(node: EngineNode, x: number, y: number, animated: boolean): void {
  const at = scrollOf(node);
  engineOf(node).dispatchCommand(node, 'scrollTo', [x, y, animated]);
  if (!animated) Object.assign(at, { x, y });
}

/** Where a script asked to scroll to, or by: either side left out stays as it is. */
export interface ScrollAsked {
  readonly left?: number;
  readonly top?: number;
  readonly smooth: boolean;
}

const BEHAVIORS = new Set(['auto', 'instant', 'smooth']);

/** A length to scroll by, as a browser takes one: a number that is none is no distance. */
export const distance = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * What `scroll`, `scrollTo` and `scrollBy` were called with, on an element or the window: two
 * numbers, or a `ScrollToOptions`. One argument that is no object is refused with a `TypeError`,
 * as is a `behavior` that is none of the three, as a browser refuses them.
 */
export function scrollAsked(args: readonly unknown[]): ScrollAsked {
  if (args.length >= 2) return { left: distance(args[0]), top: distance(args[1]), smooth: false };
  const options = args[0] ?? {};
  if (typeof options !== 'object' && typeof options !== 'function') {
    throw new TypeError("The provided value is not of type 'ScrollToOptions'.");
  }
  const { left, top, behavior } = options as { left?: unknown; top?: unknown; behavior?: unknown };
  if (behavior !== undefined && !BEHAVIORS.has(String(behavior))) {
    throw new TypeError(`The provided value '${String(behavior)}' is not a valid ScrollBehavior.`);
  }
  return {
    left: left === undefined ? undefined : distance(left),
    top: top === undefined ? undefined : distance(top),
    smooth: behavior === 'smooth',
  };
}

/**
 * A scroll method as a browser has it now: it answers a promise, settled once the scroll is
 * done, and a call it refuses is a promise refused rather than an error thrown.
 *
 * ponytail: settled at once, a smooth scroll before it arrives. Settle it when native says the
 * scroll ended if a library is seen to wait on one.
 */
export function scrollPromise(scroll: () => void): Promise<void> {
  try {
    scroll();
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}
