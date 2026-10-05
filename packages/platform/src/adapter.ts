/**
 * Where the engine meets Angular, which the engine itself never imports: Renderer2 over the
 * engine, plus bootstrap.
 *
 * Bootstrap leans on private `ɵ` exports of `@angular/core`, which can change in any major.
 * `bootstrap.test.ts` asserts each one still exists, so an upgrade fails there rather than on a
 * device.
 */
import {
  APP_BOOTSTRAP_LISTENER,
  ApplicationInitStatus,
  ApplicationRef,
  DOCUMENT,
  ErrorHandler,
  Renderer2,
  RendererFactory2,
  createComponent,
  createEnvironmentInjector,
  PLATFORM_ID,
  type Binding,
  type ComponentRef,
  type EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
  type RendererStyleFlags2,
  type Type,
  ɵcreateOrReusePlatformInjector as createOrReusePlatformInjector,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
  ɵprovideZonelessChangeDetectionInternal as provideZonelessChangeDetectionInternal,
} from '@angular/core';
import { installDateParse } from './date-parse.ts';
import { PLATFORM_NATIVE_ID } from './platform-id.ts';
import {
  Engine,
  firstFamily,
  HostEngine,
  installDeferTriggers,
  markComponentHost,
  nativePlatform,
  onFontsRegistered,
  onFontsSettled,
  reportUnboundFormsInput,
  styleSheetOf,
  type EngineNode,
  type EngineOptions,
  type FabricUIManager,
  type NativeAnimated,
  type StyleSheet,
} from '@ng-native/fabric';
import { calmLoadingBanner, type LoadingBanner } from './dev-loading-view.ts';
import { installHotEpoch } from './hot-epoch.ts';

/**
 * Angular `(touchEnd)` -> Fabric `topTouchEnd`.
 *
 * There is no alias for `press`: `onPress` is not a native event, RN synthesises it in JS from
 * the touch responder system. `Pressable` in `components.ts` does the same, and because Angular
 * resolves a directive output before an element event, `(press)` on a `<pressable>` binds to
 * that output rather than reaching the renderer at all.
 */
function topLevelType(eventName: string): string {
  return 'top' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
}

/**
 * What Angular's compiler emits for a style binding is aimed at the DOM: `[style.font-size]`
 * arrives dash-cased, and `[style.width.px]` arrives as the string `'10px'`. Fabric reads
 * camelCase keys and plain numbers, and drops both forms without a word.
 */
const PX = /^-?\d*\.?\d+px$/;
const NUMBER = /^-?\d*\.?\d+$/;
const styleKey = (name: string): string =>
  name.includes('-') ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : name;
/**
 * A bare number arrives as a string too, and Yoga wants a number.
 *
 * Angular parses `[style]="'flex: 1'"` itself and calls `setStyle('flex', '1')`, so the same
 * declaration written as an object gave `1` and written as a string gave `'1'` - the two spellings
 * of one design disagreeing at the only layer that can tell.
 */
const styleValue = (value: unknown): unknown =>
  typeof value === 'string' && (PX.test(value) || NUMBER.test(value)) ? parseFloat(value) : value;
/**
 * A `font-family` is a stack, quoted or not, where native takes one family by name: the first,
 * unquoted, as a stylesheet rule commits it. Left as written, `'Inter-Bold'` names no font.
 */
const declaredValue = (key: string, value: unknown): unknown =>
  key === 'fontFamily' && typeof value === 'string'
    ? (firstFamily(value) ?? value)
    : styleValue(value);

/**
 * A bound custom property's name, as it was written. Angular 22 compiles `[style.--tint]` to
 * `--%NS%tint`, for a DOM renderer to fill with a namespace; there is none here.
 */
const customPropertyName = (style: string): string => style.replace(/%NS%/g, '');

/**
 * `flex: 1; margin-top: 4px` -> `{ flex: 1, marginTop: 4 }`.
 *
 * Only the static-attribute path needs this. Angular compiles `[style]` and `[style.x]` into
 * styling instructions that parse the string themselves and arrive one declaration at a time; a
 * *static* `style="..."` is not a binding at all, so it comes through `setAttribute` whole.
 *
 * Splitting on `;` and `:` rather than parsing properly, because the values that reach here are
 * lengths, numbers, keywords, colours and font families. A `url()` or a family name containing
 * either character would be cut in the wrong place.
 */
function parseStyleAttribute(css: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const declaration of css.split(';')) {
    const at = declaration.indexOf(':');
    if (at === -1) continue;
    const name = declaration.slice(0, at).trim();
    const value = declaration.slice(at + 1).trim();
    // A custom property keeps its name, which is case-sensitive, and its text for the engine.
    if (name.startsWith('--')) out[name] = value;
    else if (name) out[styleKey(name)] = declaredValue(styleKey(name), value);
  }
  return out;
}

