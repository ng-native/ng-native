/**
 * Put an Angular application on a page.
 *
 * The browser counterpart to `@ng-native/platform`'s `mount()`, and named the same on
 * purpose: an app imports one or the other, never both, and which one it gets is the import path's
 * job to say rather than the identifier's. Reading the native one first is worth it - this follows
 * its shape and its documented distinction
 * between `ApplicationRef` and the root `ComponentRef` (`createComponent` resolves the latter;
 * `applicationRef.components` needs it pushed by hand, the same bookkeeping
 * `ApplicationRef.bootstrap()` would otherwise do, for the same reason - a routed app's initial
 * navigation checks `applicationRef.components[0]` before it will run at all).
 *
 * What is different from the native `mount()`, and why:
 *
 * - **The first argument is a real `Element`, not a numeric root tag.** Fabric addresses its root
 *   by the tag React Native's host gave it; a browser page has no such number, only the element
 *   an app mounts into (`document.getElementById('app-root')`, or one `document.body` itself).
 * - **No `FabricUIManager`, and no `Engine` provided under its own token.** Only `HostEngine` is
 *   provided. `worklet-style`, `worklet-scroll` and `native-gesture`
 *   `inject(Engine)` directly (see `packages/fabric/src/host.ts`'s doc comment for why that is
 *   the honest place to draw the line) - on native `Engine` is provided under both tokens so both
 *   paths resolve; here it is provided under neither, so an app that uses one of those three on
 *   the web gets Angular's own `NullInjectorError` at the point it tries to inject `Engine`,
 *   which names exactly what is unsupported rather than rendering something silently wrong.
 * - **`DOCUMENT` is the real `document`**, not the stub the native `mount()` builds for
 *   `TransferState`'s
 *   `getElementById`. A browser host already has one.
 * - **No dev-mode animation warning, no HMR reload hook.** The native check exists
 *   because `@angular/core` reads whether `animate.enter`/`animate.leave` do anything from a
 *   global a Metro polyfill has to set before `@angular/core` first evaluates; a real browser
 *   already has `document.documentElement.getAnimations`, which is the same thing that global
 *   stands in for on native, so there is nothing to warn about. The reload hook is Metro Fast
 *   Refresh's fallback path specifically; a browser dev server has its own, unrelated story for
 *   picking up an edit, so wiring `__angularNativeReload` here would install a hook nothing calls.
 */
import {
  APP_BOOTSTRAP_LISTENER,
  ApplicationRef,
  DOCUMENT,
  PLATFORM_ID,
  EnvironmentInjector,
  ErrorHandler,
  RendererFactory2,
  createComponent,
  createEnvironmentInjector,
  type ComponentRef,
  type EnvironmentProviders,
  type Injector,
  type Provider,
  type Type,
  ɵcreateOrReusePlatformInjector as createOrReusePlatformInjector,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  ɵprovideZonelessChangeDetectionInternal as provideZonelessChangeDetectionInternal,
} from '@angular/core';
import { HostEngine } from '@ng-native/fabric';
import { ColorScheme, Direction, HardwareBack, Screen, StatusBar } from '@ng-native/device';
import {
  browserColorSchemeSource,
  browserDirectionSource,
  browserScreenSource,
} from './device-sources.ts';
import { BrowserEngine } from './browser-engine.ts';
import { BrowserRendererFactory } from './browser-renderer.ts';
import { ISLAND_RESET_CSS, RESET_CSS } from './reset-css.ts';

const RESET_STYLE_ID = 'angular-native-web-reset';
const ISLAND_RESET_STYLE_ID = 'angular-native-web-island-reset';

/**
 * Injects `reset.css`'s content as a `<style>` in `document.head`, once per document. Idempotent,
 * so an app free to call it itself (or to load `reset.css` through its own bundler instead, and
 * pass `injectReset: false` to `mount`) never ends up with the rule twice.
 */
export function injectResetStylesheet(document: Document): void {
  injectStyle(document, RESET_STYLE_ID, RESET_CSS);
}

/**
 * The same for an island inside someone else's page: `ISLAND_RESET_CSS`, which leaves the host's
 * `html` and `body` alone. Its own id, so it sits beside a full reset if the page has both kinds.
 */
export function injectIslandResetStylesheet(document: Document): void {
  injectStyle(document, ISLAND_RESET_STYLE_ID, ISLAND_RESET_CSS);
}

function injectStyle(document: Document, id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  // In Tailwind's `base` layer, below every utility, as `@import '@ng-native/web/reset.css'
  // layer(base)` puts it. Injected unlayered after the app's stylesheet, a reset rule is as
  // specific as a class and later, so it beat `border-2`, `flex-row` and `hidden` alike. With no
  // Tailwind on the page, a layered rule still loses to every unlayered one, as a reset should.
  style.textContent = `@layer base {\n${css}\n}`;
  // First in the head: a layer is ordered by where it is first declared, and the documented entry
  // (theme.css and utilities.css) declares no `base`. Declared after it, `base` came after
  // `utilities` and beat every utility again.
  document.head.insertBefore(style, document.head.firstChild);
}

