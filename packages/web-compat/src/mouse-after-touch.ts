import type { Engine, EngineNode } from '@ng-native/fabric';

/**
 * The mouse events a touch is told as, in the order a phone's browser tells them where a page
 * hears touches itself.
 *
 * A library that hears only the mouse is told of a touch as the mouse going down as the finger
 * does, and up as it lifts, so a handle it drags follows a finger. One that hears the touch too
 * expects a browser: the touch events, then, for a tap of one finger alone, the mouse going down
 * and up after the touch has ended, and for a drag or a pinch no mouse at all. Told both at once,
 * a chart that ends a pinch on the touch's end found it ended already by the mouse's.
 */

/** The touch events, by their DOM names. */
export const TOUCH_EVENTS = new Set(['touchstart', 'touchmove', 'touchend', 'touchcancel']);

/** The mouse events a touch is told as. */
export const MOUSE_OF_TOUCH = new Set(['mousedown', 'mouseup']);

/** How many touch listeners each element has. */
const onElement = new WeakMap<EngineNode, number>();

/** A touch in progress: how many fingers it came to, whether it moved, and the mouse it owes. */
interface Tap {
  fingers: number;
  readonly from: { x: number; y: number };
  moved: boolean;
  readonly due: (() => void)[];
  /** The finger coming down that began it. */
  readonly start: unknown;
}

const taps = new WeakMap<Engine, Tap>();
const watched = new WeakSet<Engine>();

/** How far a finger wanders in a tap: further is a drag, which a browser tells no mouse of. */
const SLOP = 10;

/**
 * Count a touch listener added on an element, answering how to take it away again. One on the
 * document is not counted: see `heardAsTouch`.
 */
export function heardTouch(engine: Engine, node: EngineNode): () => void {
  watch(engine);
  const count = (by: number) => onElement.set(node, (onElement.get(node) ?? 0) + by);
  count(1);
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    count(-1);
  };
}

/**
 * Whether a touch on `target` is heard as a touch by it or by what it is in. One heard only by
 * the document is not: Material's ripple hears the touch there and draws from the mouse going
 * down with the finger, and a library that delegates from the document hears both.
 */
function heardAsTouch(target: EngineNode | null | undefined): boolean {
  for (let at = target; at; at = at.parent) if ((onElement.get(at) ?? 0) > 0) return true;
  return false;
}

interface Fingers {
  readonly target?: EngineNode | null;
  readonly nativeEvent?: {
    readonly pageX?: number;
    readonly pageY?: number;
    readonly touches?: readonly unknown[];
  };
}

const placeOf = (event: Fingers) => ({
  x: event.nativeEvent?.pageX ?? 0,
  y: event.nativeEvent?.pageY ?? 0,
});

/**
 * The touch a finger coming down is part of: the one in progress, or a new one. Asked by the
 * first to hear it, an element's listener before the page's.
 */
function begin(engine: Engine, event: unknown): Tap {
  const fingers = (event as Fingers).nativeEvent?.touches?.length ?? 1;
  const tap = taps.get(engine);
  // A finger alone that is not the one that began it starts a new touch: the end of the last
  // was told to a view gone before it lifted, which nothing heard, and the mouse it owed is not.
  if (tap && (tap.start === event || fingers > 1)) {
    tap.fingers = Math.max(tap.fingers, fingers);
    return tap;
  }
  const made = { fingers, from: placeOf(event as Fingers), moved: false, due: [], start: event };
  taps.set(engine, made);
  return made;
}

/** Follow each touch of an app: its fingers, how far it went, and the mouse due after it. */
function watch(engine: Engine): void {
  if (watched.has(engine)) return;
  watched.add(engine);
  engine.setEventListener(engine.root, 'topTouchStart', (event) => void begin(engine, event));
  engine.setEventListener(engine.root, 'topTouchMove', (event) => {
    const tap = taps.get(engine);
    if (!tap) return;
    const at = placeOf(event as Fingers);
    tap.fingers = Math.max(tap.fingers, (event as Fingers).nativeEvent?.touches?.length ?? 1);
    if (Math.hypot(at.x - tap.from.x, at.y - tap.from.y) > SLOP) tap.moved = true;
  });
  const end = (tapped: boolean) => (event: unknown) => {
    const tap = taps.get(engine);
    if (!tap || (event as Fingers).nativeEvent?.touches?.length) return;
    // After every listener of the end, a mouse listener on the document among them.
    setTimeout(() => {
      if (taps.get(engine) === tap) taps.delete(engine);
      if (tapped && tap.fingers === 1 && !tap.moved) for (const run of tap.due) run();
    });
  };
  engine.setEventListener(engine.root, 'topTouchEnd', end(true));
  engine.setEventListener(engine.root, 'topTouchCancel', end(false));
}

/**
 * Tell a listener of the mouse event a touch is: now, where nothing hears the touch itself, and
 * otherwise once the touch is over, if it was a tap.
 */
export function asMouse(engine: Engine, type: string, event: unknown, tell: () => void): void {
  if (!heardAsTouch((event as Fingers).target)) return tell();
  const tap = type === 'mousedown' ? begin(engine, event) : taps.get(engine);
  if (tap) tap.due.push(tell);
}