class NativeRenderer implements Renderer2 {
  readonly data: { [key: string]: unknown } = Object.create(null);
  destroyNode: (node: EngineNode) => void;

  private readonly engine: Engine;
  /** The creating component's compiled CSS. Elements this renderer makes are matched against it. */
  private readonly sheet: StyleSheet | null;

  constructor(engine: Engine, sheet: StyleSheet | null = null) {
    this.engine = engine;
    this.sheet = sheet;
    this.destroyNode = (node) => this.engine.destroyNode(node);
  }

  destroy(): void {}

  createElement(name: string): EngineNode {
    return this.engine.createElement(name, this.sheet);
  }

  createComment(): EngineNode {
    return this.engine.createAnchor();
  }

  createText(value: string): EngineNode {
    return this.engine.createText(value);
  }

  appendChild(parent: EngineNode, newChild: EngineNode): void {
    this.engine.appendChild(parent, newChild);
  }

  insertBefore(parent: EngineNode, newChild: EngineNode, refChild: EngineNode | null): void {
    if (!parent) return;
    this.engine.insertBefore(parent, newChild, refChild);
  }

  removeChild(parent: EngineNode | null, oldChild: EngineNode): void {
    this.engine.removeChild(parent, oldChild);
  }

  selectRootElement(selectorOrNode: string | EngineNode): EngineNode {
    if (typeof selectorOrNode !== 'string') return selectorOrNode;
    return this.engine.root;
  }

  parentNode(node: EngineNode): EngineNode | null {
    return this.engine.parentNode(node);
  }

  nextSibling(node: EngineNode): EngineNode | null {
    return this.engine.nextSibling(node);
  }

  setAttribute(el: EngineNode, name: string, value: string): void {
    // `class` drives selector matching, not a native prop: nothing on the native side reads it.
    if (name === 'class') {
      this.engine.setClasses(el, value);
      return;
    }
    /*
     * A *static* `style="flex: 1"` is not a binding, so it never becomes a styling instruction -
     * it arrives here as one attribute holding the whole declaration list. Handing that string on
     * as the `style` prop meant Fabric received a string where it merges objects, which it drops
     * without a word: every static style in the codebase, and in this project's own doc comments,
     * was doing nothing at all.
     */
    if (name === 'style') {
      for (const [key, next] of Object.entries(parseStyleAttribute(value))) {
        this.setStyle(el, key, next);
      }
      return;
    }
    this.engine.setProp(el, name, value);
  }

  removeAttribute(el: EngineNode, name: string): void {
    this.engine.setProp(el, name, null);
  }

  addClass(el: EngineNode, name: string): void {
    this.engine.addClass(el, name);
  }

  removeClass(el: EngineNode, name: string): void {
    this.engine.removeClass(el, name);
  }

  setStyle(el: EngineNode, style: string, value: unknown, _flags?: RendererStyleFlags2): void {
    if (style.startsWith('--')) {
      this.engine.setCustomProperty(el, customPropertyName(style), value);
      return;
    }
    const key = styleKey(style);
    // A `var()` is for the cascade to settle, with the tokens in scope, not a value of the style.
    if (this.engine.setBoundStyle(el, key, value)) return this.dropStyle(el, key);
    const next = declaredValue(key, value);
    const current = el.props['style'] as Record<string, unknown> | undefined;
    if (current && current === el.ownStyle) {
      if (current[key] === next) return;
      current[key] = next;
      this.engine.styleChanged(el);
      return;
    }
    const owned = { ...(current ?? {}), [key]: next };
    el.ownStyle = owned;
    this.engine.setProp(el, 'style', owned);
  }

  removeStyle(el: EngineNode, style: string, _flags?: RendererStyleFlags2): void {
    if (style.startsWith('--')) {
      this.engine.setCustomProperty(el, customPropertyName(style), null);
      return;
    }
    const key = styleKey(style);
    this.engine.setBoundStyle(el, key, null);
    this.dropStyle(el, key);
  }

  /** Takes `key` out of an element's inline style, if it is there. */
  private dropStyle(el: EngineNode, key: string): void {
    const current = el.props['style'] as Record<string, unknown> | undefined;
    if (!current || !(key in current)) return;
    if (current === el.ownStyle) {
      delete current[key];
      this.engine.styleChanged(el);
      return;
    }
    const { [key]: _removed, ...rest } = current;
    el.ownStyle = rest;
    this.engine.setProp(el, 'style', rest);
  }

