import type { EngineNode } from '@ng-native/fabric';
import { watchCommits } from './commit-watch.ts';
import { DOMRectReadOnly } from './dom-rect.ts';
import { report } from './events.ts';
import { border, drawn, sizeOf, styled } from './geometry.ts';
import { engineOf } from './window.ts';

/**
 * `ResizeObserver`: told of each element it watches whose size changed, in the box it was asked
 * for, all at once as the task that laid them out ends: before what that task wrote is drawn,
 * as a browser tells it before it paints. Native says when it lays a node out again; an element
 * laid out before it was watched is measured once `observe` is over, and reported if it has a
 * size.
 *
 * A callback that resizes what it watches is told of that when native has laid it out again,
 * which is a later task: never the same one, so a loop between the two goes no faster than
 * native lays out, as a browser holds what is left of one over to the next frame.
 *
 * Native lays out nothing for an element hidden or taken out of the page, so while an element is
 * watched each commit of its app is looked after for it having had a size and lost its view: see
 * `commit-watch.ts`. Shown again, an element's view is made again, and native lays that out.
 *
 * ponytail: the content and border boxes, as Safari has them. `device-pixel-content-box` is the
 * content box in `devicePixelRatio`'s pixels, snapped to where its edges fall on them, which
 * native lays out in points and does not say.
 */
type Box = 'content-box' | 'border-box';
const BOXES = new Set<string>(['content-box', 'border-box']);

interface Size {
  readonly inlineSize: number;
  readonly blockSize: number;
}

interface Observation {
  readonly target: EngineNode;
  readonly box: Box;
  /** The size last reported, in its box: -1 by -1 at first, so the first look always tells. */
  last: Size;
  readonly stop: () => void;
}

/**
 * Each watched element's size as native last laid it out, which is its border box: heard while
 * it is watched, and let go with that, as what is not heard of can be out of date.
 */
const laidOut = new WeakMap<EngineNode, { width: number; height: number }>();

/** An element, as `observe` takes one: anything else is a `TypeError`. */
export function asElement(target: unknown, what: string): EngineNode {
  if ((target as EngineNode | null)?.nodeKind !== 'element') {
    throw new TypeError(`Failed to execute 'observe' on '${what}': parameter 1 is not an Element.`);
  }
  return target as EngineNode;
}

/** A length from a style, where it is one in points: a percentage is not worked out here. */
function points(node: EngineNode, ...keys: string[]): number {
  for (const key of keys) {
    const value = styled(node, key);
    if (typeof value === 'number') return value;
  }
  return 0;
}

const padding = (node: EngineNode, side: 'Top' | 'Right' | 'Bottom' | 'Left') =>
  points(
    node,
    `padding${side}`,
    side === 'Top' || side === 'Bottom' ? 'paddingVertical' : 'paddingHorizontal',
    'padding',
  );

/**
 * An element's boxes as they are laid out: its border box, and inside its border and padding
 * the box for what it holds, with where that starts. Nothing for one that is not drawn.
 */
function boxesOf(node: EngineNode) {
  if (!drawn(node)) return { outer: { width: 0, height: 0 }, inner: new DOMRectReadOnly() };
  const outer = laidOut.get(node) ?? sizeOf(node);
  const left = padding(node, 'Left');
  const top = padding(node, 'Top');
  const across = left + padding(node, 'Right') + border(node, 'Left') + border(node, 'Right');
  const down = top + padding(node, 'Bottom') + border(node, 'Top') + border(node, 'Bottom');
  const inner = new DOMRectReadOnly(
    left,
    top,
    Math.max(0, outer.width - across),
    Math.max(0, outer.height - down),
  );
  return { outer, inner };
}

const sizeIn = (box: Box, boxes: ReturnType<typeof boxesOf>): Size => {
  if (box === 'border-box') {
    return { inlineSize: boxes.outer.width, blockSize: boxes.outer.height };
  }
  return { inlineSize: boxes.inner.width, blockSize: boxes.inner.height };
};

/** `ResizeObserverSize`: one box's size, across and down. */
export class ResizeObserverSize {
  readonly inlineSize: number;
  readonly blockSize: number;

