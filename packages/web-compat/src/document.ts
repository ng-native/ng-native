import { claimHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { createAttribute, createAttributeNS } from './attr.ts';
import { createCDATASection } from './cdata-section.ts';
import { createComment } from './character-data.ts';
import { documentChildren } from './document-children.ts';
import { markFragment } from './document-fragment.ts';
import { documentNodeMembers } from './document-node.ts';
import { markRoot } from './document-roots.ts';
import { createDocumentType } from './document-type.ts';
import { required } from './dom-error.ts';
import { implementationFor } from './dom-implementation.ts';
import { byClassName, byName, byTagName, byTagNameNS } from './elements-by.ts';
import type { HTMLCollection } from './live-list.ts';
import { createEvent, dispatch, listen, passiveFor, unlisten } from './events.ts';
import { asMouse } from './mouse-after-touch.ts';
import { madeByScript } from './html-tree.ts';
import { elementsUnder } from './element-tree.ts';
import { descendants } from './in-document.ts';
import { delivering, touchFields } from './listen.ts';
import { NODE_CONSTANTS } from './node-constants.ts';
import { brandNode } from './node-interfaces.ts';
import { createProcessingInstruction } from './processing-instruction.ts';
import {
  asciiLower,
  checkElementName,
  extractName,
  recordName,
  XHTML,
  type QualifiedName,
} from './qualified-name.ts';
import { adopt, adoptedOf, styleSheetsOf } from './runtime-style.ts';
import type { CSSStyleSheet } from './css-style-sheet.ts';
import { query } from './selector.ts';
import { createNodeIterator, createTreeWalker } from './traversal.ts';
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
export function ownView(engine: Engine): EngineNode {
  const node = engine.createElement('view');
  claimHost(node);
  return node;
}

/**
 * What an element is called: the root is `html`, the head `head` and the body `body`, which is
 * where a library walking up through parents knows to stop, and where one puts its styles.
 */
export function nameOf(node: EngineNode, engine: Engine): string {
  if (engine.root === node) return 'html';
  const document = documents.get(engine);
  if (document?.body === node) return 'body';
  return document?.head === node ? 'head' : node.tag;
}

/**
 * An element by the names the DOM gives it, as `createElementNS` makes one, given what a
 * template's of its name is given as it is made.
 */
export function elementNamed(engine: Engine, name: QualifiedName): EngineNode {
  const node = engine.createElement(asciiLower(name.localName));
  recordName(node, name);
  madeByScript(node, engine);
  return node;
}

/** The document's `fgColor` and the rest: each the attribute its body reflects, by its own name. */
const COLOURS = {
  fgColor: 'text',
  linkColor: 'link',
  vlinkColor: 'vLink',
  alinkColor: 'aLink',
  bgColor: 'bgColor',
};

function bodyColours(body: EngineNode): PropertyDescriptorMap {
  const reflected = body as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(COLOURS).map(([name, own]) => [
      name,
      {
        get: () => reflected[own],
        set: (value: unknown) => (reflected[own] = value),
        configurable: true,
      },
    ]),
  );
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
  mousedown: 'topTouchStart',
  // A finger moving, which a drag is followed by: it goes on over whatever it crosses.
  pointermove: 'topTouchMove',
  touchmove: 'topTouchMove',
  pointercancel: 'topTouchCancel',
  touchcancel: 'topTouchCancel',
  pointerup: 'topTouchEnd',
  touchend: 'topTouchEnd',
  mouseup: 'topTouchEnd',
  click: 'topTouchEnd',
  // The focus moving anywhere in the page, which a focus monitor and a focus trap listen for.
  focusin: 'topFocus',
  focusout: 'topBlur',
};

type Listener = (event: unknown) => unknown;

/**
 * The apps whose touch in progress was held for a context menu. Lifting that finger is no click,
 * here or on the element: a library closes the menu it just opened on a click outside it.
 */
