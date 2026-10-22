import type { Engine, EngineNode } from '@ng-native/fabric';
import { parse } from 'parse5';
import { computedStyle } from './computed-style.ts';
import { documentOfRoot } from './document-roots.ts';
import { documentOf } from './document.ts';
import { createDocumentType } from './document-type.ts';
import { implementationFor } from './dom-implementation.ts';
import { dispatch, listen, newEvent, report, unlisten } from './events.ts';
import { detached, treeOf } from './html-tree.ts';
import { domError } from './dom-error.ts';
import { webOrigin } from './page-address.ts';
import { parseUrl } from './parse-url.ts';
import { own, type Reflection } from './reflect.ts';
import { descendants } from './in-document.ts';
import { afterTogether } from './mutation-observer.ts';
import { createNodeIterator, createTreeWalker } from './traversal.ts';
import { mediaQueryList } from './match-media.ts';
import { engineOf, preferences } from './window.ts';
import { deliverMessage, pageOrigin } from './message-event.ts';
import { frameViewCreated, frameViewWindow, isFrameView, keepPlainFrame } from './frame-view.ts';
import { parseXml, type XmlTarget } from './xml.ts';

/**
 * `<iframe>` as an emulated document, where the app asks for it with `frames: 'emulated'` or
 * react-native-webview is not installed: else it is a native web view (see `frame-view.ts`).
 *
 * The frame is a document of its own inside the page, with a window of its own. What a library
 * does with one is read and write that document: measure text in it, print it, edit in it.
 *
 * The frame's document is a made document, as `document.implementation` makes (see
 * `dom-implementation.ts`), with what a document in a window has besides: its URL and
 * `location`, its `defaultView`, listeners, and `open`, `write` and `close`. It is made as the
 * iframe comes into the page, `about:blank` first, and replaced by what `srcdoc` holds or what
 * `src` names as that arrives, when the iframe hears `load`. Taken out of the page, the iframe
 * has neither document nor window again.
 *
 * The window is the page's own globals but for what is the frame's: `document`, `location`,
 * `frameElement`, `parent`, `top`, `name`, its size, its listeners and `postMessage`. Timers,
 * `getComputedStyle`, `DOMException` and the rest are the page's, as is every class: a node of
 * the frame is an `Element` of the page's.
 *
 * `src` is read with `WebCompatOptions.loadFrame`, or with `fetch` for an `http` or `https` URL.
 * HTML is parsed by parse5 and XML by `xml.ts`; text is a `<pre>` and a picture an `<img>`.
 *
 * ponytail: not drawn. The document is never laid out, so a measurement in it is zero, and what
 * it holds is not on the screen. Drawing it would be a view of the iframe's size holding the
 * frame's tree as the page's root holds the page, styled by the frame's own sheets: the engine
 * draws one tree and styles it by one set of sheets now. And a script in the frame's document is
 * not run: a frame's window cannot be a script's global object in one realm, and Hermes has no
 * `with` to stand one in for it.
 */

/** What `src` is, as read: the markup, its type, and where it ended up after any redirect. */
export interface FrameResponse {
  readonly body: string;
  /** `text/html` where it is not given. */
  readonly contentType?: string;
  readonly url?: string;
}

/** What reads the URL a frame's `src` names: nothing where it cannot be read. */
export type FrameLoader = (
  url: string,
) => FrameResponse | undefined | Promise<FrameResponse | undefined>;

/** A frame's window and document, by member. */
type Members = Record<PropertyKey, unknown>;

interface Frame {
  readonly element: EngineNode;
  readonly engine: Engine;
  readonly window: Members;
  /** What a script set on the window, which is the frame's and not the page's. */
  readonly own: Members;
  document: Members;
  url: string;
  /** Counted up by each navigation, so that a load that is no longer wanted is dropped. */
  navigation: number;
  live: boolean;
  /** Told when the element is given another `width` or `height`: its `matchMedia` lists. */
  readonly resized: Set<() => void>;
  /** What its `matchMedia` listeners are told by, each ended as the frame closes. */
  readonly watching: Set<() => void>;
}

