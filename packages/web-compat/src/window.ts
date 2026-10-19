import type { Engine, EngineNode } from '@ng-native/fabric';
import {
  CompatCustomEvent,
  CompatEvent,
  dispatch,
  listen,
  unlisten,
  unlistenAll,
} from './events.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { listenOnWindow, windowListensTo } from './window-listeners.ts';

/** The engine a node is in. */
export const engineOf = (node: EngineNode): Engine =>
  (node as unknown as { engine: Engine }).engine;

/**
 * `HTMLElement`, for the one thing a library does with it here: ask whether what an event
 * landed on is an element, which any element of the engine's is. And anything the runtime's own
 * `HTMLElement` says is one, where it has one: React Native does, for its own views.
 */
function anyElement(before: unknown): object {
  const own = typeof before === 'function' ? (before as new () => object) : undefined;
  return class AnyElement {
    static [Symbol.hasInstance](value: unknown): boolean {
      if ((value as { nodeKind?: unknown } | null)?.nodeKind === 'element') return true;
      return own !== undefined && Function.prototype[Symbol.hasInstance].call(own, value);
    }
  };
}

/** What a library reads from `window`, some of it as it loads. */
const GLOBALS: Readonly<Record<string, unknown>> = {
  // The window's own listeners, which hear what a script sends it or anything under it, and a
  // press, a scroll or a resize in any app: see `window-listeners.ts`.
  addEventListener: (type: string, listener: unknown, options?: unknown) =>
    void listen(globalThis, type, listener, options, (heard) => listenOnWindow(type, heard)),
  removeEventListener: (type: string, listener: unknown, options?: unknown) =>
    unlisten(globalThis, type, listener, options),
  dispatchEvent: (event: unknown) => dispatch(event, [globalThis]),
  // What a script makes an event with, where the runtime has none: see `events.ts`.
  Event: CompatEvent,
  CustomEvent: CompatCustomEvent,
  // There for a device that takes touches, which is how a library asks.
  ontouchstart: null,
  // The page's window is the top one, in no frame.
  self: globalThis,
  parent: globalThis,
  top: globalThis,
  frameElement: null,
};

/**
 * Define the globals above that the runtime does not have, and answer what removes them again.
 * One the runtime has is left alone: React Native's own `requestAnimationFrame`, a test's jsdom.
 */
export function installWindow(): () => void {
  const target = globalThis as Record<string, unknown>;
  const added = Object.keys(GLOBALS).filter((name) => typeof target[name] === 'undefined');
  for (const name of added) target[name] = GLOBALS[name];
  const element = target['HTMLElement'];
  const ours = (target['HTMLElement'] = anyElement(element));
  // `window` itself, which React Native has as the global and Node, under a test, has not.
  const windowed = typeof target['window'] === 'undefined';
  if (windowed) target['window'] = target;
  const unplaced = placeNodes(target);
  const sized = Object.keys(SIZES).filter((name) => typeof target[name] === 'undefined');
  for (const name of sized) {
    Object.defineProperty(target, name, { configurable: true, get: SIZES[name] });
  }
  return () => {
    for (const name of added) if (target[name] === GLOBALS[name]) delete target[name];
    for (const name of sized) delete target[name];
    // What was added with them goes with them, as a page's listeners go with its window.
    unlistenAll(globalThis);
    unplaced();
    if (windowed) delete target['window'];
    if (target['HTMLElement'] !== ours) return;
    if (element === undefined) delete target['HTMLElement'];
    else target['HTMLElement'] = element;
  };
}

/**
 * Give `Node` the kinds of node and the constants a library reads an answer of
 * `compareDocumentPosition` with, where the runtime's `Node` has none or there is no `Node`.
 * Answers what takes them away again.
 */
function placeNodes(target: Record<string, unknown>): () => void {
  const made = typeof target['Node'] === 'undefined';
  if (made) target['Node'] = class Node {};
  const node = target['Node'] as { prototype: Record<string, unknown> } & Record<string, unknown>;
  // On its prototype as well, as a browser's are.
  const holders = [node, node.prototype];
  const added = holders.map((holder) =>
    Object.keys(NODE_CONSTANTS).filter((name) => !(name in holder)),
  );
  holders.forEach((holder, at) => {
    for (const name of added[at]!) holder[name] = NODE_CONSTANTS[name];
  });
  return () => {
    holders.forEach((holder, at) => {
      for (const name of added[at]!) delete holder[name];
    });
    if (made && target['Node'] === node) delete target['Node'];
  };
}

/** The engines of the apps that are up, oldest first: the newest is the one `window` speaks for. */
const engines: Engine[] = [];

/** An app that asked for the package has started: its window is the one read, until it goes. */
export function windowOf(engine: Engine): () => void {
  engines.push(engine);
  const unlistened = windowListensTo(engine);
  return () => {
    unlistened();
    engines.splice(engines.indexOf(engine), 1);
  };
}

/**
 * Hear the window of an app change size, as a `resize` listener on `window` does: the device
 * turning, or the window given another size.
 */
export const listenToResize = (engine: Engine, listener: () => void): (() => void) =>
  engine.watchViewport(listener);

const size = () => engines.at(-1)?.viewport ?? { width: 0, height: 0 };

/**
 * The window's size, read each time: a library positions an overlay from it, and the device can
 * turn. Nothing scrolls the window itself, so its scroll position is always the top.
 */
const SIZES: Readonly<Record<string, () => number>> = {
  innerWidth: () => size().width,
  innerHeight: () => size().height,
  // The window is the whole of what an app has.
  outerWidth: () => size().width,
  outerHeight: () => size().height,
  scrollX: () => 0,
  scrollY: () => 0,
  pageXOffset: () => 0,
  pageYOffset: () => 0,
};
