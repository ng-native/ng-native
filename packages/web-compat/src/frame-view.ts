import {
  markComponentHost,
  registerViewName,
  type Engine,
  type EngineNode,
} from '@ng-native/fabric';
import { domError } from './dom-error.ts';
import { newEvent, report } from './events.ts';
import { deliverMessage, pageOrigin } from './message-event.ts';
import { webOrigin } from './page-address.ts';
import { parseUrl } from './parse-url.ts';

/**
 * `<iframe>` as a native web view: react-native-webview's `RNCWebView`, which shows the frame as
 * a browser does, scripts and all. The element commits as the view, as `<canvas>` commits as
 * react-native-svg's; none of the library's JavaScript is imported.
 *
 * - `src`, resolved against the page's address, is the view's `newSource.uri`; `srcdoc` is its
 *   `newSource.html`, with the page's address as its base where that is an `http`, `https` or
 *   `file` address and the frame has an origin, and neither, or `about:blank`, is an empty page.
 * - It is 300 by 150 points, as a browser has an iframe, under its `width` and `height` and any
 *   stylesheet.
 * - `load` is heard as the page in it finishes loading, or fails to.
 * - `contentDocument` is `null`, as it is for a frame of another origin, and `contentWindow` is
 *   what a page has of such a frame's window: `postMessage`, which dispatches a `message` event in
 *   the page with the app's origin, and its `parent` and `top`. The page's `window.parent` is a
 *   window whose `postMessage` is heard as a `message` event on the app's window, from the
 *   frame's `contentWindow` and its origin. What the page sends with
 *   `window.ReactNativeWebView.postMessage` is heard so too, as the string it is.
 * - The page is the frame's `Referer`, as its `referrerpolicy` says.
 * - `sandbox` without `allow-scripts` runs no script, and without `allow-same-origin` gives the
 *   page no origin, `'null'`, in the messages the app sends and hears; `allow` turns on autoplay, fullscreen and
 *   picture in picture where it lists them, as `allowfullscreen` does fullscreen; `scrolling="no"`
 *   does not scroll; `title` is what a screen reader says. What else is given is left out, and
 *   said in development.
 *
 * Where the view is not installed, an app without react-native-webview or a run in Node, the
 * frame is the emulated document of `frame.ts`, and development says so once. An app asks for
 * that document instead with `provideWebCompat({ frames: 'emulated' })`.
 *
 * ponytail: messages cross as JSON, so a `Map`, a `Date` or a port does not arrive as it was
 * sent, and the page's `window.parent` is a stand-in with `postMessage` alone. A sandbox without
 * `allow-same-origin` is no sandbox for a `src` page: the web view loads it at its own origin,
 * with its storage, and has no way to give it none. The default
 * border a browser draws is not drawn.
 */

/** How an app's iframes are shown. See `WebCompatOptions.frames`. */
export type FrameMode = 'webview' | 'emulated';

/** A `width` or `height` as it is written: so many points, or a percentage of what it is in. */
const points = (value: unknown): number | string | undefined => {
  const text = String(value).trim();
  const number = Number.parseFloat(text);
  if (Number.isNaN(number)) return undefined;
  return text.endsWith('%') ? text : number;
};

/** react-native-webview's Fabric component, on iOS and Android alike. */
const VIEW = 'RNCWebView';

/** What a browser shows: storage, inline video, the app's messages, and no zoom controls. */
const DEFAULTS: Readonly<Record<string, unknown>> = {
  messagingEnabled: true,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  allowsInlineMediaPlayback: true,
  setDisplayZoomControls: false,
};

/** What marks a message the page's `window.parent.postMessage` sent, from one sent by hand. */
const SENT = 'ng-native:frame-message:';

/** What makes the page's `window.parent` a window the app hears, in a page of its own. */
const PARENT = `(function () {
  if (window.parent !== window) return;
  var parent = {
    postMessage: function (data, options) {
      var target = typeof options === 'string' ? options : (options && options.targetOrigin) || '/';
      var bridge = window.ReactNativeWebView;
      if (bridge) bridge.postMessage(${JSON.stringify(SENT)} + JSON.stringify({ data: data, target: target }));
    },
  };
  parent.window = parent;
  parent.self = parent;
  parent.parent = parent;
  parent.top = parent;
  Object.defineProperty(window, 'parent', { get: function () { return parent; }, configurable: true });
})();
true;`;