const frames = new WeakMap<EngineNode, Frame>();
/** Each frame document's URL, which a fragment changes in place. */
const addresses = new WeakMap<object, string>();
/** Each frame's documents, as they are or were. */
const frameOfDocument = new WeakMap<object, Frame>();
const loaders = new WeakMap<Engine, FrameLoader>();
/** Loads still to arrive, which the page's `load` waits for in a browser. */
const pending = new Set<Promise<void>>();

/**
 * What reads `src` for an app, as `provideWebCompat` is told. Answers what forgets it, and stops
 * watching the app's engine for its iframes.
 */
export function loadFramesWith(engine: Engine, loader: FrameLoader | undefined): () => void {
  loaders.set(engine, loader ?? fetchFrame);
  return () => {
    loaders.delete(engine);
    watched.get(engine)?.();
    watched.delete(engine);
  };
}

async function fetchFrame(url: string): Promise<FrameResponse | undefined> {
  const fetching = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetching || !/^https?:/i.test(url)) return undefined;
  const response = await fetching(url);
  return {
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? undefined,
    url: response.url || url,
  };
}

/** Whether a frame's document is still to arrive. */
export const framesLoading = (): boolean => pending.size > 0;

/** Settled once every frame load started by now, and those they start, has arrived. */
export async function framesLoaded(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}

const later = (run: () => void) => {
  const timer = (globalThis as { setTimeout: (run: () => void, ms: number) => unknown }).setTimeout;
  timer(run, 0);
};

type Dom = EngineNode & {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  readonly baseURI: string;
  readonly ownerDocument: Members | null;
  dispatchEvent(event: unknown): boolean;
};

// The iframe's own

/** `contentDocument`: the frame's document while the iframe is in a page. */
export const contentDocumentOf = (element: EngineNode): unknown =>
  isFrameView(element) ? null : (frames.get(element)?.document ?? null);

/** `contentWindow`. */
export const contentWindowOf = (element: EngineNode): unknown =>
  frameViewWindow(element) ?? frames.get(element)?.window ?? null;

/** What an iframe answers of the frame it holds. */
export const FRAMES: Readonly<Record<string, Readonly<Record<string, Reflection>>>> = {
  iframe: {
    contentDocument: own(contentDocumentOf),
    contentWindow: own(contentWindowOf),
  },
};

/** The window a document is the document of: the page's, or a frame's. */
function windowOfDocument(document: unknown, engine: Engine): object | null {
  if (document === documentOf(engine)) return globalThis;
  const frame = frameOfDocument.get(document as object);
  return frame && frame.document === document && frame.live ? frame.window : null;
}

/** The document a node is in, where that document is in a window: the page, or a live frame. */
function windowedDocumentOf(node: EngineNode): unknown {
  let top = node;
  while (top.parent) top = top.parent;
  const engine = engineOf(node);
  if (top === engine.root) return documentOf(engine);
  const made = documentOfRoot(top);
  return made && windowOfDocument(made, engine) ? made : undefined;
}

// Being put in and taken out

/** What an engine's children are changed by, which an app with an iframe watches. */
const WATCHED = ['appendChild', 'insertBefore', 'removeChild'] as const;

/** The engines whose children are watched for an iframe coming or going, and what stops it. */
const watched = new WeakMap<Engine, () => void>();

/**
 * An iframe has been made in an app that asked for the package: from then until the app is gone
 * its engine's children are watched, for an iframe coming into a page or going out of one. An
 * engine that never made one is never watched.
 */