export interface MountOptions {
  readonly providers?: (Provider | EnvironmentProviders)[];
  /**
   * The component's inputs, by their public name, set before its first render - so an
   * `input.required()` has its value from the start rather than throwing on the first check.
   * Change them afterwards with `componentRef.setInput`.
   */
  readonly inputs?: Readonly<Record<string, unknown>>;
  /**
   * Injects the reset stylesheet into `document.head` before mounting. Defaults to `true`. With
   * `injector` it is the island reset, which leaves the host page's `html` and `body` alone.
   */
  readonly injectReset?: boolean;
  /**
   * Mount inside an existing Angular app instead of as an app of its own: pass an injector from
   * that app - `inject(Injector)` in the component that owns `rootElement` is the usual one.
   *
   * The island then shares the host app's services (anything `providedIn: 'root'`, and anything
   * its `bootstrapApplication` or a component above it provides) and is checked by the host's
   * change detection. Only what the island has to render differently is its own: the renderer,
   * the engine, and the device services that read the browser rather than a phone. See
   * `packages/web/islands.md` in the documentation.
   */
  readonly injector?: Injector;
}

export interface MountResult {
  readonly componentRef: ComponentRef<unknown>;
  /** The island's own app, or with `injector` the host app it was mounted into. */
  readonly applicationRef: ApplicationRef;
  readonly factory: BrowserRendererFactory;
  readonly engine: BrowserEngine;
  /**
   * Takes the island down: its component, and whatever it owns. With `injector` that is only the
   * island - the host app it was mounted into keeps running - so call this rather than
   * `applicationRef.destroy()`, which there would destroy the host.
   */
  destroy(): void;
}

export function mount(
  rootElement: Element,
  component: Type<unknown>,
  options: MountOptions = {},
): MountResult {
  const {
    providers: extraProviders = [],
    inputs = {},
    injectReset = true,
    injector: host,
  } = options;
  const document = rootElement.ownerDocument;
  if (injectReset) {
    if (host) injectIslandResetStylesheet(document);
    else injectResetStylesheet(document);
  }
  // What `reset.css` hangs the root's height off. Stamped rather than required of the app,
  // because an app that forgot it would get a page whose `flex: 1` silently resolved to zero.
  rootElement.setAttribute('data-rn-root', '');
  // What `@ng-native/tailwind`'s `web:` variant matches beneath, as `platform-ios` does on a phone.
  rootElement.classList.add('platform-web');

  const engine = new BrowserEngine(document);
  const factory = new BrowserRendererFactory(engine, document);
  const rootNode = engine.wrapRoot(rootElement) as unknown as Element;
  const own = hostProviders(engine, factory, document.defaultView);

  const mounted = host
    ? mountInside(host, rootElement, rootNode, component, [...own, ...extraProviders], inputs, {
        factory,
        engine,
      })
    : mountAlone(rootNode, component, [...own, ...extraProviders], inputs, document, {
        factory,
        engine,
      });
  // The engine listens on the whole document, so it has to stop once its app is gone, however
  // the app went: through `destroy()` or straight through the component ref.
  mounted.componentRef.onDestroy(() => engine.dispose());
  return mounted;
}

/**
 * What an island has to have of its own, whichever way it is mounted: the renderer and engine
 * that turn `<view>` into a `<div>`, and the device capabilities answered by the browser.
 */
function hostProviders(
  engine: BrowserEngine,
  factory: BrowserRendererFactory,
  view: Document['defaultView'],
): (Provider | EnvironmentProviders)[] {
  return [
    { provide: RendererFactory2, useValue: factory },
    // The one seam the shared packages inject. See the file doc for why `Engine` itself is not
    // also provided here.
    { provide: HostEngine, useValue: engine },
    // The device capabilities, from the browser rather than from React Native. Without these
    // `Screen` falls back to its off-device answer of a zero-sized window, and every component
    // that branches on `compact()` takes the phone tree. See `device-sources.ts`.
    ...(view
      ? [
          { provide: Screen.SOURCE, useValue: browserScreenSource(view) },
          { provide: ColorScheme.SOURCE, useValue: browserColorSchemeSource(view) },
          { provide: Direction.SOURCE, useValue: browserDirectionSource(view) },
        ]
      : []),
    // A tab has no hardware back button, so this is the same inert fallback
    // `hardwareBackSource()`'s own off-device branch answers with - provided directly rather
    // than left to reach it, because its guard is `typeof require === 'function'`, and a
    // bundler that externalises `react-native` for the browser (`rollupOptions.external` in a
    // production build) leaves `require` defined as a stub that throws when called rather than
    // absent. `HardwareBack` is the one of these five capabilities an anchored overlay actually
    // constructs - `Overlay`'s dismiss-on-back wiring injects it - so it is the one this had to
    // stop before reaching that guard at all.
    { provide: HardwareBack.SOURCE, useValue: { subscribe: () => () => {} } },
    // A tab has no status bar either, and for the same reason this cannot be left to
    // `statusBarSource()`: an app that asks for dark icons over a light screen is ordinary, and
    // without this its component throws on that stub and never renders.
    {
      provide: StatusBar.SOURCE,
      useValue: {
        setStyle: () => {},
        setHidden: () => {},
        setBackgroundColor: () => {},
        setTranslucent: () => {},
        height: undefined,
      },
    },
  ];
}