  setProperty(el: EngineNode, name: string, value: unknown): void {
    if (this.engine.dev) reportUnboundFormsInput(this.engine, el, name);
    this.engine.setProp(el, name, value);
  }

  setValue(node: EngineNode, value: string): void {
    this.engine.setText(node, value);
  }

  listen(
    target: EngineNode | string,
    eventName: string,
    callback: (event: unknown) => boolean | void,
  ): () => void {
    // Angular's names for a global target, 'window', 'document' and 'body': there is none here.
    if (typeof target === 'string') return () => {};
    return this.engine.setEventListener(target, topLevelType(eventName), callback);
  }
}

/**
 * The slice of Angular's component definition `createRenderer` receives that says which element
 * names a template can legitimately contain. Private shape, read only to keep the engine's typo
 * check quiet, so a missing piece means "nothing to declare" rather than an error.
 */
interface ComponentDefLike {
  id?: string;
  type?: unknown;
  encapsulation?: number;
  /** The component's inputs, keyed by the name a template writes. */
  inputs?: object;
  tView?: {
    directiveRegistry?:
      readonly { selectors?: readonly (readonly unknown[])[]; inputs?: object }[] | null;
  } | null;
  ngContentSelectors?: readonly string[];
}

/** `ViewEncapsulation.None`'s value in a component definition. */
const NONE = 2;

/** The attribute names in a projection selector such as `[listHeader]` or `text[slot=a]`. */
const PROJECTED_ATTRIBUTE = /\[([^\]=~|^$*\s]+)/g;