export function frameCreated(node: EngineNode, engine: Engine): void {
  // A web view is a page of its own: see `frame-view.ts`.
  if (node.tag !== 'iframe') return;
  if (!loaders.has(engine)) return keepPlainFrame(node);
  if (frameViewCreated(node, engine) || watched.has(engine)) return;
  const { appendChild, insertBefore, removeChild } = engine;
  const watching: Pick<Engine, (typeof WATCHED)[number]> = {
    appendChild(parent, child) {
      appendChild.call(this, parent, child);
      connected(child, engine);
    },
    insertBefore(parent, child, before) {
      insertBefore.call(this, parent, child, before);
      connected(child, engine);
    },
    removeChild(parent, child) {
      removeChild.call(this, parent, child);
      disconnected(child);
    },
  };
  const before = WATCHED.map((name) => Object.getOwnPropertyDescriptor(engine, name));
  Object.assign(engine, watching);
  watched.set(engine, () =>
    WATCHED.forEach((name, at) => {
      // What the engine had before, where nothing has been put over this since.
      if (engine[name] !== watching[name]) return;
      const had = before[at];
      if (had) Object.defineProperty(engine, name, had);
      else delete (engine as Partial<Engine>)[name];
    }),
  );
}

/** The iframes of a tree, the top of it among them. */
function* iframesIn(node: EngineNode): Generator<EngineNode> {
  if (node.tag === 'iframe') yield node;
  if (node.nodeKind !== 'element') return;
  for (const each of descendants(node)) if (each.tag === 'iframe') yield each;
}

function connected(node: EngineNode, engine: Engine): void {
  if (node.nodeKind !== 'element') return;
  for (const element of iframesIn(node)) {
    if (isFrameView(element)) continue;
    // Once all a script puts in is in, each in its turn, still where it was put.
    afterTogether(() => {
      if (frames.has(element) || !windowedDocumentOf(element)) return;
      open(element, engine);
    });
  }
}

function disconnected(node: EngineNode): void {
  if (node.nodeKind !== 'element') return;
  for (const element of iframesIn(node)) {
    const frame = frames.get(element);
    if (frame && !windowedDocumentOf(element)) close(frame);
  }
}

/** A made document's own iframes, at the top of it or under it, for a document put in a page. */
export function documentConnected(document: unknown): void {
  const children = (document as { childNodes?: ArrayLike<EngineNode> }).childNodes ?? [];
  for (const node of Array.from(children)) {
    if (node.nodeKind === 'element') connected(node, engineOf(node));
  }
}

/** The iframe has come into a page: it has a window, and `about:blank`, and goes where it says. */
function open(element: EngineNode, engine: Engine): void {
  const own: Members = {};
  const frame = {
    element,
    engine,
    own,
    url: 'about:blank',
    navigation: 0,
    live: true,
    resized: new Set(),
    watching: new Set(),
  } as unknown as Frame;
  (frame as { window: Members }).window = windowFor(frame);
  frame.document = blankDocument(frame);
  frames.set(element, frame);
  attributesChanged(element, true);
}

/** Out of the page: the window is closed, and so is every frame in its document. */
function close(frame: Frame): void {
  frame.live = false;
  frame.navigation++;
  frames.delete(frame.element);
  for (const unwatch of [...frame.watching]) unwatch();
  closeFramesIn(frame.document);
}

/** Every frame in a document that is gone: out of the page, or replaced by another. */
function closeFramesIn(document: Members): void {
  const top = document['documentElement'] as EngineNode | null;
  if (!top) return;
  for (const element of iframesIn(top)) {
    const inner = frames.get(element);
    if (inner) close(inner);
  }
}

/**
 * `src` or `srcdoc` was set or the iframe was put in a page: go where it now says. As it is put
 * in, an iframe with neither, or `about:blank`, has its `load` at once, and stays as it is.
 */
export function attributesChanged(element: EngineNode, inserting = false): void {
  const frame = frames.get(element);
  if (!frame) return;
  const dom = element as Dom;
  if (dom.hasAttribute('srcdoc')) {
    navigate(frame, { srcdoc: dom.getAttribute('srcdoc') ?? '' });
    return;
  }
  const src = dom.getAttribute('src') ?? '';
  const url = src === '' ? 'about:blank' : (parseUrl(src, dom.baseURI)?.href ?? 'about:blank');
  if (inserting && url === 'about:blank') {
    loaded(frame);
    return;
  }
  navigate(frame, { url });
}