interface Host {
  __nativeComponentRegistry__hasComponent?: (name: string) => boolean;
  __turboModuleProxy?: (name: string) => unknown;
  nativeModuleProxy?: Record<string, unknown>;
  RN$registerCallableModule?: (name: string, factory: () => object) => void;
}

const host = globalThis as Host;

interface FrameView {
  readonly node: EngineNode;
  readonly engine: Engine;
  readonly moduleName: string;
  readonly window: object;
  /** `src` and `srcdoc` as last set: `null` where the attribute is gone. */
  src: string | null;
  srcdoc: string | null;
  referrerPolicy: string;
  /** Whether `sandbox` is there without `allow-same-origin`, which gives the page no origin. */
  opaque: boolean;
  /** Whether `allow` lists fullscreen, and whether `allowfullscreen` is there: either allows it. */
  fullscreen: { allow: boolean; attribute: boolean };
  /** The URL of the page in the view, as it last said. */
  url: string;
  size: Record<string, number | string>;
}

const modes = new WeakMap<Engine, FrameMode>();
const views = new WeakMap<EngineNode, FrameView>();
/** Each view by the name Android sends its messages and navigations under. */
const byModule = new Map<string, WeakRef<EngineNode>>();
let count = 0;
/** Whether `iframe` is registered as the view, which it is while an app is up and it is there. */
let registered = false;

/**
 * Show an app's iframes as `provideWebCompat` is told. Answers what forgets it, and the name each
 * of its web views is told its messages by, so none is heard after the app is gone.
 */
export function showFramesAs(engine: Engine, mode: FrameMode): () => void {
  modes.set(engine, mode);
  return () => {
    modes.delete(engine);
    for (const [name, node] of byModule) {
      const view = views.get(node.deref() as EngineNode);
      if (!view || view.engine === engine) byModule.delete(name);
    }
  };
}

/** Forget the name of each view whose iframe is gone, as one is made. */
function forgetFramesGone(): void {
  for (const [name, node] of byModule) if (!node.deref()) byModule.delete(name);
}

/** How many views Android's messages are heard for: for a test to see each is forgotten. */
export const framesHeard = (): number => byModule.size;

/**
 * Commit `<iframe>` as the web view where it is installed. Answers what takes it back.
 *
 * Asked of React Native's component registry, which says whether a native component is there
 * without making one, and which Node does not have.
 */
export function registerFrameViews(): () => void {
  if (host.__nativeComponentRegistry__hasComponent?.(VIEW) !== true) return () => {};
  const unregister = registerViewName('iframe', VIEW, DEFAULTS, { yieldsToComponents: true });
  registered = true;
  listenOnAndroid();
  return () => {
    registered = false;
    unregister();
  };
}

/**
 * An iframe of an app that did not ask for the package: the plain view it is without it, where
 * the web view is registered for the apps that did.
 */
export function keepPlainFrame(node: EngineNode): void {
  if (registered) markComponentHost(node);
}

/** Whether an element is an iframe shown as a web view. */
export const isFrameView = (node: EngineNode): boolean => views.has(node);

/** The `contentWindow` of an iframe shown as a web view: undefined for any other element. */
export const frameViewWindow = (node: EngineNode): object | undefined => views.get(node)?.window;

/**
 * An iframe has been made: a web view where its app shows them so and the view is installed.
 * Answers whether it is one; where it is not, it is a plain view, which the emulated document is
 * in, and development is told once where the view was wanted and is not there.
 */
