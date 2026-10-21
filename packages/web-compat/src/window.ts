import { installDeferTriggers, type Engine, type EngineNode } from '@ng-native/fabric';
import { Attr } from './attr.ts';
import { computedStyle } from './computed-style.ts';
import { cssNamespace } from './css-namespace.ts';
import * as cssom from './css-style-sheet.ts';
import { DOMStringMap } from './dataset.ts';
import { ValidityState } from './validity.ts';
import { Document, XMLDocument } from './dom-implementation.ts';
import { DOMRect, DOMRectList, DOMRectReadOnly } from './dom-rect.ts';
import { DocumentType } from './document-type.ts';
import { elementInterfaces } from './element-interfaces.ts';
import {
  CompatCustomEvent,
  CompatEvent,
  dispatch,
  listen,
  unlisten,
  unlistenAll,
  windowEvent,
} from './events.ts';
import { EVENT_CLASSES, phasesOnEvent } from './event-classes.ts';
import { pageFrames, postMessage } from './frame.ts';
import { domParser } from './html.ts';
import {
  IntersectionObserver,
  IntersectionObserverEntry,
  watchOthersWith,
} from './intersection-observer.ts';
import { HTMLCollection, NodeList } from './live-list.ts';
import { MediaQueryList, mediaQueryList } from './match-media.ts';
import { MediaList } from './media-list.ts';
import { MutationObserver, MutationRecord } from './mutation-observer.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { nodeInterfaces } from './node-interfaces.ts';
import { installNamedProperties } from './named-properties.ts';
import { installNavigator } from './navigator-identity.ts';
import { ResizeObserver, ResizeObserverEntry, ResizeObserverSize } from './resize-observer.ts';
import { scrollAsked, scrollPromise } from './scroll-offset.ts';
import { NodeFilter, NodeIterator, TreeWalker } from './traversal.ts';
import { listenOnWindow, windowListensTo } from './window-listeners.ts';
import { XMLSerializer } from './xml-serializer.ts';

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

const noop = () => {};

/**
 * `window.matchMedia`: whether a media query matches the window of the app `window` speaks for,
 * read each time it is asked, and a listener told when the answer changes: the device turning.
 * See `match-media.ts`.
 */
function matchMedia(...args: unknown[]): MediaQueryList {
  if (args.length === 0) {
    throw new TypeError("Failed to execute 'matchMedia': 1 argument required, but only 0 present.");
  }
  return mediaQueryList(String(args[0]), {
    screen: preferences,
    watch: (changed) => {
      const engine = engines.at(-1);
      return engine ? listenToResize(engine, changed) : noop;
    },
  });
}

/**
 * `window.screen`: the window, as nothing here is drawn outside it. Read each time, as the
 * device can turn.
 */
const screen = Object.freeze({
  get width() {
    return size().width;
  },
  get height() {
    return size().height;
  },
  get availWidth() {
    return size().width;
  },
  get availHeight() {
    return size().height;
  },
  availLeft: 0,
  availTop: 0,
  colorDepth: 24,
  pixelDepth: 24,
  get orientation() {
    const { width, height } = size();
    const portrait = height >= width;
    return { type: portrait ? 'portrait-primary' : 'landscape-primary', angle: portrait ? 0 : 90 };
  },
});

/**
 * `window.visualViewport`: the part of the page in sight, which is the window, unzoomed and at
 * the top. A library places an overlay by it, and listens for its `resize`, which is the
 * window's.
 */