/** `src` or `srcdoc` set on an element: where it is an iframe in a page, it goes there. */
export function frameAttributeSet(node: EngineNode, name: string): void {
  if (node.tag !== 'iframe') return;
  const frame = frames.get(node);
  if (!frame) return;
  // Once the attribute is written, which is after this is told of it.
  if (name === 'src' || name === 'srcdoc') queueMicrotask(() => attributesChanged(node));
  if (name === 'width' || name === 'height') {
    queueMicrotask(() => frame.resized.forEach((tell) => tell()));
  }
}

/** Go somewhere: the document is replaced once what is there has been read, and `load` sent. */
function navigate(frame: Frame, to: { url: string } | { srcdoc: string }): void {
  const navigation = ++frame.navigation;
  const settled = (async () => {
    let response: FrameResponse | undefined;
    let url: string;
    if ('srcdoc' in to) {
      url = 'about:srcdoc';
      response = { body: to.srcdoc };
      await new Promise<void>((resolve) => later(resolve));
    } else {
      url = to.url;
      if (url === 'about:blank') {
        await new Promise<void>((resolve) => later(resolve));
      } else {
        try {
          response = await (loaders.get(frame.engine) ?? fetchFrame)(url);
        } catch (error) {
          report(error);
        }
      }
    }
    if (navigation !== frame.navigation) return;
    closeFramesIn(frame.document);
    // What cannot be read is a blank page, and not the one the frame was at before.
    frame.url = response ? (response.url ?? url) : 'about:blank';
    frame.document = response ? documentOfResponse(frame, response) : blankDocument(frame);
    loaded(frame);
  })();
  pending.add(settled);
  void settled.finally(() => pending.delete(settled));
}

/** The frame's document is all there: its `DOMContentLoaded`, the window's `load`, the iframe's. */
function loaded(frame: Frame): void {
  const document = frame.document;
  documentConnected(document);
  send(document, [document, frame.window], 'DOMContentLoaded', { bubbles: true });
  send(frame.window, [frame.window], 'load');
  (frame.element as Dom).dispatchEvent(newEvent('load'));
}

function send(target: Members, path: object[], type: string, init?: object): void {
  const event = newEvent(type, init);
  dispatch(event, path);
  const handler = target[`on${type.toLowerCase()}`];
  if (typeof handler !== 'function') return;
  try {
    handler.call(target, event);
  } catch (error) {
    report(error);
  }
}

// The window

