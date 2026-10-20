import type { Engine, EngineNode } from '@ng-native/fabric';
import { watchCommits } from './commit-watch.ts';
import { DOMRectReadOnly } from './dom-rect.ts';
import { documentOf } from './document.ts';
import { domError } from './dom-error.ts';
import { report } from './events.ts';
import { border, clientSize, drawn, frameOf, isTable, styled } from './geometry.ts';
import { asElement } from './resize-observer.ts';
import { engineOf, listenToResize, windowSize } from './window.ts';
import { oncePerFrame } from './next-frame.ts';

/**
 * `IntersectionObserver`: how much of each element it watches is in sight, in the window or in
 * an element it is given as its root, worked out from where native draws each one. Looked at in
 * the frame after anything can have moved one: it was watched, the engine committed, native laid
 * it out again, a scroll view it is in scrolled, or the window changed size. An entry is told
 * where an element crossed one of the thresholds, or came into sight or went out of it, and the
 * first time it is looked at, always, as in a browser.
 *
 * ponytail: `trackVisibility` is taken and answered as asked, and `isVisible` is never true:
 * nothing here tells whether something is drawn over an element. Read it from what is drawn
 * above it if a library is seen to wait for it.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One side of a margin: points, or a share of the root's size. */
interface Side {
  readonly value: number;
  readonly unit: 'px' | '%';
}

interface Observation {
  readonly target: EngineNode;
  previousThresholdIndex: number;
  previousIsIntersecting: boolean;
  readonly stops: (() => void)[];
}

interface State {
  readonly callback: Callback;
  readonly root: EngineNode | object | null;
  readonly margin: readonly Side[];
  readonly scrollMargin: readonly Side[];
  readonly thresholds: readonly number[];
  readonly delay: number;
  readonly trackVisibility: boolean;
  readonly observations: Map<EngineNode, Observation>;
  readonly queue: IntersectionObserverEntry[];
  delivering: boolean;
  /** What was asked for, for the observer an app that did not ask for the package is given. */
  readonly options: Options;
  /** That observer, made the first time it is asked to watch an element of such an app. */
  other?: Watcher;
}

/** An observer as the one there was before this package's: what it watches with. */
interface Watcher {
  observe(target: unknown): void;
  unobserve(target: unknown): void;
  disconnect(): void;
}
type WatcherClass = new (callback: (entries: never[]) => void, options?: unknown) => Watcher;

/**
 * The observer there was before this package's, the engine's own: what watches an element of an
 * app that did not ask for the package, as it would without it.
 */
let others: WatcherClass | undefined;

/** Watch the elements of an app that did not ask with `before`, while this one is the global. */
export function watchOthersWith(before: unknown): void {
  others = typeof before === 'function' ? (before as WatcherClass) : undefined;
}

type Callback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

const states = new WeakMap<IntersectionObserver, State>();

function stateOf(observer: IntersectionObserver): State {
  const state = states.get(observer);
  if (!state) throw new TypeError('Illegal invocation');
  return state;
}

/** Points in each absolute unit a margin can be written in. */
const ABSOLUTE: Readonly<Record<string, number>> = {
  px: 1,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  in: 96,
  pt: 96 / 72,
  pc: 16,
};

/** A margin as it is written: one to four absolute lengths or percentages, or a `SyntaxError`. */
function marginOf(text: unknown, name: string): Side[] {
  const words = String(text ?? '0px')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) words.push('0px');
  const sides = words.map((word) => {
    const found = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%|cm|mm|q|in|pt|pc)$/i.exec(word);
    if (!found || words.length > 4) {
      throw domError(
        `Failed to construct 'IntersectionObserver': ${name} must be specified in pixels or percent.`,
        'SyntaxError',
      );
    }
    const unit = found[2]!.toLowerCase();
    if (unit === '%') return { value: Number(found[1]), unit: '%' } as const;
    // An absolute length is kept in whole points, as a browser keeps it.
    return { value: Math.trunc(Number(found[1]) * ABSOLUTE[unit]!), unit: 'px' } as const;
  });
  const [top, right = top!, bottom = top!, left = right] = sides;
  return [top!, right, bottom, left];
}