const visualViewport = {
  get width() {
    return size().width;
  },
  get height() {
    return size().height;
  },
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  onscrollend: null,
  addEventListener(type: string, listener: unknown, options?: unknown) {
    listen(visualViewport, type, listener, options, (heard) => {
      const engine = engines.at(-1);
      if (type !== 'resize' || !engine) return undefined;
      return listenToResize(engine, () => heard({ type, target: visualViewport }));
    });
  },
  removeEventListener(type: string, listener: unknown, options?: unknown) {
    unlisten(visualViewport, type, listener, options);
  },
  dispatchEvent: (event: unknown) => dispatch(event, [visualViewport]),
};

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
  // `MouseEvent`, `KeyboardEvent` and the rest: a library asks whether an event is one.
  ...EVENT_CLASSES,
  // There for a device that takes touches, which is how a library asks.
  ontouchstart: null,
  // The page's window is the top one, in no frame, and its `frames` the window of each iframe
  // in it by its place: see `frame.ts`. Read as the window is put in, after every module.
  self: globalThis,
  get frames() {
    return pageFrames;
  },
  parent: globalThis,
  top: globalThis,
  frameElement: null,
  // A `message` event on the window, after the task that sent it: see `frame.ts`.
  postMessage: (message: unknown, options?: unknown) => postMessage(globalThis, message, options),
  // What hears a change to the tree: see `mutation-observer.ts`.
  MutationObserver,
  MutationRecord,
  // `Text`, `Comment` and the rest: see `node-interfaces.ts`. A mutation's anchor is a comment.
  ...nodeInterfaces,
  // A document's `<!DOCTYPE>`: see `document-type.ts`.
  DocumentType,
  // What a document is, and what a script makes one with: see `dom-implementation.ts`.
  Document,
  XMLDocument,
  // An attribute as a node: see `attr.ts`.
  Attr,
  // `HTMLDivElement` and the rest, which a library asks whether an element is one of: see
  // `element-interfaces.ts`.
  ...elementInterfaces,
  // What `element.dataset` is: see `dataset.ts`.
  DOMStringMap,
  // What a control's `validity` is: see `validity.ts`.
  ValidityState,
  // What Angular's sanitizer parses the markup of an `innerHTML` binding with: see `html.ts`.
  DOMParser: domParser(() => engines.at(-1)),
  // What a chart library exports a drawing as markup with: see `xml-serializer.ts`.
  XMLSerializer,
  // What a walk of the tree is told to show, and what its filter answers of each node.
  NodeFilter,
  TreeWalker,
  NodeIterator,
  // The rules of a stylesheet as a script reads and writes them: see `css-style-sheet.ts`.
  ...Object.fromEntries(Object.entries(cssom).filter(([name]) => /^(CSS|StyleSheet$)/.test(name))),
  MediaList,
  // `escape`, and `supports` for what a stylesheet made at run time is read with: see `css-namespace.ts`.
  CSS: cssNamespace,
  // What `childNodes` and `getElementsByTagName` answer: see `live-list.ts`.
  HTMLCollection,
  NodeList,
  // Whether a media query matches the window: see `match-media.ts`.
  matchMedia,
  MediaQueryList,
  // All three: a library's scroll blocking calls `scroll`, and restores the page with it. The
  // window does not scroll here, so each only checks what it is given, as a browser does.
  scroll: (...args: unknown[]) => scrollPromise(() => void scrollAsked(args)),
  scrollTo: (...args: unknown[]) => scrollPromise(() => void scrollAsked(args)),
  scrollBy: (...args: unknown[]) => scrollPromise(() => void scrollAsked(args)),
  screen,
  visualViewport,
  // What `getBoundingClientRect` answers, which a library makes rectangles of its own with.
  DOMRect,
  DOMRectReadOnly,
  DOMRectList,
  // See `resize-observer.ts` and `intersection-observer.ts`.
  ResizeObserver,
  ResizeObserverEntry,
  ResizeObserverSize,
  IntersectionObserverEntry,
};

/** The window's listening, which `before-modules.js` stands in for before any module runs. */
const LISTENING = ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const;

interface StandIns {
  addEventListener(type: string, listener: unknown, options?: unknown): void;
  removeEventListener(type: string, listener: unknown, options?: unknown): void;
  dispatchEvent(event: unknown): boolean;
  readonly kept: { type: string; listener: unknown; options: unknown }[];
}

/** The stand-ins Metro put in, taken out for the window's own to go in. */
function takeStandIns(target: Record<string, unknown>): StandIns | undefined {
  const standIns = (target['addEventListener'] as { standIns?: StandIns } | undefined)?.standIns;
  if (standIns) for (const name of LISTENING) delete target[name];
  return standIns;
}

/** What a library gave the stand-ins as it loaded, given to the window's own listeners. */
function handOver(standIns: StandIns | undefined, target: Record<string, unknown>): void {
  const listen = target['addEventListener'] as StandIns['addEventListener'];
  for (const { type, listener, options } of standIns?.kept ?? []) listen(type, listener, options);
}

/** The stand-ins back, once the window's own have gone, for a later app to be handed. */
function giveBack(standIns: StandIns | undefined, target: Record<string, unknown>): void {
  if (standIns) for (const name of LISTENING) target[name] ??= standIns[name];
}

/**
 * Define the globals above that the runtime does not have, and answer what removes them again.
 * One the runtime has is left alone: React Native's own `requestAnimationFrame`, a test's jsdom.
 */