/** The frame's window: the page's globals, with the frame's own over them. */
function windowFor(frame: Frame): Members {
  const { own, element } = frame;
  const dom = element as Dom;
  const parentWindow = () =>
    windowOfDocument(dom.ownerDocument, frame.engine) ?? (globalThis as unknown as Members);
  const size = (side: 'width' | 'height', otherwise: number) => {
    const given = Number.parseFloat(dom.getAttribute(side) ?? '');
    return Number.isFinite(given) ? given : otherwise;
  };
  let window: Members;
  const members: Members = {
    get window() {
      return window;
    },
    get self() {
      return window;
    },
    get frames() {
      return window;
    },
    get globalThis() {
      return window;
    },
    get document() {
      return frame.document;
    },
    get location() {
      return frame.document['location'];
    },
    set location(value: unknown) {
      locate(frame, value);
    },
    get frameElement() {
      return frame.live ? element : null;
    },
    get parent() {
      return frame.live ? parentWindow() : null;
    },
    get top() {
      return frame.live ? ((parentWindow() as { top?: unknown }).top ?? globalThis) : null;
    },
    get opener() {
      return null;
    },
    get closed() {
      return !frame.live;
    },
    get name() {
      return own['name'] ?? dom.getAttribute('name') ?? '';
    },
    set name(value: unknown) {
      own['name'] = String(value);
    },
    get length() {
      return framesOf(frame).length;
    },
    get innerWidth() {
      return size('width', 300);
    },
    get innerHeight() {
      return size('height', 150);
    },
    get outerWidth() {
      return size('width', 300);
    },
    get outerHeight() {
      return size('height', 150);
    },
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      void listen(window, type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      unlisten(window, type, listener, options),
    dispatchEvent: (event: unknown) => dispatch(event, [window]),
    getComputedStyle: computedStyle,
    // By the frame's own size, which its `width` and `height` say, with the page's scheme and
    // motion: see `match-media.ts`.
    matchMedia: (...args: unknown[]) => {
      if (args.length === 0) {
        throw new TypeError("Failed to execute 'matchMedia': 1 argument required.");
      }
      return mediaQueryList(String(args[0]), {
        screen: () => ({
          ...preferences(),
          width: size('width', 300),
          height: size('height', 150),
        }),
        // The frame resized, and the page's scheme or motion changing, which the engine tells
        // its viewport's watchers of.
        watch: (changed) => {
          frame.resized.add(changed);
          const unwatchViewport = frame.engine.watchViewport(changed);
          const unwatch = () => {
            frame.resized.delete(changed);
            unwatchViewport();
            frame.watching.delete(unwatch);
          };
          frame.watching.add(unwatch);
          return unwatch;
        },
      });
    },
    postMessage: (message: unknown, options?: unknown) =>
      postMessage(window, message, options, originOfFrame(frame), pageOrigin(frame.engine)),
    close() {},
    focus() {},
    blur() {},
    print() {},
    stop() {},
  };
  window = new Proxy(own, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      if (Object.hasOwn(members, key)) return Reflect.get(members, key, window);
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        const inner = framesOf(frame)[Number(key)];
        return inner ? (contentWindowOf(inner) ?? undefined) : undefined;
      }
      // Its own handlers, which are none until one is set: the page's are the page's.
      if (typeof key === 'string' && key.startsWith('on') && key in globalThis) return null;
      return Reflect.get(globalThis, key);
    },
    set(target, key, value) {
      const descriptor = Object.getOwnPropertyDescriptor(members, key);
      if (descriptor?.set) descriptor.set.call(window, value);
      else if (!descriptor?.get) target[key] = value;
      return true;
    },
    has: (target, key) => key in target || key in members || key in globalThis,
  });
  return window;
}

/**
 * `window.frames` of the page: the window, with the window of each iframe in the page by its
 * place among them, and how many there are as its `length`.
 *
 * ponytail: `frames` and not the window itself, which is the global object here and cannot be
 * given a property for each frame as it comes and goes. `frames === window` is false.
 */
export const pageFrames: object = new Proxy(globalThis, {
  get(target, key) {
    const top = (target as unknown as { document?: { documentElement?: EngineNode } }).document
      ?.documentElement;
    const inPage = () =>
      top ? [...iframesIn(top)].filter((each) => frames.has(each) || isFrameView(each)) : [];
    if (key === 'length') return inPage().length;
    if (typeof key === 'string' && /^\d+$/.test(key)) {
      const element = inPage()[Number(key)];
      return element ? contentWindowOf(element) : undefined;
    }
    return Reflect.get(target, key);
  },
});

/** The iframes in a frame's document, in order. */
function framesOf(frame: Frame): EngineNode[] {
  const top = frame.document['documentElement'] as EngineNode | null;
  return top ? [...iframesIn(top)] : [];
}

/**
 * `postMessage`: a `message` event on the window, after the task that sent it, where it is for
 * the origin the window is at, with the origin of the page. `source` is the page's window, which
 * is what sends to a frame here. What cannot be copied throws, as it does in a browser.
 */