export class NativeRendererFactory implements RendererFactory2 {
  private readonly renderer: NativeRenderer;
  /** One renderer per component type, because each carries its own stylesheet. */
  private readonly byComponent = new Map<string, NativeRenderer>();
  /** The global sheet each `ViewEncapsulation.None` component registered, which a hot swap replaces. */
  private readonly globalById = new Map<string, StyleSheet>();
  /** The scoped sheet each emulated or Shadow DOM component has, which a hot swap replaces. */
  private readonly scopedById = new Map<string, StyleSheet>();
  readonly engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    this.renderer = new NativeRenderer(engine);
  }

  /**
   * Angular hands us the component definition here, which is how emulated encapsulation gets
   * scoped: the renderer a component uses is bound to that component's compiled stylesheet, so
   * its elements match its rules and nobody else's.
   */
  createRenderer(host: unknown, type: ComponentDefLike | null): Renderer2 {
    const sheet = this.scopedSheetOf(type);

    // `host` is the element this component is mounted on, and Angular created it with the
    // *parent's* renderer, so it carries the parent's sheet. Tagging it here is the only moment
    // the two are both in hand, and it is what makes `:host` reachable at all.
    //
    // It is also the one sure sign that an element hosts a component, whatever the selector
    // that put it there, which is what tells an `<x-card>` from a typo.
    if (host && typeof host === 'object') {
      this.engine.setHostSheet(host as EngineNode, sheet);
      markComponentHost(host as EngineNode);
      this.keepInputAttributes(host as EngineNode, type);
    }
    if (type) this.declareElements(type);

    if (!sheet) return this.renderer;

    const key = type?.id ?? '';
    let renderer = this.byComponent.get(key);
    if (!renderer) {
      renderer = new NativeRenderer(this.engine, sheet);
      this.byComponent.set(key, renderer);
    }
    return renderer;
  }

  /**
   * Keep a static attribute that is one of the component's inputs off its host view.
   *
   * Angular gives `<app-field accessibilityLabel="Email">` to the input and writes it to the host
   * element as well, which on a web page is an attribute only a selector reads and here is a prop:
   * a second element with the label, on a view that is only a container. It stays on the node for
   * `:host([variant])` to match. The component's host bindings have not run yet, so a prop by an
   * input's name is the static attribute, and a host binding that writes it later is committed.
   */
  private keepInputAttributes(host: EngineNode, def: ComponentDefLike | null): void {
    for (const input of Object.keys(def?.inputs ?? {})) this.engine.keepAsAttribute(host, input);
  }

  /**
   * The sheet a component's elements are matched against, or null.
   *
   * `ViewEncapsulation.None`: a browser adds the component's CSS to the document as written, so
   * its rules reach any element, its host by class among them, and `:host` matches nothing. Its
   * sheet is a global one, registered when the component first renders, and it has none of its
   * own. Shadow DOM stays scoped, as a shadow root scopes it.
   */
  private scopedSheetOf(type: ComponentDefLike | null): StyleSheet | null {
    const sheet = styleSheetOf(type?.type);
    const id = type?.id ?? '';
    this.swapScoped(id, type?.encapsulation === NONE ? null : sheet);
    const registered = this.globalById.get(id);
    if (!sheet || type?.encapsulation !== NONE) {
      // A hot swap that left the component no rules, or made it scoped: its old sheet goes, and a
      // scoped one takes its `@keyframes` over now, before anything plays them.
      if (registered) {
        this.engine.removeGlobalSheet(registered);
        if (sheet) this.engine.sheetReplaced(registered, sheet);
      }
      this.globalById.delete(id);
      return sheet;
    }
    this.engine.addGlobalSheet(sheet, registered);
    this.globalById.set(id, sheet);
    return null;
  }

  /**
   * Tell the engine when a hot swap gave a component another scoped sheet, or none, so the
   * `@keyframes` the old one defined go with it. Nothing changes without a hot swap.
   */
  private swapScoped(id: string, sheet: StyleSheet | null): void {
    const previous = this.scopedById.get(id);
    if (previous && previous !== sheet) this.engine.sheetReplaced(previous, sheet);
    if (sheet) this.scopedById.set(id, sheet);
    else this.scopedById.delete(id);
  }

  /**
   * Angular's HMR calls this before it recreates a hot-swapped component's views. The renderer
   * cached for that component is bound to the sheet it had, so an edited stylesheet would never
   * reach the recreated views without letting it go.
   */
  componentReplaced(id: string): void {
    this.byComponent.delete(id);
  }

  /** Component definitions whose templates have been looked through already. */
  private readonly declared = new WeakSet<object>();

  /**
   * Tell the engine every element name this component's template may select by tag.
   *
   * Angular builds a component's template view, with its directive registry resolved from the
   * component's `imports`, before it asks for the renderer, so the registry is in hand here and
   * before the template that uses those names runs. This is what keeps a directive that owns an
   * element without hosting a component, such as Angular's `router-outlet`, from reading as a
   * typo; a component host is marked directly instead, above.
   */
  private declareElements(def: ComponentDefLike): void {
    // Only once the template view exists. The root component asks for a renderer twice, first
    // without a host and before its template view is built, and marking it seen then would
    // skip the call that has the registry.
    const registry = def.tView?.directiveRegistry;
    if (!registry || this.declared.has(def)) return;
    this.declared.add(def);
    for (const directive of registry) {
      for (const selector of directive.selectors ?? []) {
        const tag = selector[0];
        if (typeof tag === 'string' && tag) this.engine.declareElement(tag);
      }
    }
    this.declareAttributes(def, registry);
  }

  /**
   * Tell the engine the attribute names that are Angular's rather than a native view's: what a
   * directive selects on or takes as an input, which Angular also writes to the node as a static
   * attribute, and what the component's `<ng-content select>` projects by.
   */
  private declareAttributes(
    def: ComponentDefLike,
    registry: NonNullable<NonNullable<ComponentDefLike['tView']>['directiveRegistry']>,
  ): void {
    for (const directive of registry) {
      for (const selector of directive.selectors ?? []) {
        for (const name of selector.filter((part, at) => at % 2 === 1)) {
          if (typeof name === 'string') this.engine.declareAttribute(name);
        }
      }
      for (const input of Object.keys(directive.inputs ?? {})) this.engine.declareAttribute(input);
    }
    for (const selector of def.ngContentSelectors ?? []) {
      for (const [, name] of selector.matchAll(PROJECTED_ATTRIBUTE)) {
        this.engine.declareAttribute(name!);
      }
    }
  }

  private renderStarted = 0;
  private frame = 0;

  /**
   * Drive CSS transitions.
   *
   * A transition is not a binding: nothing in Angular changes while one runs, so change detection
   * would never fire again and the animation would stop on its first frame. This pumps the engine
   * directly for as long as one has frames left, and commits each one.
   */
  private readonly pump = (): void => {
    this.frame = 0;
    this.engine.advanceAnimations();
    // Also the commit for anything changed outside change detection. Angular's `animate.enter`
    // and `animate.leave` add their classes from an animation queue that runs after the render
    // pass, so without a frame behind it the class would sit on the node and never reach native.
    this.engine.commit();
    // `pending` as well as `transitioning`: a transition's end listener runs after the commit
    // that finished it, and removing a leaving element is exactly what it tends to do.
    if (this.engine.animating || this.engine.pending) this.schedule();
  };

  private schedule(): void {
    if (this.frame) return;
    // `requestAnimationFrame` is a global in React Native. The fallback is for Node, where the
    // suite drives `advanceTransitions` itself and this never runs.
    const request =
      globalThis.requestAnimationFrame ??
      ((callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16));
    this.frame = request(this.pump) as unknown as number;
  }

  /**
   * A change that lands outside a render pass has no commit coming. The engine reports the moment
   * the tree goes dirty, and this arranges a frame for it, which is how the classes Angular's
   * animation queue adds after a pass reach native at all.
   */
  readonly commitSoon = (): void => {
    if (!this.rendering) this.schedule();
  };

  private rendering = false;
  /** How many commits there had been before the first one of this turn, while one is unsettled. */
  private unseenSince: number | null = null;

  /**
   * Commit what the rest of this turn changes before a frame is drawn, rather than a frame later.
   *
   * Angular's `animate.enter` adds its class from a queue that runs after the render pass, so the
   * element has been committed once without it. Committed again in the same turn, the class is on
   * the view's first frame, and the engine starts the view there instead of easing to it.
   */
  private settleUnseen(before: number): void {
    if (this.unseenSince !== null) return;
    this.unseenSince = before;
    queueMicrotask(() => {
      const since = this.unseenSince!;
      this.unseenSince = null;
      if (!this.engine.pending) return;
      this.engine.commitUnseen(since);
      if (this.engine.animating) this.schedule();
    });
  }

  begin(): void {
    this.rendering = true;
    this.renderStarted = globalThis.performance?.now?.() ?? Date.now();
  }

  /** The single commit point: at most one commit per change-detection pass. */
  end(): void {
    this.rendering = false;
    const before = this.engine.stats.commits;
    if (this.engine.commit()) this.settleUnseen(before);

    // A commit is what starts a transition, because it is where the cascade is recomputed.
    if (this.engine.animating) this.schedule();

    // Excludes the mount, which is not representative of a steady-state frame.
    const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - this.renderStarted;
    const stats = this.engine.stats;
    if (stats.commits > 1 && elapsed > stats.worstRenderMs) stats.worstRenderMs = elapsed;
  }
}