export function installWindow(): () => void {
  const target = globalThis as Record<string, unknown>;
  // The stand-ins Metro put in before any module ran, and what a library gave them as it loaded:
  // see `before-modules.js`. The window's own go in over them, are handed what they kept, and
  // give them back after.
  const standIns = takeStandIns(target);
  const added = Object.keys(GLOBALS).filter((name) => typeof target[name] === 'undefined');
  for (const name of added) target[name] = GLOBALS[name];
  handOver(standIns, target);
  // Over the one the Metro preset's polyfill has, which answers nothing: an animation library
  // asks it for a custom property, and a component library for what it just wrote.
  const computed = target['getComputedStyle'];
  target['getComputedStyle'] = computedStyle;
  const element = target['HTMLElement'];
  const ours = (target['HTMLElement'] = anyElement(element));
  // `window` itself, which React Native has as the global and Node, under a test, has not.
  const windowed = typeof target['window'] === 'undefined';
  if (windowed) target['window'] = target;
  const unplaced = placeNodes(target);
  // A phone's browser, as the user agent says: see `navigator-identity.ts`.
  const unidentified = installNavigator();
  // An element with an id is a global by it: see `named-properties.ts`.
  const unnamed = installNamedProperties(target);
  // The event a listener is being told: see `events.ts`.
  const evented = !('event' in target);
  if (evented) Object.defineProperty(target, 'event', windowEvent);
  const unphased = phasesOnEvent();
  const sized = Object.keys(SIZES).filter((name) => typeof target[name] === 'undefined');
  for (const name of sized) {
    Object.defineProperty(target, name, { configurable: true, get: SIZES[name] });
  }
  // Over the engine's own, which `@defer (on viewport)` is given where this package is not: a
  // library reads the whole of an entry, and sets a root, a margin and thresholds. The engine's
  // is put in first, so that it is not put in over this one when the app mounts.
  installDeferTriggers();
  const intersecting = target['IntersectionObserver'];
  target['IntersectionObserver'] = IntersectionObserver;
  // And an app that did not ask is watched by the engine's, as it is without this package.
  watchOthersWith(intersecting);
  return () => {
    if (target['IntersectionObserver'] === IntersectionObserver) {
      target['IntersectionObserver'] = intersecting;
    }
    watchOthersWith(undefined);
    for (const name of added) if (target[name] === GLOBALS[name]) delete target[name];
    giveBack(standIns, target);
    for (const name of sized) delete target[name];
    // What was added with them goes with them, as a page's listeners go with its window.
    unlistenAll(globalThis);
    unplaced();
    unidentified();
    unnamed();
    unphased();
    if (evented) delete target['event'];
    if (windowed) delete target['window'];
    if (target['getComputedStyle'] === computedStyle) target['getComputedStyle'] = computed;
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

/** The engine of the newest app up, which the window speaks for. */
export const currentEngine = (): Engine | undefined => engines.at(-1);

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

/** The size of an app's window, which is the screen's: nothing is drawn outside it. */
export const windowSize = (engine: Engine): { width: number; height: number } => engine.viewport;

const size = () => {
  const engine = engines.at(-1);
  return engine ? windowSize(engine) : { width: 0, height: 0 };
};

/** The window's size, with the colour scheme and the motion the engine was given. */
const preferences = () => {
  const conditions = engines.at(-1)?.conditions;
  return {
    ...size(),
    colorScheme: conditions?.colorScheme,
    reducedMotion: conditions?.reducedMotion,
  };
};

/**
 * The window's size, read each time: a library positions an overlay from it, and the device can
 * turn. Nothing scrolls the window itself, so its scroll position is always the top.
 */
const SIZES: Readonly<Record<string, () => number>> = {
  innerWidth: () => size().width,
  innerHeight: () => size().height,
  // The window is the whole of what an app has, and where it is on the screen is its corner.
  outerWidth: () => size().width,
  outerHeight: () => size().height,
  screenX: () => 0,
  screenY: () => 0,
  screenLeft: () => 0,
  screenTop: () => 0,
  // The screen's pixels in a point, which a canvas is drawn sharp by: 1 where it was not told.
  devicePixelRatio: () => engines.at(-1)?.conditions?.pixelRatio ?? 1,
  scrollX: () => 0,
  scrollY: () => 0,
  pageXOffset: () => 0,
  pageYOffset: () => 0,
};