export function postMessage(
  window: object,
  message: unknown,
  options: unknown,
  at = pageOrigin(),
  from = pageOrigin(),
): void {
  const target =
    typeof options === 'string'
      ? options
      : ((options as { targetOrigin?: string } | undefined)?.targetOrigin ?? '/');
  const wanted = target === '/' ? from : target === '*' ? at : originToPost(target);
  const copy = structuredCopy(message);
  if (wanted !== at) return;
  deliverMessage(window, copy, from, globalThis);
}

/** The origin a message is for, read as the page's own is, so one at the app's scheme is found. */
function originToPost(target: string): string {
  const url = parseUrl(target);
  // A target that is no URL is a mistake a browser says so of.
  if (!url) throw domError(`${target} is not an origin to post to.`, 'SyntaxError');
  return webOrigin(url);
}

const structuredCopy = (value: unknown): unknown => {
  const clone = (globalThis as { structuredClone?: (value: unknown) => unknown }).structuredClone;
  return clone ? clone(value) : value;
};

// The documents

/** A document of the frame's, of a content type: made HTML or XML, empty. */
function emptyDocument(frame: Frame, contentType: string): Members {
  const page = documentOf(frame.engine)!;
  const implementation = implementationFor(frame.engine, page as never, page) as {
    createHTMLDocument(): Members;
    createDocument(namespace: string | null, name: string | null): Members;
  };
  let document: Members;
  if (contentType === 'text/html' || !isXml(contentType)) {
    document = implementation.createHTMLDocument();
    for (const child of Array.from(document['childNodes'] as ArrayLike<unknown>)) {
      (document['removeChild'] as (child: unknown) => void)(child);
    }
  } else {
    document = implementation.createDocument(
      contentType === 'application/xhtml+xml' ? 'http://www.w3.org/1999/xhtml' : null,
      null,
    );
  }
  frameOfDocument.set(document, frame);
  addresses.set(document, frame.url);
  windowed(frame, document, contentType);
  return document;
}

const isXml = (type: string): boolean =>
  /^(text|application)\/xml$/.test(type) || type.endsWith('+xml');

/** `about:blank` as a frame first has it: an `<html>` with an empty head and body. */
function blankDocument(frame: Frame): Members {
  return htmlDocument(frame, '', 'text/html');
}

/** What `src` or `srcdoc` was, as the frame's document. */
function documentOfResponse(frame: Frame, response: FrameResponse): Members {
  const type = (response.contentType ?? 'text/html').split(';')[0]!.trim().toLowerCase();
  if (type === 'text/html') return htmlDocument(frame, response.body, type);
  if (isXml(type)) {
    const document = emptyDocument(frame, type);
    parseXml(response.body, document as unknown as XmlTarget);
    return document;
  }
  // Anything else is shown as a browser shows it: text in a `<pre>`, a picture by itself.
  const document = htmlDocument(frame, '', type);
  const body = document['body'] as { appendChild(node: unknown): void };
  const create = document['createElement'] as (name: string) => Members;
  if (type.startsWith('image/')) {
    const image = create('img');
    (image['setAttribute'] as (name: string, value: string) => void)('src', frame.url);
    body.appendChild(image);
  } else {
    const pre = create('pre');
    pre['textContent'] = response.body;
    body.appendChild(pre);
  }
  return document;
}

/** HTML parsed as a whole document, by parse5, into one of the frame's. */
function htmlDocument(frame: Frame, markup: string, contentType: string): Members {
  const document = emptyDocument(frame, contentType);
  const engine = frame.engine;
  let doctype: [string, string, string] | undefined;
  const adapter: ReturnType<typeof treeOf> = {
    ...treeOf(engine),
    setDocumentType: (_, name, publicId, systemId) => void (doctype = [name, publicId, systemId]),
  };
  const parsed = parse(markup, { treeAdapter: adapter, scriptingEnabled: false });
  const append = document['appendChild'] as (node: unknown) => void;
  if (doctype) {
    try {
      append(createDocumentType(document, ...doctype));
    } catch {
      // A doctype no `createDocumentType` would make: the document has none.
    }
  }
  for (const node of detached(parsed, engine)) append(node);
  const quirks = adapter.getDocumentMode(parsed) === 'quirks';
  Object.defineProperty(document, 'compatMode', {
    value: quirks ? 'BackCompat' : 'CSS1Compat',
    configurable: true,
  });
  return document;
}

