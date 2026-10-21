import { PlatformLocation } from '@angular/common';
import {
  DestroyRef,
  DOCUMENT,
  Injector,
  RendererFactory2,
  effect,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { Engine, extendNodes } from '@ng-native/fabric';
import { DeepLinks, Keyboard, NATIVE_HISTORY } from '@ng-native/device';
import { extendRenderer } from '@ng-native/platform';
import { documentFor } from './document.ts';
import { loadFramesWith, type FrameLoader } from './frame.ts';
import { registerFrameViews, showFramesAs, type FrameMode } from './frame-view.ts';
import { StillLocation } from './location.ts';
import { detectedRoot, installLocation, openPage } from './page-address.ts';
import { touchTarget, webListen } from './listen.ts';
import { registerCanvas } from './canvas.ts';
import { registerImage } from './image.ts';
import { attributeMembers } from './attribute-members.ts';
import { characterDataMembers } from './character-data.ts';
import { forgetCommits } from './commit-watch.ts';
import { eventHandlerMembers } from './event-handlers.ts';
import { pickWith } from './file-input.ts';
import { focusMembers, passOverToldBlurs } from './element-focus.ts';
import { registerElements } from './elements.ts';
import { geometryMembers } from './geometry.ts';
import { withHtmlMembers } from './html-members.ts';
import { htmlMethods } from './html-methods.ts';
import { markupMembers } from './markup-members.ts';
import { nodeMembers, setAttributesWith, type CoreNode } from './node-members.ts';
import { relationMembers } from './node-relations.ts';
import { watchStyles } from './runtime-style.ts';
import { scrollingMembers } from './scrolling.ts';
import { selectorMembers } from './selector-members.ts';
import { registerSvg } from './svg.ts';
import { treeMembers } from './tree-members.ts';
import { installWindow, windowOf } from './window.ts';
import { keyboardMoved, windowHeight } from './window-size.ts';

/** How many apps in the process asked for it: nodes share one prototype, and globals are global. */
let apps = 0;
let removals: (() => void)[] = [];
let removeWindow: (() => void) | undefined;
/** The documents of the apps that are up, oldest first, and the global there was before them. */
const documents: unknown[] = [];
let original: PropertyDescriptor | undefined;

/** Add what every app shares: the node members and the renderer's listeners. */
function install(engine: Engine): void {
  const core = Object.getPrototypeOf(engine.root) as CoreNode;
  // Read now: once extended, the prototype's listeners are this package's.
  const { addEventListener, removeEventListener } = core;
  removals = [
    // The properties of HTML elements over the rest: see `html-members.ts`.
    extendNodes(
      withHtmlMembers({
        // `onclick` and the rest: see `event-handlers.ts`.
        ...eventHandlerMembers,
        ...nodeMembers({ addEventListener, removeEventListener }),
        ...treeMembers,
        ...characterDataMembers,
        ...relationMembers,
        ...attributeMembers,
        ...markupMembers,
        ...htmlMethods,
        ...selectorMembers,
        ...geometryMembers,
        ...scrollingMembers,
        // `focus()`, `blur()` and `click()`: see `element-focus.ts`.
        ...focusMembers,
      }),
    ),
    extendRenderer(webListen),
    registerElements(),
    // The drawing's own elements, as react-native-svg's native views: see `svg.ts`.
    registerSvg(),
    // A canvas, drawn by the same views, and the globals its drawing is asked about by: see
    // `canvas.ts`.
    registerCanvas(),
    // An image, as the platform's image view: see `image.ts`.
    registerImage(),
    // An iframe's native web view, and Angular's `Location` where no router gives one: see
    // `frame-view.ts` and `page-address.ts`.
    registerFrameViews(),
    installLocation(),
  ];
}

/** Take away all of it, the globals too: no app that asked is up. */
function uninstall(): void {
  for (const remove of removals) remove();
  removals = [];
  removeWindow?.();
  removeWindow = undefined;
}

/** Make the global `document` the one given, or what was there before any app, for none. */
function setGlobalDocument(document: unknown): void {
  const globals = globalThis as { document?: unknown };
  if (document !== undefined) globals.document = document;
  else if (original) Object.defineProperty(globalThis, 'document', original);
  else delete globals.document;
}

/** How `provideWebCompat` is set up. */
export interface WebCompatOptions {
  /**
   * The app's address, which the page's address is, with the route on it: what `document.URL`
   * and `window.location` say, and what a relative link resolves against. Expo's where it is not
   * given: the link Expo Go opens the app with, or the app config's scheme in a build (`canary://`
   * is a page at `canary:///orders`). `app://` with neither.
   */
  readonly url?: string;
  /**
   * What reads the URL an `<iframe>`'s `src` names, for the document the frame shows: `fetch`,
   * for an `http` or `https` URL, where it is not given. Answers nothing for one it cannot read.
   */
  readonly loadFrame?: FrameLoader;
  /**
   * How an `<iframe>` is shown. `'webview'`, where it is not given: a native web view, from
   * react-native-webview, which shows the page in it as a browser does, and has no
   * `contentDocument`, as a frame of another origin has none; messages cross with `postMessage`.
   * Where react-native-webview is not installed, it is the emulated document all the same.
   *
   * `'emulated'`: a document of the app's own for each frame, from `about:blank`, `srcdoc` or
   * what `src` names (read with `loadFrame`), which a script reads and writes as a document of
   * the same origin. It is not drawn, and no script in it runs. For what measures or prints in a
   * frame, and for tests that ask what a frame's document holds.
   */
  readonly frames?: FrameMode;
}

/**
 * Let a component library written for the browser render in this app.
 *
 * - Nodes answer to the DOM members such a library calls on its elements: their names and
 *   namespaces, attributes, classes and `dataset`, the properties HTML reflects attributes as,
 *   their markup, the tree around them and every way to change it, the selectors they match and
 *   the elements under them that do, and their listeners.
 * - The HTML elements a library writes that the engine has no view for, a `<button>` or a
 *   `<table>`, are views, and a button and a link have their roles.
 * - `DOCUMENT`, and the global `document`, create engine nodes, with a `body` that draws over the
 *   screen for overlays, it finds elements by a selector, and its `implementation` makes
 *   documents that are never drawn.
 * - Elements say where they are and how big, and one whose style says so scrolls what overflows
 *   it, to be read and written as a browser's is.
 * - The `window` globals a library reads exist: its listeners, `Event`, its size, `screen`,
 *   `matchMedia`, `MutationObserver`, which hears what changes in the tree, `ResizeObserver` and
 *   `IntersectionObserver`, `DOMParser` and `XMLSerializer`, the interfaces of HTML's elements,
 *   and an element with an id as a global of that name.
 * - A `click` listener hears a press, as a `PointerEvent`, and a click does what it does in a
 *   browser: see `activation.ts`. Events are of the kinds a browser has, and `focus()` takes
 *   effect at once: see `event-classes.ts` and `element-focus.ts`.
 * - An `<input>` and a `<textarea>` are the platform's text field, a `<select>` opens a list of
 *   its options, and controls answer as a browser's do: their value, whether they are checked,
 *   their validity and selection, and their form, which is submitted and reset as a browser's
 *   is. See `field.ts`, `select.ts`, `form-controls.ts`, `validity.ts` and `form.ts`.
 * - An `<svg>` is drawn by react-native-svg's native views, with SVG's names, namespace and
 *   geometry members: see `svg.ts`.
 * - A `<canvas>` has a 2D context, whose drawing is shapes those views draw, read back as pixels
 *   and as a PNG: see `canvas.ts`.
 * - The page has an address, the app's own URL and its route, in `document.URL`, `baseURI` and
 *   `window.location`; a relative link resolves against it. See `WebCompatOptions.url`.
 *   `location.assign()` to a page of the app follows it as a link to it is followed, and opens
 *   any other with `Linking`.
 * - Angular's `Location` has a platform to stand on in an app with no router. In one with the
 *   native router, it is the router's.
 * - An `<iframe>` is a native web view, or a document of its own: see `WebCompatOptions.frames`.
 *
 * Nothing is added until this is called, and all of it is taken away again when the last app
 * that asked for it is destroyed.
 */
export function provideWebCompat(options: WebCompatOptions = {}): EnvironmentProviders {
  // Now, not when the app starts: a library reads `window` as it is imported.
  removeWindow ??= installWindow();
  return makeEnvironmentProviders([
    { provide: DOCUMENT, useFactory: () => documentFor(inject(Engine)) },
    // The router's history where it has one, in whichever order the two are provided.
    {
      provide: PlatformLocation,
      useFactory: () =>
        (inject(NATIVE_HISTORY, { optional: true }) as PlatformLocation | null) ??
        new StillLocation(),
    },
    provideEnvironmentInitializer(() => {
      const engine = inject(Engine);
      if (apps === 0) install(engine);
      apps++;
      removeWindow ??= installWindow();
      // A library reads the global as often as the injected one. The newest app up has it.
      if (!documents.length) original = Object.getOwnPropertyDescriptor(globalThis, 'document');
      const document = documentFor(engine);
      documents.push(document);
      setGlobalDocument(document);
      const forgetRenderer = setAttributesWith(
        engine,
        inject(RendererFactory2).createRenderer(null, null),
      );
      const leaveWindow = windowOf(engine);
      // The window ends at the top of the keyboard while it is up: see `window-size.ts`. Where the
      // keyboard is going, which it is said to be as it starts to move. Ended with the app.
      const keyboard = inject(Keyboard);
      effect(() => {
        const { height, screenY } = keyboard.metrics();
        keyboardMoved(engine, height > 0 ? (screenY ?? windowHeight(engine) - height) : undefined);
      });
      // A field's blur is told at once, and native's answer to it passed over: see `element-focus.ts`.
      const heedBlurs = passOverToldBlurs(engine);
      const unwatchStyles = watchStyles(engine);
      const forgetFrames = loadFramesWith(engine, options.loadFrame);
      const forgetFrameMode = showFramesAs(engine, options.frames ?? 'webview');
      const injector = inject(Injector);
      // Read as they are asked for: the router's history is made after this runs.
      const history = () => injector.get(PlatformLocation);
      const closePage = openPage(engine, {
        root: options.url ?? detectedRoot(),
        route: () => `${history().pathname}${history().search}${history().hash}`,
        follow: (route) => injector.get(DeepLinks).follow(route),
        open: (url) => injector.get(DeepLinks).open(url),
      });
      // Where a file input's click finds the system's file picker: see `file-input.ts`.
      const forgetPicker = pickWith(engine, injector);
      // An element a library moves while a finger is on it keeps its touch: see `Engine`.
      engine.holdMovesUnderFinger(true);
      // A touch on a drawing is on the shape a browser finds under the finger: see `listen.ts`.
      engine.setTouchTarget(touchTarget(engine));
      inject(DestroyRef).onDestroy(() => {
        engine.holdMovesUnderFinger(false);
        engine.setTouchTarget(null);
        forgetPicker();
        closePage();
        forgetFrameMode();
        forgetFrames();
        unwatchStyles();
        // What an observer still watching in it heard of its commits: see `commit-watch.ts`.
        forgetCommits(engine);
        forgetRenderer();
        leaveWindow();
        heedBlurs();
        // In whatever order the apps go: the newest still up, or what was there before any.
        documents.splice(documents.indexOf(document), 1);
        setGlobalDocument(documents.at(-1));
        if (--apps === 0) uninstall();
      });
    }),
  ]);
}