/** An app of its own: its own root injector, change detection and `ApplicationRef`. */
function mountAlone(
  rootNode: Element,
  component: Type<unknown>,
  providers: (Provider | EnvironmentProviders)[],
  inputs: Readonly<Record<string, unknown>>,
  document: Document,
  host: { factory: BrowserRendererFactory; engine: BrowserEngine },
): MountResult {
  // Parent the app injector to the platform injector, exactly as `internalCreateApplication`
  // does and `mount()` documents: some Angular services are `providedIn: 'platform'`, and with a
  // null parent they simply do not exist.
  const platformInjector = createOrReusePlatformInjector();

  const injector = createEnvironmentInjector(
    [
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      provideZonelessChangeDetectionInternal(),
      { provide: DOCUMENT, useValue: document },
      // A DOM is what this is running in, so libraries that check isPlatformBrowser() are right to
      // use it. An island inside an app is the app's own and inherits its value instead.
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: ErrorHandler, useClass: ErrorHandler },
      ...providers,
    ],
    platformInjector as EnvironmentInjector,
  );

  const componentRef = createComponent(component, {
    environmentInjector: injector,
    hostElement: rootNode,
  });
  setInputs(componentRef, inputs);

  const applicationRef = injector.get(ApplicationRef);

  // Mirrors `ApplicationRef.bootstrap()`, which is not used directly because it wants a DOM
  // selector rather than an element `mount`'s own caller already resolved.
  applicationRef.componentTypes.push(component);
  applicationRef.attachView(componentRef.hostView);
  applicationRef.tick();
  // Load-bearing, not bookkeeping: the router's bootstrap listener returns early unless the ref
  // it is handed is `ApplicationRef.components[0]`.
  applicationRef.components.push(componentRef);
  componentRef.onDestroy(() => {
    applicationRef.detachView(componentRef.hostView);
    const at = applicationRef.components.indexOf(componentRef);
    if (at !== -1) applicationRef.components.splice(at, 1);
  });

  for (const listener of injector.get(APP_BOOTSTRAP_LISTENER, [])) {
    listener(componentRef);
  }

  return {
    componentRef,
    applicationRef,
    ...host,
    destroy: () => {
      componentRef.destroy();
      applicationRef.destroy();
    },
  };
}

/**
 * An island inside a running app. Its environment injector is a child of the host's, without a
 * root scope of its own, so anything it does not provide - a `providedIn: 'root'` service, the
 * host's `ApplicationRef` and scheduler, its `ErrorHandler` - resolves from the host, once, for
 * both. What it does provide is only what has to differ: the renderer and engine, the browser's
 * device sources, and the five device services that read them. Those five are provided here as
 * classes so they are built in the island, against its sources, rather than in the host's root
 * against the phone defaults.
 *
 * The host's element injector goes in too, so a service a component above the island provides
 * is visible to it as well as one the app does.
 */
function mountInside(
  hostInjector: Injector,
  rootElement: Element,
  rootNode: Element,
  component: Type<unknown>,
  providers: (Provider | EnvironmentProviders)[],
  inputs: Readonly<Record<string, unknown>>,
  host: { factory: BrowserRendererFactory; engine: BrowserEngine },
): MountResult {
  const injector = createEnvironmentInjector(
    [Screen, ColorScheme, Direction, HardwareBack, StatusBar, ...providers],
    hostInjector.get(EnvironmentInjector),
  );

  const componentRef = createComponent(component, {
    environmentInjector: injector,
    elementInjector: hostInjector,
    hostElement: rootNode,
  });
  setInputs(componentRef, inputs);

  // The host's own change detection checks the island from here on, like any view of its own.
  const applicationRef = hostInjector.get(ApplicationRef);
  applicationRef.attachView(componentRef.hostView);
  componentRef.changeDetectorRef.detectChanges();

  return {
    componentRef,
    applicationRef,
    ...host,
    destroy: () => {
      componentRef.destroy();
      injector.destroy();
      rootElement.removeAttribute('data-rn-root');
      rootElement.classList.remove('platform-web');
    },
  };
}

function setInputs(componentRef: ComponentRef<unknown>, inputs: Readonly<Record<string, unknown>>) {
  for (const [name, value] of Object.entries(inputs)) componentRef.setInput(name, value);
}