/** What a document has in a window, over what a made document has. */
function windowed(frame: Frame, document: Members, contentType: string): void {
  const location = new FrameLocation(frame, document);
  const url = () => addresses.get(document)!;
  let written: string | null = null;
  const writing = (markup: string) => {
    written = (written ?? '') + markup;
    replaceWith(frame, document, written);
  };
  const members: Members = {
    get baseURI() {
      return baseOf(frame, document, url());
    },
    contentType,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    referrer: '',
    get location() {
      return frameOfDocument.get(document)?.document === document && frame.live ? location : null;
    },
    // Set as the window's is, while this is the frame's document: see `locate`.
    set location(value: unknown) {
      if (frameOfDocument.get(document)?.document === document && frame.live) locate(frame, value);
    },
    get defaultView() {
      return frame.document === document && frame.live ? frame.window : null;
    },
    designMode: 'off',
    // What scrolls the frame: its body in quirks mode, as a browser has it, and else its root.
    get scrollingElement() {
      return document['compatMode'] === 'BackCompat'
        ? (document['body'] ?? null)
        : (document['documentElement'] ?? null);
    },
    get activeElement() {
      return document['body'] ?? document['documentElement'] ?? null;
    },
    hasFocus: () => false,
    addEventListener: (type: string, listener: unknown, options?: unknown) =>
      void listen(document, type, listener, options),
    removeEventListener: (type: string, listener: unknown, options?: unknown) =>
      unlisten(document, type, listener, options),
    dispatchEvent: (event: unknown) => dispatch(event, [document, frame.window]),
    createTreeWalker,
    createNodeIterator,
    getSelection: () => (globalThis as { getSelection?: () => unknown }).getSelection?.() ?? null,
    // What a library prints or measures in is written into the frame this way.
    open() {
      written = '';
      replaceWith(frame, document, '');
      return document;
    },
    write: (...markup: unknown[]) => writing(markup.map(String).join('')),
    writeln: (...markup: unknown[]) => writing(`${markup.map(String).join('')}\n`),
    close() {
      written = null;
    },
  };
  const clone = document['cloneNode'] as (deep?: unknown) => Members;
  Object.defineProperties(document, {
    ...Object.getOwnPropertyDescriptors(members),
    URL: { get: url, configurable: true },
    documentURI: { get: url, configurable: true },
    cloneNode: { value: (deep?: unknown) => cloned(document, clone(deep)), configurable: true },
  });
}

/**
 * A copy of a frame's document, in no window: with its URL, type and mode, and the base URL it
 * had as it was copied, which stays as it was whatever is done to the one it was copied from.
 */
function cloned(document: Members, copy: Members): Members {
  const fixed = (value: unknown) => ({ value, configurable: true });
  return Object.defineProperties(copy, {
    URL: fixed(document['URL']),
    documentURI: fixed(document['URL']),
    baseURI: fixed(document['baseURI']),
    contentType: fixed(document['contentType']),
    compatMode: fixed(document['compatMode']),
  });
}

/** What `write` has written so far, parsed again in the document's place. */
function replaceWith(frame: Frame, document: Members, markup: string): void {
  const made = htmlDocument(frame, markup, 'text/html');
  const remove = document['removeChild'] as (node: unknown) => void;
  const append = document['appendChild'] as (node: unknown) => void;
  for (const child of Array.from(document['childNodes'] as ArrayLike<unknown>)) remove(child);
  const from = made['removeChild'] as (node: unknown) => void;
  for (const child of Array.from(made['childNodes'] as ArrayLike<unknown>)) {
    from(child);
    append(child);
  }
  Object.defineProperty(document, 'compatMode', {
    value: made['compatMode'],
    configurable: true,
  });
  documentConnected(document);
}