export interface MountResult {
  componentRef: ComponentRef<unknown>;
  applicationRef: ApplicationRef;
  factory: NativeRendererFactory;
  engine: Engine;
}

/**
 * Angular decides whether `animate.enter` and `animate.leave` do anything when `@angular/core` is
 * first evaluated, by reading a global that a Metro polyfill has to have set by then. Nothing
 * later can change the answer, so the most that can be done is to notice and say so. Checked here
 * because booting is the one moment every app passes through.
 */
function warnIfAnimationsAreOff(): void {
  const document = (globalThis as { document?: { documentElement?: { getAnimations?: unknown } } })
    .document;
  if (typeof document?.documentElement?.getAnimations === 'function') return;
  console.error(
    '[angular-native] `animate.enter` and `animate.leave` will do nothing: Angular reads ' +
      'whether to support them when it is first imported, before anything here runs. Build ' +
      'metro.config.js with `withAngularNative` from `@ng-native/metro/config.cjs`, which ' +
      'adds the polyfill that sets it. Animated styles and CSS transitions work either way.',
  );
}

declare const __DEV__: boolean | undefined;

/**
 * The reload the HMR block falls back to when a change is more than a template.
 *
 * Each compiled component module can patch its own live class when only the template moved. For
 * anything else - a new method, a changed selector, different imports - there is no metadata to
 * replace, so it calls `globalThis.__angularNativeReload` instead. React Native's own Fast Refresh
 * cannot cover for it: that is React-specific, and it accepts the update and reports success, so
 * Metro never falls back on its own.
 *
 * This is installed here because `mount` is the one call every app makes. It used to be a line in
 * an example app's entry file, which meant every other app logged "hmr reload", called an empty
 * function, and carried on running the code from before the edit - with a second copy of every
 * class in the changed file now loaded, which Angular reports as `NG0912`. An edit that ships and
 * does nothing is a bad enough failure; one that also makes the next few screenshots lie about
 * what the app is running is worse.
 *
 * An app that sets its own is left alone: it will have a better reason string than this one.
 */
function installReloadHook(): void {
  reloadMetroThroughExpo();
  const scope = globalThis as { __angularNativeReload?: () => void };
  if (scope.__angularNativeReload) return;
  scope.__angularNativeReload = () => afterParking(reloadApp);
}

/**
 * Reload once the router has left its history with the dev server, for the app that comes back
 * to open on the page this one was showing. The router sets the hook, in development; with no
 * router there is nothing to wait for. A history that could not be left is no reason not to reload.
 */
function afterParking(reload: () => void): void {
  const park = (globalThis as { __angularNativePark?: () => Promise<void> }).__angularNativePark;
  if (!park) return reload();
  void park().then(reload, reload);
}

/** Longer than any history takes to go back through; an app is never left out of sight. */
const RESTORE_PATIENCE = 5000;