export const heldForMenu = new WeakSet<Engine>();

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
  // overlay does, is added after a browser has passed the document for that press. But a
  // `mousedown` is sent after its touch, and is owed the touch it is added during.
  const during = type === 'mousedown' ? undefined : delivering();
  const tell = (event: unknown) => {
    if (event === during) return;
    if (type === 'click' && (heldForMenu.has(engine) || wasDrag(engine, event))) return;
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
  };
  // The mouse a touch is, told as a browser tells it: see `mouse-after-touch.ts`.
  if (type === 'mouseup') {
    return engine.setEventListener(engine.root, native, (event) =>
      asMouse(engine, type, event, () => tell(event)),
    );
  }
  if (type !== 'mousedown') return engine.setEventListener(engine.root, native, tell);
  // A browser sends a touch its mouse events once the touch events have been heard, so a
  // listener one of those adds for `mousedown` hears this press: Material's ripple is made so.
  let told: unknown;
  const later = (event: unknown) =>
    setTimeout(() => {
      // Once for a touch, whether it was handed over below or heard at the root as well.
      if (event !== told) asMouse(engine, type, (told = event), () => tell(event));
    });
  const down = touching.get(engine);
  if (down) later(down);
  return engine.setEventListener(engine.root, native, later);
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
/** The touch that began in this turn, by engine: what a `mousedown` listener added in it is due. */
const touching = new WeakMap<Engine, unknown>();
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
    // Until the turn it began in is over.
    touching.set(engine, event);
    setTimeout(() => touching.delete(engine));
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

/** The head of an engine's document, where it has been made. */
export const headOf = (engine: Engine): EngineNode | undefined => documents.get(engine)?.head;

