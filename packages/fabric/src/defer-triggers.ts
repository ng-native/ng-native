/**
 * What Angular's `@defer (on interaction | hover | viewport)` asks of a trigger element, for the
 * engine's nodes.
 *
 * Angular registers those three triggers on the element itself rather than through `Renderer2`:
 * it asserts in development that the element is an `Element`, listens with `addEventListener`,
 * and watches for visibility with a global `IntersectionObserver`. An engine node was none of
 * those, so the placeholder stayed forever and every render logged an assertion. The listeners
 * are on the node (`addEventListener` in `engine.ts`); this is the other two.
 *
 * `installDeferTriggers` runs once, from `mount()`, before anything renders.
 */
import { isEngineNode, viewNameOf, type EngineNode, type WindowFrame } from './engine.ts';

/** The views a node scrolls inside of, and whose scrolling can bring it into view. */
const SCROLLERS = new Set(['ScrollView', 'AndroidHorizontalScrollView']);

interface Entry {
  readonly target: EngineNode;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
}

type Callback = (entries: Entry[], observer: EngineIntersectionObserver) => void;

interface Options {
  readonly threshold?: number | readonly number[];
}

interface Watched {
  readonly stops: (() => void)[];
}

/**
 * Visibility for engine nodes, from the layout and scroll events native already sends.
 *
 * A node is checked when it is observed, when it is laid out, and whenever a scroll view it sits
 * in scrolls. The check measures the node in window coordinates, clips it by each scroll view
 * around it and by the window, and reports it intersecting once the visible share reaches the
 * threshold: any of it by default, as the web does, and a node of no size counts once its position
 * is inside. `root` and `rootMargin` are not applied; the root is always the window.
 */
export class EngineIntersectionObserver {
  private readonly callback: Callback;
  private readonly threshold: number;
  private readonly watched = new Map<EngineNode, Watched>();

  constructor(callback: Callback, options?: Options) {
    this.callback = callback;
    const threshold = options?.threshold;
    this.threshold = Array.isArray(threshold)
      ? Math.min(...(threshold as number[]))
      : ((threshold as number | undefined) ?? 0);
  }

  observe(target: EngineNode): void {
    if (this.watched.has(target)) return;
    const check = () => this.check(target);
    const stops = [target.host!.setEventListener(target, 'topLayout', check)];
    for (let at = target.parent; at; at = at.parent) {
      if (!SCROLLERS.has(viewNameOf(at))) continue;
      stops.push(at.host!.setEventListener(at, 'topScroll', check));
    }
    this.watched.set(target, { stops });
    // A node laid out before it was observed sends no layout event of its own. Measured now,
    // after the commit that mounted it, and in a microtask, as an observer never calls back from
    // inside `observe`.
    queueMicrotask(check);
  }

  unobserve(target: EngineNode): void {
    const watched = this.watched.get(target);
    if (!watched) return;
    for (const stop of watched.stops) stop();
    this.watched.delete(target);
  }

  disconnect(): void {
    for (const target of [...this.watched.keys()]) this.unobserve(target);
  }

  takeRecords(): Entry[] {
    return [];
  }

  private check(target: EngineNode): void {
    if (!this.watched.has(target)) return;
    const ratio = visibleShare(target);
    if (ratio === null) return;
    const isIntersecting = this.threshold > 0 ? ratio >= this.threshold : ratio >= 0;
    if (isIntersecting) this.callback([{ target, isIntersecting, intersectionRatio: ratio }], this);
  }
}

/** A frame as its four edges. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const box = (frame: WindowFrame): Box => ({
  left: frame.x,
  top: frame.y,
  right: frame.x + frame.width,
  bottom: frame.y + frame.height,
});

function measured(node: EngineNode): Box | null {
  let found: Box | null = null;
  node.host!.measure(node, (frame) => (found = box(frame)));
  return found;
}

function clip(into: Box, by: Box): void {
  into.left = Math.max(into.left, by.left);
  into.top = Math.max(into.top, by.top);
  into.right = Math.min(into.right, by.right);
  into.bottom = Math.min(into.bottom, by.bottom);
}

/**
 * How much of the node is on screen, from 0 to 1; below 0 when none of it is, and null when it
 * has not been measured. Measuring is synchronous on the new architecture.
 */
function visibleShare(target: EngineNode): number | null {
  const frame = measured(target);
  if (!frame) return null;
  const visible = { ...frame };
  for (let at = target.parent; at; at = at.parent) {
    if (!SCROLLERS.has(viewNameOf(at))) continue;
    const scroller = measured(at);
    if (scroller) clip(visible, scroller);
  }
  const window = (target.host as { viewport?: { width: number; height: number } }).viewport;
  if (window && window.width > 0 && window.height > 0) {
    clip(visible, { left: 0, top: 0, right: window.width, bottom: window.height });
  }
  const width = visible.right - visible.left;
  const height = visible.bottom - visible.top;
  if (width < 0 || height < 0) return -1;
  const area = (frame.right - frame.left) * (frame.bottom - frame.top);
  return area > 0 ? (width * height) / area : 1;
}

type Constructor = abstract new (...args: never[]) => object;

/** React Native's own `IntersectionObserver`, when its feature flag has installed one. */
interface NativeObserver {
  observe(target: unknown): void;
  unobserve(target: unknown): void;
  disconnect(): void;
}
type NativeObserverClass = new (callback: unknown, options?: unknown) => NativeObserver;

// Never reset: the globals it patches stay patched for the life of the process.
let installed = false;

/**
 * Let an engine node pass Angular's development check that a trigger is an `Element`, and give
 * `@defer (on viewport)` an `IntersectionObserver` that can watch one.
 *
 * React Native defines a global `Element` for its own DOM-like nodes, so an engine node is made to
 * answer `instanceof Element` as well, and nothing else about that class changes. Node has none,
 * and gets one that only engine nodes are instances of. An `IntersectionObserver` React Native
 * already has is kept for its own nodes; engine nodes are watched by the one above.
 */
export function installDeferTriggers(): void {
  if (installed) return;
  installed = true;
  const scope = globalThis as unknown as Record<string, unknown>;

  const existing = scope['Element'] as Constructor | undefined;
  if (existing) {
    // Its own check if it defines one, and the ordinary prototype walk if not.
    const own = existing[Symbol.hasInstance];
    Object.defineProperty(existing, Symbol.hasInstance, {
      configurable: true,
      value(this: Constructor, value: unknown): boolean {
        return (this === existing && isEngineNode(value)) || own.call(this, value);
      },
    });
  } else {
    scope['Element'] = class Element {
      static [Symbol.hasInstance](value: unknown): boolean {
        return isEngineNode(value);
      }
    };
  }

  const native = scope['IntersectionObserver'] as NativeObserverClass | undefined;
  if (!native) {
    scope['IntersectionObserver'] = EngineIntersectionObserver;
    return;
  }
  scope['IntersectionObserver'] = class extends EngineIntersectionObserver {
    private readonly args: [unknown, unknown];
    private other: NativeObserver | null = null;

    constructor(callback: Callback, options?: Options) {
      super(callback, options);
      this.args = [callback, options];
    }

    override observe(target: EngineNode): void {
      if (isEngineNode(target)) super.observe(target);
      else (this.other ??= new native(...this.args)).observe(target);
    }

    override unobserve(target: EngineNode): void {
      if (isEngineNode(target)) super.unobserve(target);
      else this.other?.unobserve(target);
    }

    override disconnect(): void {
      super.disconnect();
      this.other?.disconnect();
    }
  };
}