/** What a URL in a frame's document resolves against: a `<base>`, else its URL or its parent's. */
function baseOf(frame: Frame, document: Members, url: string): string {
  const head = document['head'] as EngineNode | null;
  const base = head?.childList.find(
    (node) => node.tag === 'base' && (node as Dom).hasAttribute('href'),
  ) as Dom | undefined;
  const fallback =
    url === 'about:srcdoc' || url === 'about:blank'
      ? String((frame.element as Dom).baseURI ?? url)
      : url;
  const href = base?.getAttribute('href');
  return (href != null && parseUrl(href, fallback)?.href) || fallback;
}

/**
 * Go to a URL: one that differs from the document's only by a fragment, it is at in place, as a
 * browser scrolls to it, with no load.
 *
 * ponytail: no `hashchange`, as the page sends none either: see `page-address.ts`.
 */
function locate(frame: Frame, value: unknown): void {
  const url = parseUrl(String(value), String(frame.document['baseURI']))?.href;
  if (!url) throw domError(`'${String(value)}' is not a valid URL.`, 'SyntaxError');
  const unfragmented = (at: string) => at.split('#')[0];
  if (!url.includes('#') || unfragmented(url) !== unfragmented(String(frame.document['URL']))) {
    navigate(frame, { url });
    return;
  }
  addresses.set(frame.document, url);
  frame.url = url;
}

/**
 * The origin a frame is at: that of the document it is in, at `about:blank` and `srcdoc`, as a
 * browser has it, and else its URL's. None once it is out of the page.
 */
function originOfFrame(frame: Frame): string {
  const location = frame.document['location'] as { origin?: string } | null;
  return location?.origin ?? 'null';
}

type Part = 'protocol' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash';

/** A frame's `location`: its URL by its parts, and what takes it somewhere else. */
class FrameLocation {
  readonly #frame: Frame;
  readonly #document: Members;

  constructor(frame: Frame, document: Members) {
    this.#frame = frame;
    this.#document = document;
  }

  #part(name: Part): string {
    return parseUrl(this.href)?.[name] ?? '';
  }

  #set(name: Part, value: unknown): void {
    const url = parseUrl(this.href);
    if (!url) return;
    url[name] = String(value);
    this.assign(url.href);
  }

  get href(): string {
    return String(this.#document['URL']);
  }
  set href(value: string) {
    this.assign(value);
  }
  get origin(): string {
    const url = this.href;
    if (!url.startsWith('about:')) return parseUrl(url)?.origin ?? 'null';
    const parent = (this.#frame.element as Dom).ownerDocument?.['location'] as {
      origin?: string;
    } | null;
    return parent?.origin ?? pageOrigin(this.#frame.engine);
  }
  get protocol(): string {
    return this.#part('protocol');
  }
  set protocol(value: string) {
    this.#set('protocol', value);
  }
  get host(): string {
    return this.#part('host');
  }
  set host(value: string) {
    this.#set('host', value);
  }
  get hostname(): string {
    return this.#part('hostname');
  }
  set hostname(value: string) {
    this.#set('hostname', value);
  }
  get port(): string {
    return this.#part('port');
  }
  set port(value: string) {
    this.#set('port', value);
  }
  get pathname(): string {
    return this.#part('pathname');
  }
  set pathname(value: string) {
    this.#set('pathname', value);
  }
  get search(): string {
    return this.#part('search');
  }
  set search(value: string) {
    this.#set('search', value);
  }
  get hash(): string {
    return this.#part('hash');
  }
  set hash(value: string) {
    this.#set('hash', value);
  }
  assign(url: unknown): void {
    locate(this.#frame, url);
  }
  replace(url: unknown): void {
    locate(this.#frame, url);
  }
  reload(): void {
    navigate(this.#frame, { url: this.href });
  }
  toString(): string {
    return this.href;
  }
}