export function frameViewCreated(node: EngineNode, engine: Engine): boolean {
  if (node.tag !== 'iframe') return false;
  const wanted = (modes.get(engine) ?? 'webview') === 'webview';
  if (!registered || !wanted) {
    if (registered) markComponentHost(node);
    if (wanted && host.__nativeComponentRegistry__hasComponent) {
      warnOnce(
        'absent',
        'an <iframe> is shown as an emulated document that is not drawn: install ' +
          'react-native-webview (npx expo install react-native-webview) to show it as a web view.',
      );
    }
    return false;
  }
  forgetFramesGone();
  const moduleName = `NgNativeFrame${++count}`;
  const view = {
    node,
    engine,
    moduleName,
    src: null,
    srcdoc: null,
    referrerPolicy: '',
    opaque: false,
    fullscreen: { allow: false, attribute: false },
    url: 'about:blank',
    size: {},
  } as unknown as FrameView;
  (view as { window: object }).window = windowFor(view);
  views.set(node, view);
  byModule.set(moduleName, new WeakRef(node));
  engine.setProp(node, 'newSource', { html: '' });
  engine.setProp(node, 'messagingModuleName', moduleName);
  engine.setProp(node, 'injectedJavaScriptBeforeContentLoaded', PARENT);
  resize(view);
  const loaded = (event: unknown) => {
    const url = nativeOf<{ url?: string }>(event).url;
    if (url) view.url = url;
    (node as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(newEvent('load'));
  };
  engine.setEventListener(node, 'topLoadingFinish', loaded);
  engine.setEventListener(node, 'topLoadingError', loaded);
  engine.setEventListener(node, 'topShouldStartLoadWithRequest', (event) => allow(event));
  engine.setEventListener(node, 'topMessage', (event) => receive(view, nativeOf(event)));
  return true;
}

const nativeOf = <T>(event: unknown): T => {
  const given = (event ?? {}) as { nativeEvent?: T };
  return (given.nativeEvent ?? given) as T;
};

/** What the view does with an iframe's attribute. Answers whether it took it. */
export function setFrameView(
  node: EngineNode,
  name: string,
  value: unknown,
  engine: Engine,
): boolean {
  const view = views.get(node);
  const attribute = name.toLowerCase();
  const take = view && Object.hasOwn(ATTRIBUTES, attribute) ? ATTRIBUTES[attribute] : undefined;
  if (!view || !take) return false;
  take(view, value == null || value === false ? null : String(value), engine);
  return true;
}

type Take = (view: FrameView, given: string | null, engine: Engine) => void;

/** Taken and left as it is: nothing a web view shows differently. */
const kept: Take = () => {};

/** Taken and left out, which development is told. */
const leftOutBy =
  (attribute: string): Take =>
  (_, given) => {
    if (given !== null) leftOut(attribute, given);
  };

const showSource: Take = (view, _, engine) => {
  engine.setProp(view.node, 'newSource', sourceOf(view));
  if (view.opaque && view.srcdoc === null && view.src !== null) {
    warnOnce(
      'opaque',
      "an <iframe>'s sandbox without allow-same-origin gives its src page no origin in the " +
        'messages the app sends and hears, but a native web view still loads the page at its own ' +
        'origin, with its storage and cookies.',
    );
  }
};

const showFullscreen = (view: FrameView, engine: Engine) =>
  engine.setProp(
    view.node,
    'allowsFullscreenVideo',
    view.fullscreen.allow || view.fullscreen.attribute,
  );

const sizeBy =
  (side: 'width' | 'height'): Take =>
  (view, given) => {
    const length = given === null ? undefined : points(given);
    if (length === undefined) delete view.size[side];
    else view.size[side] = length;
    resize(view);
  };

/** What of `sandbox` the view does: scripts, and the page's origin. */
const SANDBOX_TAKEN = new Set(['allow-scripts', 'allow-same-origin']);

/** Each attribute of an iframe the view takes, and what it does with it. */
const ATTRIBUTES: Readonly<Record<string, Take>> = {
  src: (view, given, engine) => {
    view.src = given;
    // The page it goes to is the one it is at, before it has loaded: see `originOf`.
    if (view.srcdoc === null) view.url = pendingUrl(view);
    showSource(view, given, engine);
  },
  srcdoc: (view, given, engine) => {
    view.srcdoc = given;
    // Where the page the frame showed was is not where what it holds is, and the other way.
    view.url = given !== null ? 'about:srcdoc' : pendingUrl(view);
    showSource(view, given, engine);
  },
  width: sizeBy('width'),
  height: sizeBy('height'),
  sandbox: (view, given, engine) => {
    const tokens = (given ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    engine.setProp(
      view.node,
      'javaScriptEnabled',
      given === null || tokens.includes('allow-scripts'),
    );
    view.opaque = given !== null && !tokens.includes('allow-same-origin');
    // What `srcdoc` holds loads from the page's address only where it is of the page's origin.
    showSource(view, given, engine);
    const unmapped = tokens.filter((token) => !SANDBOX_TAKEN.has(token));
    if (unmapped.length) leftOut('sandbox', unmapped.join(' '));
  },
  allow: (view, given, engine) => {
    const { node } = view;
    const features = allowed(given ?? '');
    engine.setProp(node, 'mediaPlaybackRequiresUserAction', !features.includes('autoplay'));
    view.fullscreen.allow = features.includes('fullscreen');
    showFullscreen(view, engine);
    engine.setProp(
      node,
      'allowsPictureInPictureMediaPlayback',
      given === null || features.includes('picture-in-picture'),
    );
  },
  allowfullscreen: (view, given, engine) => {
    view.fullscreen.attribute = given !== null;
    showFullscreen(view, engine);
  },
  scrolling: ({ node }, given, engine) =>
    engine.setProp(node, 'scrollEnabled', given?.toLowerCase() !== 'no'),
  title: ({ node }, given, engine) => engine.setProp(node, 'accessibilityLabel', given),
  name: kept,
  frameborder: kept,
  marginwidth: kept,
  marginheight: kept,
  longdesc: kept,
  align: kept,
  referrerpolicy: (view, given, engine) => {
    view.referrerPolicy = (given ?? '').trim().toLowerCase();
    showSource(view, given, engine);
  },
  loading: leftOutBy('loading'),
  csp: leftOutBy('csp'),
  credentialless: leftOutBy('credentialless'),
  allowpaymentrequest: leftOutBy('allowpaymentrequest'),
};

/**
 * The features `allow` allows: each named with an allowlist of its own, or with none, which is
 * the frame's own origin. One whose allowlist is `'none'` is allowed nowhere.
 *
 * ponytail: an allowlist of origins is taken as the frame's, whichever origins it names.
 */
function allowed(given: string): string[] {
  return given.split(';').flatMap((directive) => {
    const [name, ...allowlist] = directive.trim().toLowerCase().split(/\s+/);
    return name && (!allowlist.length || allowlist.some((each) => each !== "'none'")) ? [name] : [];
  });
}

/** The address `src` names, resolved against the page's, or a blank page for none. */
function pendingUrl(view: FrameView): string {
  const base = String((view.node as unknown as { baseURI?: string }).baseURI ?? '');
  return (view.src ? parseUrl(view.src, base)?.href : undefined) ?? 'about:blank';
}

/**
 * The base the web view loads what `srcdoc` holds from: the page's address where it is a web
 * address, and the frame is of the page's origin. None for any other, which loads at `about:`.
 */
function srcdocBase(view: FrameView): string | undefined {
  const base = String((view.node as unknown as { baseURI?: string }).baseURI ?? '');
  return !view.opaque && /^(https?|file):/i.test(base) ? base : undefined;
}

/** What the view shows: what `srcdoc` holds, or the page `src` names, or an empty page. */
function sourceOf(view: FrameView): Record<string, unknown> {
  const base = String((view.node as unknown as { baseURI?: string }).baseURI ?? '');
  if (view.srcdoc !== null) {
    const baseUrl = srcdocBase(view);
    return baseUrl ? { html: view.srcdoc, baseUrl } : { html: view.srcdoc };
  }
  const url = view.src ? parseUrl(view.src, base)?.href : undefined;
  if (!url || url === 'about:blank') return { html: '' };
  const referrer = referrerOf(view.referrerPolicy, base, url);
  return referrer ? { uri: url, headers: [{ name: 'Referer', value: referrer }] } : { uri: url };
}

/**
 * What a browser sends as the frame's `Referer`, by its `referrerpolicy`: the page's whole
 * address to its own origin, and its origin alone to another, by default. Nothing from a page
 * whose address is not a web address, as Expo Go's `exp://` is not.
 *
 * ponytail: the request for the frame's page only, and not what that page asks for after.
 */
function referrerOf(policy: string, page: string, url: string): string | undefined {
  const from = parseUrl(page);
  const to = parseUrl(url);
  if (!from || !to || !/^https?:$/.test(from.protocol)) return undefined;
  // Never the name and password the page's address may hold, or its fragment.
  const bare = parseUrl(page)!;
  bare.username = '';
  bare.password = '';
  bare.hash = '';
  const sent = {
    whole: bare.href,
    origin: `${from.origin}/`,
    same: from.origin === to.origin,
    downgrade: from.protocol === 'https:' && to.protocol !== 'https:',
  };
  const known = Object.hasOwn(REFERRER_POLICIES, policy)
    ? policy
    : 'strict-origin-when-cross-origin';
  return REFERRER_POLICIES[known]!(sent);
}

interface Sent {
  readonly whole: string;
  readonly origin: string;
  readonly same: boolean;
  readonly downgrade: boolean;
}

/** Each referrer policy, by what it sends; any other is the default, the last. */
const REFERRER_POLICIES: Readonly<Record<string, (sent: Sent) => string | undefined>> = {
  'no-referrer': () => undefined,
  'unsafe-url': ({ whole }) => whole,
  origin: ({ origin }) => origin,
  'same-origin': ({ same, whole }) => (same ? whole : undefined),
  'origin-when-cross-origin': ({ same, whole, origin }) => (same ? whole : origin),
  'strict-origin': ({ downgrade, origin }) => (downgrade ? undefined : origin),
  'no-referrer-when-downgrade': ({ downgrade, whole }) => (downgrade ? undefined : whole),
  'strict-origin-when-cross-origin': ({ same, whole, downgrade, origin }) =>
    same ? whole : downgrade ? undefined : origin,
};

function resize(view: FrameView): void {
  view.engine.setDefaultStyle(view.node, { width: 300, height: 150, ...view.size });
}

/**
 * The origin of the page in the frame: none, `'null'`, in a sandbox without `allow-same-origin`,
 * as a browser has it, and otherwise the app's for a blank page and for what `srcdoc` holds, at
 * the base it loads from, until it goes somewhere else: a `data:` URL is of no origin.
 */
function originOf(view: FrameView): string {
  if (view.opaque) return 'null';
  if (/^about:/i.test(view.url)) return pageOrigin(view.engine);
  if (view.srcdoc !== null && view.url === srcdocBase(view)) return pageOrigin(view.engine);
  return parseUrl(view.url)?.origin ?? 'null';
}

/** Whether a message is for an origin: anyone's, the sender's own, or that one. */
function addressed(target: string, origin: string, sender: string): boolean {
  if (target === '*') return true;
  if (target === '/') return origin === sender;
  // As the page's own is read, so one at the app's scheme, `exp://` in Expo Go, is found.
  const url = parseUrl(target);
  return !!url && webOrigin(url) === origin;
}

// The frame's window, as the app has it

function windowFor(view: FrameView): object {
  const { node, engine } = view;
  const connected = () => {
    let top = node;
    while (top.parent) top = top.parent;
    return top === engine.root;
  };
  const window: object = {
    get window() {
      return window;
    },
    get self() {
      return window;
    },
    get frames() {
      return window;
    },
    get parent() {
      return connected() ? globalThis : null;
    },
    get top() {
      return connected() ? globalThis : null;
    },
    get opener() {
      return null;
    },
    get frameElement() {
      return null;
    },
    get closed() {
      return !connected();
    },
    get length() {
      return 0;
    },
    postMessage(message: unknown, options?: unknown) {
      const target =
        typeof options === 'string'
          ? options
          : ((options as { targetOrigin?: string } | undefined)?.targetOrigin ?? '/');
      // A target that is no URL is a mistake a browser says so of.
      if (target !== '*' && target !== '/' && !parseUrl(target)) {
        throw domError(`${target} is not an origin to post to.`, 'SyntaxError');
      }
      const origin = originOf(view);
      if (!addressed(target, origin, pageOrigin(engine))) return;
      // Asked again of the page itself, which may have gone elsewhere since it last said where, or
      // not yet have gone where it is going. What is for the app's own origin is for a page with
      // it, or one with no web origin, as what `srcdoc` holds reads on Android: not a page of
      // another site still there.
      const wanted = JSON.stringify(target === '*' ? null : origin);
      const own = origin === pageOrigin(engine);
      const json = JSON.stringify({ data: message }) ?? '{}';
      engine.dispatchCommand(node, 'injectJavaScript', [
        // The source is set after: a browser's event takes none but a window or a port.
        `(function () { var at = window.location; if (${wanted} !== null && at.origin !== ` +
          `${wanted} && !(${own} && !/^https?:$/.test(at.protocol))) return; ` +
          `var data = JSON.parse(${JSON.stringify(json)}).data; ` +
          `var event = new MessageEvent('message', { data: data, ` +
          `origin: ${JSON.stringify(pageOrigin(engine))} }); ` +
          `Object.defineProperty(event, 'source', { value: window.parent }); ` +
          `window.dispatchEvent(event); })(); true;`,
      ]);
    },
    focus() {
      engine.dispatchCommand(node, 'requestFocus');
    },
    blur() {},
    close() {},
  };
  return window;
}

// What the view says

/** A message from the page: a `message` event on the app's window, where it is for the app. */
function receive(view: FrameView, event: { data?: unknown; url?: string }): void {
  const data = typeof event.data === 'string' ? event.data : String(event.data ?? '');
  const origin = senderOf(view, event.url);
  if (!data.startsWith(SENT)) {
    deliverMessage(globalThis, data, origin, view.window);
    return;
  }
  let sent: { data?: unknown; target?: string } | null;
  try {
    sent = JSON.parse(data.slice(SENT.length)) as typeof sent;
  } catch (error) {
    report(error);
    return;
  }
  // What the frame's own script sends is an object: anything else is not from it.
  if (typeof sent !== 'object' || !sent) return;
  if (!addressed(String(sent.target ?? '/'), pageOrigin(view.engine), origin)) return;
  deliverMessage(globalThis, sent.data, origin, view.window);
}

/**
 * The origin of what sent a message, by the URL the view says it is from: on Android, that of the
 * frame in the page that sent it, which may be another site's. It says where that one message is
 * from, and not where the page is: that is for the page's loads to say.
 */
function senderOf(view: FrameView, url: string | undefined): string {
  if (view.opaque || !url || /^about:/i.test(url)) return originOf(view);
  // One the platform could not say as a URL, such as an opaque frame's `null`, is no web origin:
  // never the frame's own, which the app trusts.
  return parseUrl(url)?.origin ?? 'null';
}

/** Let a navigation go ahead, where the platform holds it until it is told: iOS, every time. */
function allow(event: unknown): void {
  const lock = nativeOf<{ lockIdentifier?: number }>(event).lockIdentifier;
  if (lock === undefined) return;
  const module = (host.__turboModuleProxy?.('RNCWebViewModule') ??
    host.nativeModuleProxy?.['RNCWebViewModule']) as
    { shouldStartLoadWithLockIdentifier?: (start: boolean, lock: number) => void } | undefined;
  module?.shouldStartLoadWithLockIdentifier?.(true, lock);
}

/**
 * Android sends a web view's messages, and the navigations it holds, to a JavaScript module
 * react-native-webview registers as its own JavaScript is imported, by the view's
 * `messagingModuleName`. That module is this one here.
 *
 * ponytail: one module for the process, as the library's own is, so an app that imports the
 * library's JavaScript as well has one of the two.
 */
let listening = false;
function listenOnAndroid(): void {
  if (listening || !host.RN$registerCallableModule) return;
  listening = true;
  type Sent = { messagingModuleName?: string; nativeEvent?: { data?: unknown; url?: string } };
  const viewOf = (event: Sent) => {
    const node = byModule.get(event.messagingModuleName ?? '')?.deref();
    return node ? views.get(node) : undefined;
  };
  host.RN$registerCallableModule('RNCWebViewMessagingModule', () => ({
    onShouldStartLoadWithRequest: (event: Sent) => allow(event),
    onMessage(event: Sent) {
      const view = viewOf(event);
      if (view) receive(view, event.nativeEvent ?? {});
    },
  }));
}

// What development is told

const told = new Set<string>();

function warnOnce(key: string, message: string): void {
  if ((typeof __DEV__ !== 'undefined' && !__DEV__) || told.has(key)) return;
  told.add(key);
  console.warn(`[angular-native] ${message}`);
}

function leftOut(attribute: string, value: string): void {
  warnOnce(
    attribute,
    `an <iframe>'s ${attribute}="${value}" is not something a native web view does, and is left out.`,
  );
}

declare const __DEV__: boolean | undefined;