/**
 * Keep the app out of sight while the router goes back through the history a reload left, so it
 * comes back on the page it was showing rather than on its first page with the others arriving
 * over it one by one. The router says when it is done, in development; with no router, or on a
 * start no reload led to, that is at once or never asked.
 */
function hideWhileRestoring(hide: (hidden: boolean) => void): void {
  // The bare identifier, so a release build folds the rest away: see `mount`.
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const restoring = (globalThis as { __angularNativeRestoring?: Promise<void> })
    .__angularNativeRestoring;
  if (!restoring) return;
  hide(true);
  const show = () => hide(false);
  const patience = new Promise<void>((resolve) => setTimeout(resolve, RESTORE_PATIENCE));
  void Promise.race([restoring, patience]).then(show, show);
}

/**
 * How long after Expo says it reloaded the app that an app still running was not reloaded.
 * A reload takes the JavaScript runtime with it, so nothing here runs once one has begun.
 */
const STILL_HERE = 2000;

/**
 * Reload through Expo, and through React Native when that does nothing.
 *
 * Expo's first. `DevSettings.reload()` under Expo Go on iOS re-runs the bundle the app downloaded
 * when it launched rather than fetching the current one, so the app comes back holding the code
 * from before the edit, and without Expo's native modules until Expo Go is relaunched.
 *
 * React Native's when Expo's rejects, and when it resolves and the app is still running. Under
 * Expo Go on Android `reloadAppAsync` resolves and reloads nothing, and the edit that asked for
 * the reload never arrived: the app went on running the code from before it.
 */
function reloadThroughExpo(
  expo: (reason?: string) => Promise<void>,
  reason: string,
  reactNative: () => void,
): void {
  let fellBack = false;
  const fallBack = (why: string, error?: unknown) => {
    if (fellBack) return;
    fellBack = true;
    console.error(`[angular-native] Expo's reload ${why}; reloading through React Native.`, error);
    reactNative();
  };
  expo(reason).then(
    () => setTimeout(() => fallBack('did nothing'), STILL_HERE),
    (error: unknown) => fallBack('failed', error),
  );
}

/**
 * Required rather than imported, both of them: React Native ships Flow, which Node cannot parse,
 * and this file has to stay importable by the test suite. Expo is genuinely optional.
 */
function reloadApp(): void {
  const reason = 'angular-native: more than a template changed';
  const reactNative = () => {
    try {
      const { DevSettings } = require('react-native') as {
        DevSettings?: { reload(reason?: string): void };
      };
      DevSettings?.reload(reason);
    } catch {
      // No React Native under us: nothing to reload.
    }
  };
  let expo: ((reason?: string) => Promise<void>) | undefined;
  try {
    expo = (require('expo') as { reloadAppAsync?: typeof expo }).reloadAppAsync;
  } catch {
    // Not an Expo app. React Native's own reload does re-fetch outside Expo Go.
  }
  if (expo) reloadThroughExpo(expo, reason, reactNative);
  else reactNative();
}

/**
 * Metro's own reload, for an edit nothing accepted: a route file, a service, or a component the
 * hook above has already asked to reload. Metro calls React Native's Fast Refresh runtime, which
 * calls `DevSettings.reload()`, and in Expo Go that brings the app back without Expo's native
 * modules (`Cannot find native module 'ExpoFontLoader'`) until Expo Go is relaunched. Expo's
 * reload works in Expo Go and a development build alike, so in an Expo app Metro's goes through
 * it too. With or without Expo, it waits for the router to park its history: see `afterParking`.
 */
const THROUGH_EXPO = Symbol.for('ng-native.reloadThroughExpo');

function reloadMetroThroughExpo(): void {
  const scope = globalThis as { __METRO_GLOBAL_PREFIX__?: string } & Record<string, unknown>;
  const refresh = scope[`${scope.__METRO_GLOBAL_PREFIX__ ?? ''}__ReactRefresh`] as
    { performFullRefresh?: ((reason: string) => void) & { [THROUGH_EXPO]?: true } } | undefined;
  const reactNative = refresh?.performFullRefresh;
  if (!refresh || !reactNative || reactNative[THROUGH_EXPO]) return;
  let reloadAppAsync: ((reason?: string) => Promise<void>) | undefined;
  try {
    ({ reloadAppAsync } = require('expo') as { reloadAppAsync?: typeof reloadAppAsync });
  } catch {
    // Not an Expo app: React Native's own reload re-fetches the bundle there.
  }
  const expo = reloadAppAsync;
  // Either way once the router has parked its history: see `afterParking`.
  const reload = (reason: string) =>
    afterParking(() => {
      const native = () => reactNative.call(refresh, reason);
      if (expo) reloadThroughExpo(expo, reason, native);
      else native();
    });
  reload[THROUGH_EXPO] = true as const;
  refresh.performFullRefresh = reload;
}

