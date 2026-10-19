import { claimHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { required } from './dom-error.ts';
import { dispatch, listen, passiveFor, unlisten } from './events.ts';
import { delivering, touchFields } from './listen.ts';
import { listenToResize } from './window.ts';

/** The document a library is given: what it creates elements with and appends overlays to. */
export interface CompatDocument {
  readonly body: EngineNode;
  readonly head: EngineNode;
  readonly documentElement: EngineNode;
  [member: string]: unknown;
}

/** Each app's document, by its engine. An engine with one is an app that asked for this package. */
const documents = new WeakMap<Engine, CompatDocument>();

export const documentOf = (engine: Engine): CompatDocument | undefined => documents.get(engine);

/**
 * A view of the package's own, in no template: claimed, so the engine does not take it for a
 * `<view>` a template wrote without importing its component.
 */
function ownView(engine: Engine): EngineNode {
  const node = engine.createElement('view');
  claimHost(node);
  return node;
}

/**
 * What an element is called: the root is `html` and the body `body`, which is where a library
 * walking up through parents knows to stop.
 */
export function nameOf(node: EngineNode, engine: Engine): string {
  if (engine.root === node) return 'html';
  return documents.get(engine)?.body === node ? 'body' : node.tag;
}

/** Over anything an app gives a z-index of its own, under the root. */
const BODY_LAYER = 1_000_000;

/**
 * `document.body`: a layer over the whole screen that lets touches through to the app, so what a
 * library appends to it (an overlay container) draws above the screen. It is in the tree from
 * the start and over the app by its z-index, wherever under the root it is.
 *
 * Not joined by its first child, nor moved to the end to be on top: a view that joins the root or
 * moves in it changes what the app's root view is beside, and every view under that is styled
 * again for it.
 */
function createBody(engine: Engine): EngineNode {
  const body = ownView(engine);
  engine.setProp(body, 'style', {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: BODY_LAYER,
  });
  engine.setProp(body, 'pointerEvents', 'box-none');
  // Everything in the page is in its body, to a library that asks: the app is drawn beside
  // this view and not in it.
  Object.defineProperty(body, 'contains', {
    value: (other: EngineNode | null) => {
      for (let at = other; at; at = at.parent) if (at === engine.root) return true;
      return false;
    },
  });
  engine.appendChild(engine.root, body);
  return body;
}

/**
 * The touch behind each DOM event a library listens for on the document, to hear a press
 * anywhere: outside an overlay, which is how it knows to close.
 */
const DOCUMENT_EVENTS: Readonly<Record<string, string>> = {
  pointerdown: 'topTouchStart',
  touchstart: 'topTouchStart',
  // A finger moving, which a drag is followed by: it goes on over whatever it crosses.
  pointermove: 'topTouchMove',
  touchmove: 'topTouchMove',
  pointercancel: 'topTouchCancel',
  touchcancel: 'topTouchCancel',
  pointerup: 'topTouchEnd',
  touchend: 'topTouchEnd',
  click: 'topTouchEnd',
  // The focus moving anywhere in the page, which a focus monitor and a focus trap listen for.
  focusin: 'topFocus',
  focusout: 'topBlur',
};

type Listener = (event: unknown) => unknown;

/**
 * Which pointer an event is of, as the element it is on was told: a library that follows a drag
 * from the document keeps the id of the pointer that started it, and takes no move that is not
 * that pointer's.
 */
function pointerOf(type: string, native: { identifier?: number } | undefined): object {
  if (!type.startsWith('pointer')) return {};
  const down = type === 'pointerdown' || type === 'pointermove';
  return {
    pointerId: native?.identifier ?? 0,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: down ? 1 : 0,
  };
}

/**
 * Listen for an event anywhere in the app, as a listener on `document`, `body` or `window` does.
 * A touch bubbles to the engine's root, which is where this listens, and the event names the
 * node it landed on. Nothing for an event with no touch behind it, a key say, and no `click`
 * for a touch that was a drag.
 */
export function listenAnywhere(
  engine: Engine,
  type: string,
  listener: Listener,
): (() => void) | undefined {
  if (type === 'scroll') return listenToScrolls(engine, listener);
  if (type === 'resize')
    return listenToResize(engine, () => listener({ type, target: globalThis }));
  const native = DOCUMENT_EVENTS[type];
  if (!native) return undefined;
  watchTouches(engine);
  // Not for the event it is added during: a listener a press adds on the document, as opening an
  // overlay does, is added after a browser has passed the document for that press.
  const during = delivering();
  return engine.setEventListener(engine.root, native, (event) => {
    if (event === during) return;
    if (type === 'click' && wasDrag(engine, event)) return;
    const target = (event as { target: EngineNode | null }).target;
    const path: EngineNode[] = [];
    for (let node = target; node; node = node.parent) path.push(node);
    const nativeEvent = (event as { nativeEvent?: { identifier?: number } }).nativeEvent;
    listener({
      type,
      target,
      nativeEvent,
      ...touchFields(nativeEvent),
      ...pointerOf(type, nativeEvent),
      composedPath: () => path,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() {},
      stopPropagation() {},
    });
  });
}

/**
 * Tell a listener of a scroll in any scroll view, as a browser tells the document of one in any
 * element: native sends it to the view that scrolled and no further. A library asks while an
 * overlay is open, to move it with what it is placed against.
 *
 * ponytail: the scroll views there when it asks. One made while it listens is not heard; watch
 * for them as they are created if an overlay is ever open across a page being made.
 */
function listenToScrolls(engine: Engine, listener: Listener): () => void {
  const stops: (() => void)[] = [];
  const watch = (node: EngineNode): void => {
    if (node.nodeKind === 'element' && node.tag === 'scroll-view') {
      stops.push(
        engine.setEventListener(node, 'topScroll', (event) =>
          listener({
            type: 'scroll',
            target: node,
            nativeEvent: (event as { nativeEvent?: unknown }).nativeEvent,
            defaultPrevented: false,
            preventDefault() {},
            stopPropagation() {},
          }),
        ),
      );
    }
    for (const child of node.childList) watch(child);
  };
  watch(engine.root);
  return () => {
    for (const stop of stops) stop();
  };
}

const watched = new WeakSet<Engine>();
/** Where the touch now down began, by engine: a touch that ends far from there was a drag. */
const began = new WeakMap<Engine, { x: number; y: number; dragged: boolean }>();
/** How far a finger wanders in a press. Further is a drag, which a browser ends in no click. */
const DRAG = 10;

/** Keep where each touch begins, to tell a press from a drag as it ends. */
function watchTouches(engine: Engine): void {
  if (watched.has(engine)) return;
  watched.add(engine);
  engine.setEventListener(engine.root, 'topTouchStart', (event) => {
    began.set(engine, { ...placeOf(event), dragged: false });
  });
  // As far as the finger went, not where it ends: out and back is a drag, as an element's says.
  engine.setEventListener(engine.root, 'topTouchMove', (event) => {
    const from = began.get(engine);
    if (!from || from.dragged) return;
    const to = placeOf(event);
    if (Math.hypot(to.x - from.x, to.y - from.y) > DRAG) from.dragged = true;
  });
}

interface TouchPoint {
  pageX?: number;
  pageY?: number;
  touches?: readonly TouchPoint[];
  changedTouches?: readonly TouchPoint[];
}

const placeOf = (event: unknown): { x: number; y: number } => {
  const native = (event as { nativeEvent?: TouchPoint }).nativeEvent;
  const touch = native?.changedTouches?.[0] ?? native?.touches?.[0] ?? native;
  return { x: touch?.pageX ?? 0, y: touch?.pageY ?? 0 };
};

/** Whether the touch an event ends moved further than a press does from where it began. */
function wasDrag(engine: Engine, event: unknown): boolean {
  const from = began.get(engine);
  if (!from) return false;
  if (from.dragged) return true;
  const to = placeOf(event);
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG;
}

/**
 * `addEventListener` and `removeEventListener` for the document or the body: each hears what a
 * script sends it or anything under it, and, by `listenAnywhere`, a press anywhere in the app.
 */
function anywhere(engine: Engine, target: object) {
  return {
    addEventListener(type: string, listener: Listener, options?: unknown): void {
      listen(target, type, listener, options, (heard) => listenAnywhere(engine, type, heard));
    },
    removeEventListener(type: string, listener: Listener, options?: unknown): void {
      unlisten(target, type, listener, options);
    },
  };
}

/**
 * The way an event a script sends to a node goes: the node, what it is in, and then the document
 * and the window where the node is in the page. The body is in a browser over everything a page
 * draws, and here beside what the app draws, so it is put in the way of an event from that too.
 */
export function eventPath(engine: Engine, node: EngineNode): object[] {
  const path: object[] = [];
  let top = node;
  for (let at: EngineNode | null = node; at; at = at.parent) path.push((top = at));
  const document = documents.get(engine);
  if (!document) return path;
  if (top === document.head) path.push(engine.root);
  else if (top !== engine.root) return path;
  else if (path.length > 1 && !path.includes(document.body)) {
    path.splice(path.length - 1, 0, document.body);
  }
  return [...path, document, globalThis];
}

/** Every node under one, in the order of the page. */
function* descendants(node: EngineNode): Generator<EngineNode> {
  for (const child of node.childList) {
    yield child;
    yield* descendants(child);
  }
}

/** The app's document, made the first time it is asked for. */
export function documentFor(engine: Engine): CompatDocument {
  const existing = documents.get(engine);
  if (existing) return existing;
  // Somewhere for a library's style elements to go: never in the tree, so never drawn.
  const head = ownView(engine);
  const body = createBody(engine);
  // A listener on the body hears the whole page, as one on the document does.
  const bodyListeners = anywhere(engine, body);
  Object.defineProperties(body, {
    addEventListener: { value: bodyListeners.addEventListener },
    removeEventListener: { value: bodyListeners.removeEventListener },
  });
  const created: CompatDocument = {
    body,
    head,
    documentElement: engine.root,
    nodeType: 9,
    nodeName: '#document',
    nodeValue: null,
    // A document has no text of its own, and writing it changes nothing.
    get textContent() {
      return null;
    },
    set textContent(_value: unknown) {},
    ownerDocument: null,
    parentNode: null,
    parentElement: null,
    readyState: 'complete',
    visibilityState: 'visible',
    // The field the keyboard belongs to, which a library reads to know one is being typed in.
    get activeElement() {
      return engine.focused ?? body;
    },
    defaultView: globalThis,
    createElement(...args: unknown[]) {
      required(args, 1, 'createElement');
      return engine.createElement(String(args[0]).toLowerCase());
    },
    createTextNode(...args: unknown[]) {
      required(args, 1, 'createTextNode');
      return engine.createText(String(args[0]));
    },
    // A comment is the engine's anchor, which is never drawn, with its words kept on it.
    createComment(...args: unknown[]) {
      required(args, 1, 'createComment');
      const comment = engine.createAnchor();
      comment.nodeText = String(args[0]);
      return comment;
    },
    // The head and then the page, as a document has them.
    getElementById(id: unknown) {
      const wanted = String(id);
      for (const top of [head, engine.root]) {
        for (const node of descendants(top)) if (node.props['nativeID'] === wanted) return node;
      }
      return null;
    },
    dispatchEvent: (event: unknown) => dispatch(event, [created, globalThis]),
    hasFocus: () => true,
  };
  Object.assign(created, anywhere(engine, created));
  passiveFor(created, body, engine.root);
  documents.set(engine, created);
  return created;
}