const marginText = (sides: readonly Side[]) =>
  sides.map((side) => `${side.value}${side.unit}`).join(' ');

/** The thresholds as a browser keeps them: each a number from 0 to 1, in order. */
function thresholdsOf(given: unknown): number[] {
  const list = (Array.isArray(given) ? given : [given ?? 0]).map((each) => {
    const value = Number(each);
    if (Number.isNaN(value)) throw new TypeError('The provided double value is non-finite.');
    if (value < 0 || value > 1) {
      throw new RangeError('Threshold values must be numbers between 0 and 1');
    }
    return value;
  });
  return list.length ? list.sort((a, b) => a - b) : [0];
}

/** A root a script may give: an element, a document, or none for the window. */
function rootOf(root: unknown): EngineNode | object | null {
  if (root == null) return null;
  const node = root as { nodeKind?: unknown; nodeType?: unknown };
  if (node.nodeKind === 'element' || node.nodeType === 9) return root as object;
  throw new TypeError(
    "Failed to construct 'IntersectionObserver': root is not an Element or a Document.",
  );
}

const isElement = (root: unknown): root is EngineNode =>
  (root as { nodeKind?: unknown } | null)?.nodeKind === 'element';

/** Whether a box is a scroll view, which moves what is in it as it scrolls. */
const scrollsItself = (node: EngineNode): boolean =>
  node.scrollView === true || node.tag === 'scroll-view';

/**
 * Whether an element clips what is in it: it scrolls, or its overflow is not to be seen. A table
 * clips only where its overflow is hidden: Chrome draws one that scrolls as one that does not.
 */
const clips = (node: EngineNode): boolean => {
  const overflow = String(styled(node, 'overflow'));
  if (isTable(node)) return overflow === 'hidden' || overflow === 'clip';
  return scrollsItself(node) || ['hidden', 'clip', 'scroll', 'auto'].includes(overflow);
};

/** The box an element clips what it holds to: inside its border, a table's as well. */
function paddingBox(node: EngineNode): Rect {
  const frame = frameOf(node);
  const inside = clientSize(node);
  const x = frame.x + border(node, 'Left');
  const y = frame.y + border(node, 'Top');
  return { x, y, width: inside.width, height: inside.height };
}

/** A box grown on each side by a margin, a share of its own size where a side is in `%`. */
function grown(rect: Rect, margin: readonly Side[]): Rect {
  const [top, right, bottom, left] = margin.map((side, at) =>
    side.unit === 'px' ? side.value : (side.value / 100) * (at % 2 ? rect.width : rect.height),
  ) as [number, number, number, number];
  return {
    x: rect.x - left,
    y: rect.y - top,
    width: rect.width + left + right,
    height: rect.height + top + bottom,
  };
}