/** The app's document, made the first time it is asked for. */
export function documentFor(engine: Engine): CompatDocument {
  const existing = documents.get(engine);
  if (existing) return existing;
  // Somewhere for a library's style elements to go: never in the tree, so never drawn.
  const head = ownView(engine);
  const body = createBody(engine);
  // The head and then the page, as a document has them: a library looks for a stylesheet it
  // added before it adds one.
  function* everything(): Generator<EngineNode> {
    yield* descendants(head);
    yield* descendants(engine.root);
  }
  /** The elements a query of the document looks at: `<html>`, then the head, then the page. */
  function* elements(): Generator<EngineNode> {
    yield engine.root;
    yield head;
    yield* elementsUnder(head);
    yield* elementsUnder(engine.root);
  }
  const first = (...args: unknown[]): EngineNode | null => {
    required(args, 1, 'querySelector');
    return query(elements(), String(args[0]), engine.root, true)[0] ?? null;
  };
  // A listener on the body hears the whole page, as one on the document does.
  const bodyListeners = anywhere(engine, body);
  /** Its `implementation`, made the first time it is asked for. */
  let implementation: object | undefined;
  /** `forms`, made the first time it is asked: a live list, which follows the page. */
  let forms: HTMLCollection | undefined;
  Object.defineProperties(body, {
    addEventListener: { value: bodyListeners.addEventListener },
    removeEventListener: { value: bodyListeners.removeEventListener },
  });
  const created: CompatDocument = {
    body,
    head,
    documentElement: engine.root,
    // `Node`'s constants, as every node has them.
    ...NODE_CONSTANTS,
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
    previousSibling: null,
    nextSibling: null,
    // What the app's text is, and what its page is, to a library that asks.
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    inputEncoding: 'UTF-8',
    contentType: 'text/html',
    // Its element's `dir`.
    get dir() {
      return (engine.root as unknown as { dir: string }).dir;
    },
    set dir(value: unknown) {
      (engine.root as unknown as { dir: unknown }).dir = value;
    },
    readyState: 'complete',
    visibilityState: 'visible',
    // The field the keyboard belongs to, which a library reads to know one is being typed in.
    get activeElement() {
      return engine.focused ?? body;
    },
    defaultView: globalThis,
    // What scrolls the page, which is its root: the window does not scroll here.
    scrollingElement: engine.root,
    // Its name checked and in lower case, and given what a template's element of the name is.
    createElement(...args: unknown[]) {
      required(args, 1, 'createElement');
      return elementNamed(engine, {
        namespace: XHTML,
        prefix: null,
        localName: asciiLower(checkElementName(String(args[0]))),
      });
    },
    // By the names the DOM gives it, as they are written: a qualified name in a namespace.
    createElementNS(...args: unknown[]) {
      required(args, 2, 'createElementNS');
      return elementNamed(engine, extractName(args[0], String(args[1]), 'element'));
    },
    // Attributes on no element, to set on one: see `attr.ts`.
    createAttribute,
    createAttributeNS,
    createTextNode(...args: unknown[]) {
      required(args, 1, 'createTextNode');
      return engine.createText(String(args[0]));
    },
    // A comment is the engine's anchor, which is never drawn, with its words kept on it.
    createComment(...args: unknown[]) {
      required(args, 1, 'createComment');
      return createComment(engine, args[0]);
    },
    // An anchor too, with its target: see `processing-instruction.ts`. An HTML document has no
    // CDATA sections, and refuses to make one.
    createProcessingInstruction: (...args: unknown[]) => createProcessingInstruction(engine, args),
    createCDATASection: (...args: unknown[]) => createCDATASection(engine, args, true),
    // A box that is never drawn, which puts what it holds where it is put: see
    // `document-fragment.ts`.
    createDocumentFragment: () => markFragment(ownView(engine)),
    // Walked as they are asked: see `traversal.ts`.
    createTreeWalker,
    createNodeIterator,
    getElementById(id: unknown) {
      const wanted = String(id);
      for (const node of everything()) if (node.props['nativeID'] === wanted) return node;
      return null;
    },
    // Live lists, which a library keeps and reads again: see `live-list.ts`.
    getElementsByTagName: (name: unknown) => byTagName(engine, everything, name),
    getElementsByClassName: (names: unknown) => byClassName(engine, everything, names),
    getElementsByName: (name: unknown) => byName(engine, everything, name),
    getElementsByTagNameNS: (namespace: unknown, local: unknown) =>
      byTagNameNS(engine, everything, namespace, local),
    // By a selector: see `selector.ts`.
    querySelector: first,
    querySelectorAll: (...args: unknown[]) => {
      required(args, 1, 'querySelectorAll');
      return query(elements(), args[0], engine.root, false);
    },
    // Every form in the page, as a library finds one by its name: `document.forms.login`.
    get forms() {
      return (forms ??= byTagName(engine, everything, 'form'));
    },
    // Documents a script makes for itself, which are never drawn: see `dom-implementation.ts`.
    get implementation() {
      return (implementation ??= implementationFor(engine, created as never, created));
    },
    // The sheet of each `<style>` in the page, which a script reads the rules of. Those compiled
    // with the app are held by the engine, in no form a browser has, and are not among them.
    get styleSheets() {
      return styleSheetsOf(engine);
    },
    get adoptedStyleSheets() {
      return adoptedOf(engine);
    },
    set adoptedStyleSheets(sheets: Iterable<CSSStyleSheet>) {
      adopt(engine, sheets);
    },
    dispatchEvent: (event: unknown) => dispatch(event, [created, globalThis]),
    // An event to be given its type before it is sent: see `events.ts`.
    createEvent,
    hasFocus: () => true,
  };
  Object.assign(created, anywhere(engine, created));
  Object.assign(created, documentNodeMembers(created as never, false));
  // Its doctype, which is HTML's own, and the root: see `document-children.ts`.
  const doctype = createDocumentType(created, 'html');
  Object.defineProperties(created, documentChildren(created, { element: engine.root, doctype }));
  markRoot(engine.root, created);
  Object.defineProperties(created, bodyColours(body));
  // A node, to `instanceof Node`, as an element is.
  brandNode(created);
  passiveFor(created, body, engine.root);
  documents.set(engine, created);
  return created;
}