/** Dev only, and required rather than imported: React Native ships Flow, which Node cannot parse. */
function calmDevBanner(): void {
  try {
    const { default: banner } = require('react-native/Libraries/Utilities/DevLoadingView') as {
      default?: LoadingBanner;
    };
    if (banner) calmLoadingBanner(banner);
  } catch {
    // No React Native under us: a test, or the web.
  }
}

/**
 * React Native's `NativeAnimatedHelper`, for the engine to move sticky headers by a scroll on the
 * native side. Required rather than imported for the same reason as the banner, and null where
 * there is no native animated module to talk to: a test, or the web.
 */
function nativeAnimated(): NativeAnimated | null {
  try {
    const { default: helper } =
      require('react-native/src/private/animated/NativeAnimatedHelper') as {
        default?: NativeAnimated & { assertNativeAnimatedModule(): void };
      };
    if (!helper) return null;
    helper.assertNativeAnimatedModule();
    return helper;
  } catch {
    return null;
  }
}

/** The root component's host until its `:host` says otherwise. See `Engine.setDefaultStyle`. */
const ROOT_HOST_STYLE = { height: '100%' } as const;

/**
 * Run the app's initializers, `provideAppInitializer` and `APP_INITIALIZER`, before the root
 * component exists, as `bootstrapApplication` does. `createEnvironmentInjector` runs only
 * environment initializers, so without this an app initializer silently never ran.
 *
 * Through Angular's own `ApplicationInitStatus`, so its `done` and `donePromise` stay true to what
 * happened for anything that waits on them. `runInitializers` is what Angular's bootstrap calls;
 * it is missing from the public types, which is why it is reached through a cast.
 *
 * An initializer that returns a promise is started, not awaited: `mount` is synchronous and the
 * first frame does not wait. One that fails reaches the `ErrorHandler` rather than vanishing.
 */
function runInitializers(injector: EnvironmentInjector): void {
  const status = injector.get(ApplicationInitStatus);
  (status as unknown as { runInitializers(): void }).runInitializers();
  status.donePromise.catch((error: unknown) => injector.get(ErrorHandler).handleError(error));
}