/** Where two boxes meet, an edge counting: nothing where they do not. */
function meet(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The window, or the root element's box, grown by the margin: nothing for a root not drawn. */
function rootBox(state: State, engine: Engine): Rect | null {
  const { root } = state;
  if (!isElement(root)) return grown({ x: 0, y: 0, ...windowSize(engine) }, state.margin);
  if (!drawn(root)) return null;
  return grown(clips(root) ? paddingBox(root) : frameOf(root), state.margin);
}

const contains = (root: EngineNode, node: EngineNode) => {
  for (let at = node.parent; at; at = at.parent) if (at === root) return true;
  return false;
};

/** What of a target is in sight of the root: clipped by each box it is in, then by the root. */
function inSight(state: State, target: EngineNode, from: Rect, root: Rect): Rect | null {
  let visible: Rect | null = from;
  const end = isElement(state.root) ? state.root : engineOf(target).root;
  for (let at = target.parent; at && at !== end && visible; at = at.parent) {
    if (clips(at)) visible = meet(visible, grown(paddingBox(at), state.scrollMargin));
  }
  return visible && meet(visible, root);
}

const area = (rect: Rect) => rect.width * rect.height;
const asRect = (rect: Rect | null) =>
  rect ? new DOMRectReadOnly(rect.x, rect.y, rect.width, rect.height) : new DOMRectReadOnly();

/** Where a target is, where its root is, and how much of the one is in sight of the other. */
function measured(state: State, target: EngineNode) {
  const root = rootBox(state, engineOf(target));
  const bounds = drawn(target) ? frameOf(target) : null;
  const inRoot = !isElement(state.root) || contains(state.root, target);
  const meeting = bounds && root && inRoot ? inSight(state, target, bounds, root) : null;
  const whole = bounds ? area(bounds) : 0;
  // One of no size is wholly in sight where it is in sight at all.
  const ratio = whole > 0 && meeting ? area(meeting) / whole : +(meeting !== null);
  return { root, bounds, meeting, ratio };
}

/** Look at one target: an entry, where it crossed a threshold or came into or out of sight. */
function look(observer: IntersectionObserver, state: State, observation: Observation): void {
  const { target } = observation;
  const { root, bounds, meeting, ratio } = measured(state, target);
  const isIntersecting = meeting !== null;
  const crossed = state.thresholds.findIndex((threshold) => threshold > ratio);
  const thresholdIndex = crossed === -1 ? state.thresholds.length : crossed;
  if (
    thresholdIndex === observation.previousThresholdIndex &&
    isIntersecting === observation.previousIsIntersecting
  ) {
    return;
  }
  observation.previousThresholdIndex = thresholdIndex;
  observation.previousIsIntersecting = isIntersecting;
  state.queue.push(
    new IntersectionObserverEntry({
      time: performance.now(),
      rootBounds: root ? asRect(root) : null,
      boundingClientRect: asRect(bounds),
      intersectionRect: asRect(meeting),
      isIntersecting,
      intersectionRatio: ratio,
      isVisible: false,
      target,
    }),
  );
  deliverLater(observer, state);
}

/** Tell the callback what is queued, in a task after the frame, as a browser queues it. */
function deliverLater(observer: IntersectionObserver, state: State): void {
  if (state.delivering) return;
  state.delivering = true;
  setTimeout(() => {
    state.delivering = false;
    const entries = state.queue.splice(0);
    if (!entries.length) return;
    try {
      state.callback.call(observer, entries, observer);
    } catch (error) {
      report(error);
    }
  });
}

/** The observers with an element to look at. */
const live = new Set<IntersectionObserver>();

const lookNextFrame = oncePerFrame(() => {
  for (const observer of [...live]) {
    const state = states.get(observer)!;
    for (const observation of [...state.observations.values()]) look(observer, state, observation);
  }
});

function schedule(): void {
  if (live.size) lookNextFrame();
}

/**
 * What can move an element: its own layout, a scroll of anything it is in, a commit of its app
 * and the window changing size. Each is heard while it is watched: see `commit-watch.ts`. What
 * it is in is looked at again after each commit, as a box can start or stop scrolling, and the
 * element can be moved into another.
 */
function watchTarget(target: EngineNode): (() => void)[] {
  const engine = engineOf(target);
  const look = () => schedule();
  const scrollers = new Map<EngineNode, () => void>();
  const followScrolls = () => {
    const now = new Set<EngineNode>();
    for (let at = target.parent; at; at = at.parent) if (scrollsItself(at)) now.add(at);
    for (const [scroller, stop] of scrollers) {
      if (now.has(scroller)) continue;
      stop();
      scrollers.delete(scroller);
    }
    for (const scroller of now) {
      if (!scrollers.has(scroller)) {
        scrollers.set(scroller, engine.setEventListener(scroller, 'topScroll', look));
      }
    }
  };
  followScrolls();
  return [
    engine.setEventListener(target, 'topLayout', look),
    watchCommits(engine, () => {
      followScrolls();
      look();
    }),
    listenToResize(engine, look),
    () => {
      for (const stop of scrollers.values()) stop();
      scrollers.clear();
    },
  ];
}

interface Options {
  readonly root?: unknown;
  readonly rootMargin?: unknown;
  readonly scrollMargin?: unknown;
  readonly threshold?: unknown;
  readonly delay?: unknown;
  readonly trackVisibility?: unknown;
}

export class IntersectionObserver {
  constructor(callback: Callback, options?: Options | null) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        "Failed to construct 'IntersectionObserver': The callback is not a function.",
      );
    }
    const given = options ?? {};
    const trackVisibility = !!given.trackVisibility;
    const delay = Number(given.delay ?? 0) || 0;
    states.set(this, {
      callback,
      root: rootOf(given.root),
      margin: marginOf(given.rootMargin, 'rootMargin'),
      scrollMargin: marginOf(given.scrollMargin, 'scrollMargin'),
      thresholds: Object.freeze(thresholdsOf(given.threshold)),
      // One that tracks visibility is looked at no more than ten times a second.
      delay: trackVisibility ? Math.max(delay, 100) : delay,
      trackVisibility,
      observations: new Map(),
      queue: [],
      delivering: false,
      options: given,
    });
  }

  get root(): unknown {
    return stateOf(this).root;
  }

  get rootMargin(): string {
    return marginText(stateOf(this).margin);
  }

  get scrollMargin(): string {
    return marginText(stateOf(this).scrollMargin);
  }

  get thresholds(): readonly number[] {
    return stateOf(this).thresholds;
  }

  get delay(): number {
    return stateOf(this).delay;
  }

  get trackVisibility(): boolean {
    return stateOf(this).trackVisibility;
  }

  observe(target: EngineNode): void {
    const node = asElement(target, 'IntersectionObserver');
    const state = stateOf(this);
    // An app that did not ask for the package watches as it does without it.
    if (others && !documentOf(engineOf(node))) {
      state.other ??= new others(
        (entries) => state.callback.call(this, entries, this),
        state.options,
      );
      return state.other.observe(node);
    }
    if (state.observations.has(node)) return;
    state.observations.set(node, {
      target: node,
      previousThresholdIndex: -1,
      previousIsIntersecting: false,
      stops: watchTarget(node),
    });
    live.add(this);
    schedule();
  }

  unobserve(target: EngineNode): void {
    const state = stateOf(this);
    state.other?.unobserve(target);
    const observation = state.observations.get(target);
    if (!observation) return;
    for (const stop of observation.stops) stop();
    state.observations.delete(target);
    if (!state.observations.size) live.delete(this);
  }

  disconnect(): void {
    stateOf(this).other?.disconnect();
    for (const target of [...stateOf(this).observations.keys()]) this.unobserve(target);
  }

  /** What is queued and not yet told, taken: the callback is not told it after. */
  takeRecords(): IntersectionObserverEntry[] {
    return stateOf(this).queue.splice(0);
  }
}

interface EntryInit {
  readonly time: number;
  readonly rootBounds: DOMRectReadOnly | null;
  readonly boundingClientRect: DOMRectReadOnly;
  readonly intersectionRect: DOMRectReadOnly;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
  readonly isVisible?: boolean;
  readonly target: EngineNode;
}

/** `IntersectionObserverEntry`: one target, as it was looked at. */
export class IntersectionObserverEntry {
  readonly time: number;
  readonly rootBounds: DOMRectReadOnly | null;
  readonly boundingClientRect: DOMRectReadOnly;
  readonly intersectionRect: DOMRectReadOnly;
  readonly isIntersecting: boolean;
  readonly intersectionRatio: number;
  readonly isVisible: boolean;
  readonly target: EngineNode;

  constructor(init: EntryInit) {
    this.time = init.time;
    this.rootBounds = init.rootBounds;
    this.boundingClientRect = init.boundingClientRect;
    this.intersectionRect = init.intersectionRect;
    this.isIntersecting = init.isIntersecting;
    this.intersectionRatio = init.intersectionRatio;
    this.isVisible = init.isVisible ?? false;
    this.target = init.target;
  }
}