  constructor(size: Size) {
    this.inlineSize = size.inlineSize;
    this.blockSize = size.blockSize;
    Object.freeze(this);
  }
}

const list = (size: Size) => Object.freeze([new ResizeObserverSize(size)]);

/** `ResizeObserverEntry`: an element, and each of its boxes as it is now. */
export class ResizeObserverEntry {
  readonly target: EngineNode;
  readonly contentRect: DOMRectReadOnly;
  readonly borderBoxSize: readonly ResizeObserverSize[];
  readonly contentBoxSize: readonly ResizeObserverSize[];

  constructor(target: EngineNode) {
    const boxes = boxesOf(asElement(target, 'ResizeObserverEntry'));
    this.target = target;
    this.contentRect = boxes.inner;
    this.borderBoxSize = list(sizeIn('border-box', boxes));
    this.contentBoxSize = list(sizeIn('content-box', boxes));
  }
}

/** The observers with something to look at once the task that told them is over. */
const due = new Set<ResizeObserver>();

function schedule(observer: ResizeObserver): void {
  if (due.size === 0) {
    queueMicrotask(() => {
      const now = [...due];
      due.clear();
      for (const each of now) deliver(each);
    });
  }
  due.add(observer);
}

type Callback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const callbacks = new WeakMap<ResizeObserver, Callback>();
const watched = new WeakMap<ResizeObserver, Map<EngineNode, Observation>>();

/**
 * After a commit: whether a watched element had a size and has no view now, which native lays
 * nothing out for. One that kept its view is not measured: native tells of a change of its size.
 */
function lostView(observer: ResizeObserver, observation: Observation): void {
  const { target, last } = observation;
  if (target.committed || (last.inlineSize <= 0 && last.blockSize <= 0)) return;
  schedule(observer);
}

export class ResizeObserver {
  constructor(callback: Callback) {
    if (typeof callback !== 'function') {
      throw new TypeError("Failed to construct 'ResizeObserver': The callback is not a function.");
    }
    callbacks.set(this, callback);
    watched.set(this, new Map());
  }

  observe(target: EngineNode, options?: { box?: unknown }): void {
    const node = asElement(target, 'ResizeObserver');
    const box = String(options?.box ?? 'content-box');
    if (!BOXES.has(box)) {
      throw new TypeError(`The provided value '${box}' is not a valid ResizeObserverBoxOptions.`);
    }
    // Watched again, in the box asked for now, and told again of its size if it has one.
    this.unobserve(node);
    const engine = engineOf(node);
    const heard = engine.setEventListener(node, 'topLayout', (event) => {
      const layout = (event as { nativeEvent?: { layout?: { width: number; height: number } } })
        .nativeEvent?.layout;
      if (layout) laidOut.set(node, { width: layout.width, height: layout.height });
      schedule(this);
    });
    const observation: Observation = {
      target: node,
      box: box as Box,
      last: { inlineSize: -1, blockSize: -1 },
      stop: () => {
        heard();
        unwatch();
        laidOut.delete(node);
      },
    };
    const unwatch = watchCommits(engine, () => lostView(this, observation));
    watched.get(this)!.set(node, observation);
    schedule(this);
  }

  unobserve(target: EngineNode): void {
    const observations = watched.get(this)!;
    observations.get(target)?.stop();
    observations.delete(target);
  }

  disconnect(): void {
    const observations = watched.get(this)!;
    for (const observation of observations.values()) observation.stop();
    observations.clear();
  }
}

/** In a frame: each element whose size changed since it was last reported, told at once. */
function deliver(observer: ResizeObserver): void {
  const entries: ResizeObserverEntry[] = [];
  for (const observation of watched.get(observer)!.values()) {
    const size = sizeIn(observation.box, boxesOf(observation.target));
    const { last } = observation;
    if (size.inlineSize === last.inlineSize && size.blockSize === last.blockSize) continue;
    observation.last = size;
    entries.push(new ResizeObserverEntry(observation.target));
  }
  if (!entries.length) return;
  try {
    callbacks.get(observer)!.call(observer, entries, observer);
  } catch (error) {
    report(error);
  }
}