export function mount(
  rootTag: number,
  component: Type<unknown>,
  fabric: FabricUIManager,
  options: EngineOptions & {
    providers?: (Provider | EnvironmentProviders)[];
    /**
     * Root component inputs, set before its first change detection. That is the only moment a
     * `required` input can be given, and `mount` runs that first pass itself, so a caller cannot
     * set one afterwards. What `render()` in `@ng-native/testing` passes a component's inputs as.
     */
    inputs?: Record<string, unknown>;
    /**
     * Bindings for the root component, as `createComponent` takes them: `outputBinding()` for a
     * listener a template would bind. What `render()` passes its `on` as.
     */
    bindings?: Binding[];
  } = {},
): MountResult {
  // The bare identifier, behind `typeof` so Node does not throw: Metro inlines `__DEV__` and folds
  // this branch away in a release build, and a property read through `globalThis` it cannot, which
  // left the reload hook and its `require('expo')` in every release bundle.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    warnIfAnimationsAreOff();
    installReloadHook();
    installHotEpoch();
    calmDevBanner();
  }
  installDeferTriggers();
  const { providers: extraProviders = [], inputs = {}, bindings, ...engineOptions } = options;
  // The factory needs the engine and the engine needs the factory's dirty hook, so the hook is
  // handed over once both exist rather than through the constructor.
  const engine = new Engine(fabric, rootTag, {
    ...engineOptions,
    nativeAnimated:
      engineOptions.nativeAnimated === undefined ? nativeAnimated() : engineOptions.nativeAnimated,
  });
  installDateParse(engine.dev);
  const factory = new NativeRendererFactory(engine);
  engine.setOnDirty(factory.commitSoon);
  // `getElementById` is what `TransferState` calls, and `TransferState` is what `resource()`
  // reaches for the moment one is created. Without it every resource in an app throws
  // `doc.getElementById is not a function` before its loader has run - which is a long way from
  // anything a stylesheet does, and is why the stub is not as thin as it looks.
  const documentStub = { head: undefined, body: undefined, getElementById: () => null };

  // Parent the app injector to the platform injector, exactly as `internalCreateApplication`
  // does. Some Angular services are `providedIn: 'platform'` - `Console` among them - and with a
  // null parent they simply do not exist: the router fails with NG0201 the moment it logs.
  const platformInjector = createOrReusePlatformInjector();

  const injector = createEnvironmentInjector(
    [
      // `INJECTOR_SCOPE` and `DOCUMENT` are both load-bearing: without the first Angular cannot
      // resolve `ChangeDetectionSchedulerImpl` (NG0201), without the second `getStyleHost` throws
      // NG0210.
      { provide: INJECTOR_SCOPE, useValue: 'root' },
      provideZonelessChangeDetectionInternal(),
      { provide: RendererFactory2, useValue: factory },
      // Exposed so a component can read commit stats, or reach a node for a native command.
      { provide: Engine, useValue: engine },
      // The contract the shared packages inject. `Engine` is still provided under its own token
      // for the three worklet components that need Fabric's own handles. See `fabric/host.ts`.
      { provide: HostEngine, useExisting: Engine },
      { provide: DOCUMENT, useValue: documentStub },
      // 'native', not Angular's default 'unknown': see `platform-id.ts`.
      { provide: PLATFORM_ID, useValue: PLATFORM_NATIVE_ID },
      { provide: ErrorHandler, useClass: ErrorHandler },
      ...extraProviders,
    ],
    // The platform injector is an EnvironmentInjector in practice; the factory's return type is
    // just declared more loosely.
    platformInjector as EnvironmentInjector,
  );

  // Errors the engine catches in its native event dispatch, which is outside every Angular
  // listener wrapper: responder handlers, engine-level listeners, a commit a focus change starts.
  // Looked up when one happens rather than now, as Angular's own handler is, so an app's
  // `ErrorHandler` that injects something not yet constructible is not forced at boot. A caller
  // that passed its own `onError` keeps it.
  if (!engineOptions.onError) {
    engine.setOnError((error) => injector.get(ErrorHandler).handleError(error));
  }

  runInitializers(injector);

  // What `@ng-native/tailwind`'s `ios:` and `android:` variants match beneath. On the root so
  // they work with nothing to set up; an app that had to add it itself, and did not, got platform
  // variants that silently matched nothing.
  engine.addClass(engine.root, `platform-${nativePlatform()}`);

  // No `hostElement`, so Angular creates the host from the selector as it does any other
  // component's, and it goes under the engine root as a view of its own. The engine root is the
  // surface and is never committed: as the host it took the component's `:host` rules and sent
  // them nowhere, so a root component's background and padding were dropped without a word.
  const componentRef = createComponent(component, {
    environmentInjector: injector,
    ...(bindings && { bindings }),
  });
  const host = componentRef.location.nativeElement as EngineNode;
  // The full height of the surface, as the web's mount point is given, so a template's `flex: 1`
  // still fills the screen. A height rather than `flex: 1`, which a `:host` height would lose to.
  // The app's own `:host` overrides it.
  engine.setDefaultStyle(host, ROOT_HOST_STYLE);
  engine.appendChild(engine.root, host);
  hideWhileRestoring((hidden) => {
    engine.setDefaultStyle(host, hidden ? { ...ROOT_HOST_STYLE, opacity: 0 } : ROOT_HOST_STYLE);
    factory.commitSoon();
  });

  for (const [name, value] of Object.entries(inputs)) componentRef.setInput(name, value);

  const applicationRef = injector.get(ApplicationRef);

  // `ApplicationRef.bootstrap()` does all of this; `createComponent` does not, and we
  // deliberately do not use `bootstrap()` because it wants a DOM selector. Order and
  // bookkeeping both matter, so this mirrors `_loadComponent` step for step.
  applicationRef.componentTypes.push(component);
  applicationRef.attachView(componentRef.hostView);
  // Before the listeners, so the root component's template has run and any outlet in it has
  // registered itself by the time the router's initial navigation activates a route.
  applicationRef.tick();
  // Load-bearing, not bookkeeping: the router's bootstrap listener returns early unless the
  // ref it is handed is `ApplicationRef.components[0]`, so with an empty array the initial
  // navigation never runs and a routed app renders nothing but its outlet's host.
  applicationRef.components.push(componentRef);
  // Text laid out before its face registered is laid out again when it does: `loadFonts` is not
  // awaited before `mount` behind a splash screen.
  const stopFonts = onFontsRegistered((families) => engine.fontsRegistered(families));
  const stopSettled = onFontsSettled((families) => engine.fontsSettled(families));
  componentRef.onDestroy(() => {
    stopFonts();
    stopSettled();
    applicationRef.detachView(componentRef.hostView);
    const at = applicationRef.components.indexOf(componentRef);
    if (at !== -1) applicationRef.components.splice(at, 1);
  });

  for (const listener of injector.get(APP_BOOTSTRAP_LISTENER, [])) {
    listener(componentRef);
  }

  return { componentRef, applicationRef, factory, engine };
}
