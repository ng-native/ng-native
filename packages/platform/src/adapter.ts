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
  LOCALE_ID,
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
  ɵsetDocument as setDocument,
  ɵsetLocaleId as setLocaleId,
} from '@angular/core';
import { installDateParse } from './date-parse.ts';
import { inertImplementation } from './inert-document.ts';
import { PLATFORM_NATIVE_ID } from './platform-id.ts';
import {
  Engine,
  firstFamily,
  HostEngine,
  installDeferTriggers,
  installNodeGlobal,
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
const REM = /^-?\d*\.?\d+rem$/;
const styleKey = (name: string): string =>
  name.includes('-') ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : name;
/**
 * A bare number arrives as a string too, and Yoga wants a number. A `rem` is 16 points, as in a
 * stylesheet, so it needs no font size in scope.
 *
 * Angular parses `[style]="'flex: 1'"` itself and calls `setStyle('flex', '1')`, so the same
 * declaration written as an object gave `1` and written as a string gave `'1'` - the two spellings
 * of one design disagreeing at the only layer that can tell.
 */
const styleValue = (value: unknown): unknown =>
  typeof value !== 'string'
    ? value
    : PX.test(value) || NUMBER.test(value)
      ? parseFloat(value)
      : REM.test(value)
        ? parseFloat(value) * 16
        : value;
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

const IMPORTANT = /!\s*important\s*$/i;

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
    // `!important` comes off as Angular takes it off a bound value, which `setStyle` reads alike.
    // ponytail: neither is ranked above a rule's own `!important`, as a browser ranks it.
    const value = declaration
      .slice(at + 1)
      .replace(IMPORTANT, '')
      .trim();
    // A custom property keeps its name, which is case-sensitive, and its text for the engine.
    // Any other is left as written, for `setStyle` to read as it reads a bound one.
    if (name) out[name.startsWith('--') ? name : styleKey(name)] = value;
  }
  return out;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const SHORTHANDS = new Set(['padding', 'margin', 'inset', 'gap']);

/** CSS whitespace, which a no-break space is not. */
const CSS_SPACE = /[ \t\n\r\f]/;

/** The values in `text`, split on CSS whitespace outside parentheses: `4px calc(2px + 2px)` is two. */
function cssValues(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  for (const char of text) {
    if (depth === 0 && CSS_SPACE.test(char)) {
      if (part) parts.push(part);
      part = '';
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

/** A shorthand with more values than it takes, which a browser drops whole. */
const REFUSED = 'refused';

/**
 * A shorthand written with a value for each side, `padding: 4px 8px`, as the longhands native
 * reads: it takes one number for `padding`, and drops the text. Null for one value, which native
 * takes as it is, and for a value holding a `var()`, whose count is only known once it is settled.
 * `REFUSED` for more values than the shorthand takes.
 *
 * ponytail: `padding`, `margin`, `inset` and `gap`, the ones written this way in a style. A
 * stylesheet has every shorthand; add one here when a style needs it.
 */
function longhands(key: string, value: unknown): [string, string][] | typeof REFUSED | null {
  if (!SHORTHANDS.has(key) || typeof value !== 'string' || /var\(/i.test(value)) return null;
  const parts = cssValues(value);
  if (parts.length < 2) return null;
  if (parts.length > (key === 'gap' ? 2 : 4)) return REFUSED;
  const [first, second = first, third = first, fourth = second] = parts as [string, ...string[]];
  if (key === 'gap')
    return [
      ['rowGap', first],
      ['columnGap', second],
    ];
  return [first, second, third, fourth].map((part, side) => [
    key === 'inset' ? SIDES[side]!.toLowerCase() : `${key}${SIDES[side]!}`,
    part,
  ]);
}

/** The longhands each element's shorthand was last written as, to take out when it changes. */
const writtenAs = new WeakMap<EngineNode, Map<string, string[]>>();

/** The declarations each element's `style` attribute made, to take out when it changes or goes. */
const attributeStyles = new WeakMap<EngineNode, readonly string[]>();

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
    const node = this.engine.createElement(name, this.sheet);
    if (extensions.length) {
      for (const extension of extensions) extension.created?.(node, this.engine);
    }
    return node;
  }

  createComment(): EngineNode {
    return this.engine.createAnchor();
  }

  createText(value: string): EngineNode {
    return this.engine.createText(value);
  }

  appendChild(parent: EngineNode, newChild: EngineNode): void {
    this.engine.appendChild(parent, newChild);
    if (extensions.length) this.inserted(parent, newChild);
  }

  insertBefore(parent: EngineNode, newChild: EngineNode, refChild: EngineNode | null): void {
    if (!parent) return;
    this.engine.insertBefore(parent, newChild, refChild);
    if (extensions.length) this.inserted(parent, newChild);
  }

  /** Tell the extensions a node was put under a parent. */
  private inserted(parent: EngineNode, child: EngineNode): void {
    for (const extension of extensions) extension.inserted?.(child, parent, this.engine);
  }

  removeChild(_parent: EngineNode | null, oldChild: EngineNode): void {
    // From the parent it has, as Angular's DOM renderer takes a node out: the parent it is
    // handed is whatever the caller had, and a library's may be no parent of it at all. One in
    // no parent is out already.
    if (oldChild.parent) this.engine.removeChild(oldChild.parent, oldChild);
    if (extensions.length) {
      for (const extension of extensions) extension.removed?.(oldChild, this.engine);
    }
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
      const declared = parseStyleAttribute(value);
      this.dropAttributeStyles(el, declared);
      for (const [key, next] of Object.entries(declared)) this.setStyle(el, key, next);
      attributeStyles.set(el, Object.keys(declared));
      return;
    }
    this.set(el, name, value);
  }

  removeAttribute(el: EngineNode, name: string): void {
    // What `setAttribute` made of each is what goes: neither was ever a prop.
    if (name === 'class') return this.engine.setClasses(el, '');
    if (name === 'style') {
      this.dropAttributeStyles(el, {});
      attributeStyles.delete(el);
      return;
    }
    this.set(el, name, null);
  }

  /** Set a prop, unless an extension takes the attribute or property it was written as. */
  private set(el: EngineNode, name: string, value: unknown): void {
    if (!extensions.length) return this.engine.setProp(el, name, value);
    for (const extension of extensions) {
      if (extension.set?.(el, name, value, this.engine)) return;
    }
    this.engine.setProp(el, name, value);
  }

  /** Takes out what an element's `style` attribute declared and `kept` does not. */
  private dropAttributeStyles(el: EngineNode, kept: Record<string, unknown>): void {
    for (const key of attributeStyles.get(el) ?? []) {
      if (!(key in kept)) this.removeStyle(el, key);
    }
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
    if (extensions.length && this.restyled(el, style, value)) return;
    // A number bound to the CSS name is a CSS number, a multiple of the font size, as a browser's
    // `style.setProperty` reads it. A style object's `lineHeight: 24` stays React Native's points.
    if (style === 'line-height' && typeof value === 'number') value = String(value);
    const key = styleKey(style);
    if (this.setShorthand(el, key, value)) return;
    this.setDeclaration(el, key, value);
  }

  /** Set one declaration of an element's inline style, by the key the view reads. */
  private setDeclaration(el: EngineNode, key: string, value: unknown): void {
    // A `var()` is for the cascade to settle, with the tokens in scope, not a value of the style.
    if (this.engine.setBoundStyle(el, key, value)) return this.dropStyle(el, key);
    const next = declaredValue(key, value);
    const current = el.props['style'] as Record<string, unknown> | undefined;
    if (current && current === el.ownStyle) {
      if (current[key] === next) return;
      current[key] = next;
      this.engine.styleChanged(el, key);
      return;
    }
    const owned = { ...(current ?? {}), [key]: next };
    el.ownStyle = owned;
    this.engine.setProp(el, 'style', owned);
  }

  /**
   * A shorthand with a value for each side, set as its sides, or dropped for more values than it
   * takes. False for any other declaration, which is set as it is.
   */
  private setShorthand(el: EngineNode, key: string, value: unknown): boolean {
    if (!SHORTHANDS.has(key)) return false;
    const sides = longhands(key, value);
    this.dropLonghands(el, key, sides === REFUSED ? null : sides);
    if (!sides) return false;
    this.removeStyle(el, key);
    if (sides === REFUSED) {
      const most = key === 'gap' ? 'two' : 'four';
      const why = `${key} takes ${most} values at most`;
      this.engine.reportDroppedDeclaration(key, String(value), el.tag, why);
      return true;
    }
    (writtenAs.get(el) ?? writtenAs.set(el, new Map()).get(el)!).set(
      key,
      sides.map(([side]) => side),
    );
    for (const [side, part] of sides) this.setStyle(el, side, part);
    return true;
  }

  removeStyle(el: EngineNode, style: string, _flags?: RendererStyleFlags2): void {
    if (style.startsWith('--')) {
      this.engine.setCustomProperty(el, customPropertyName(style), null);
      return;
    }
    if (extensions.length && this.restyled(el, style, null)) return;
    const key = styleKey(style);
    if (SHORTHANDS.has(key)) this.dropLonghands(el, key, null);
    this.dropDeclaration(el, key);
  }

  private dropDeclaration(el: EngineNode, key: string): void {
    this.engine.setBoundStyle(el, key, null);
    this.dropStyle(el, key);
  }

  /**
   * Ask the extensions what a declaration is set as: the first to answer has each of its
   * declarations set, or removed for a `null`, in place of the one written.
   */
  private restyled(el: EngineNode, style: string, value: unknown): boolean {
    for (const extension of extensions) {
      const declarations = extension.style?.(el, style, value, this.engine);
      if (!declarations) continue;
      for (const [key, next] of Object.entries(declarations)) {
        if (next == null) this.dropDeclaration(el, key);
        else this.setDeclaration(el, key, next);
      }
      return true;
    }
    return false;
  }

  /** Takes out the longhands `key` was written as, but for the ones it is about to be again. */
  private dropLonghands(el: EngineNode, key: string, next: [string, string][] | null): void {
    const written = writtenAs.get(el);
    const sides = written?.get(key);
    if (!sides) return;
    written!.delete(key);
    for (const side of sides) {
      if (!next?.some(([kept]) => kept === side)) this.removeStyle(el, side);
    }
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
    this.set(el, name, value);
  }

  setValue(node: EngineNode, value: string): void {
    this.engine.setText(node, value);
  }

  listen(
    target: EngineNode | string,
    eventName: string,
    callback: (event: unknown) => boolean | void,
  ): () => void {
    for (const extension of extensions) {
      const unlisten = extension.listen?.(target, eventName, callback, this.engine);
      if (unlisten) return unlisten;
    }
    // Angular's names for a global target, 'window', 'document' and 'body': there is none here.
    if (typeof target === 'string') return () => {};
    return this.engine.setEventListener(target, topLevelType(eventName), callback);
  }
}

/** What a package outside core changes about how a template is rendered. */
export interface RendererExtension {
  /**
   * Take a listener over: answer what removes it, or nothing to leave it to the renderer. The
   * target is a node, or the name Angular gives a global one: `'window'`, `'document'`, `'body'`.
   */
  listen?(
    target: EngineNode | string,
    eventName: string,
    callback: (event: unknown) => boolean | void,
    engine: Engine,
  ): (() => void) | undefined;
  /**
   * Told of each element a template creates, before it has attributes or children: where an
   * element gets what it has for its name alone, as a `button` has its role.
   */
  created?(node: EngineNode, engine: Engine): void;
  /**
   * Told of each node put under a parent, the first time and each time it is moved: where an
   * element gets what depends on what holds it.
   */
  inserted?(node: EngineNode, parent: EngineNode, engine: Engine): void;
  /** Told of each node taken out of its parent by the renderer, once it is out. */
  removed?(node: EngineNode, engine: Engine): void;
  /**
   * Take an attribute or a property over, `null` for one being removed: answer true once it is
   * set as the props the element's view reads, as an `<input>`'s `value` is a text field's text.
   */
  set?(node: EngineNode, name: string, value: unknown, engine: Engine): boolean;
  /**
   * Take a bound style over, `null` for one being removed: answer the declarations it is set as,
   * by the keys the view reads, each `null` to remove it. As CSS's `inset-inline: 4px 8px` is a
   * `start` and an `end`.
   */
  style?(
    node: EngineNode,
    name: string,
    value: unknown,
    engine: Engine,
  ): Record<string, unknown> | undefined;
}

/** Asked for their length before each is called: an app with none pays nothing an element. */
const extensions: RendererExtension[] = [];

/**
 * Add to what the renderer does, for every app in the process. Returns what takes it away again.
 *
 * For a package that renders templates written for another host, as a web-compatibility layer
 * delivers a `click` from a press and gives `(document:keydown)` something to listen on. The
 * extensions are asked in the order they were added, and the first to answer takes the listener.
 */
export function extendRenderer(extension: RendererExtension): () => void {
  // An entry of this call's own: the same extension added twice is removed once by each.
  const entry: RendererExtension = {
    listen: (...args) => extension.listen?.(...args),
    created: (...args) => extension.created?.(...args),
    inserted: (...args) => extension.inserted?.(...args),
    removed: (...args) => extension.removed?.(...args),
    set: (...args) => extension.set?.(...args) ?? false,
    style: (...args) => extension.style?.(...args),
  };
  extensions.push(entry);
  return () => {
    const index = extensions.indexOf(entry);
    if (index !== -1) extensions.splice(index, 1);
  };
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
    // A frame has been drawn since, so every view committed before it has been seen.
    this.unseenSince = null;
    this.engine.advanceAnimations();
    // Also the commit for anything changed outside change detection. Angular's `animate.enter`
    // and `animate.leave` add their classes from an animation queue that runs after the render
    // pass, so without a frame behind it the class would sit on the node and never reach native.
    this.commit();
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
  /** How many commits there had been before the first that created a view no frame has drawn. */
  private unseenSince: number | null = null;
  private settling = false;

  /**
   * Commit, with the views created since the last frame was drawn taken as unseen: what this gives
   * them is where they start, and no transition runs toward it. A browser computes no style for an
   * element before the frame after it was inserted, so a class added before then, in the same
   * task or in another, starts nothing either. A view this commit creates is unseen until the next
   * frame, which is asked for here.
   */
  private commit(): boolean {
    const before = this.engine.stats.commits;
    const created = this.engine.stats.createdNodes;
    const since = this.unseenSince;
    const committed = since === null ? this.engine.commit() : this.engine.commitUnseen(since);
    if (since === null && this.engine.stats.createdNodes !== created) {
      this.unseenSince = before;
      this.schedule();
    }
    return committed;
  }

  /**
   * Commit what the rest of this turn changes before a frame is drawn, rather than a frame later.
   *
   * Angular's `animate.enter` adds its class from a queue that runs after the render pass, so the
   * element has been committed once without it. Committed again in the same turn, the class is on
   * the view's first frame, and the engine starts the view there instead of easing to it.
   */
  private settleTurn(): void {
    if (this.settling) return;
    this.settling = true;
    queueMicrotask(() => {
      this.settling = false;
      if (!this.engine.pending) return;
      this.commit();
      if (this.engine.animating) this.schedule();
    });
  }

  /** How many change-detection passes are under way, one inside another. */
  private passes = 0;

  begin(): void {
    if (this.passes++ > 0) return;
    this.rendering = true;
    this.renderStarted = globalThis.performance?.now?.() ?? Date.now();
  }

  /**
   * The single commit point: at most one commit per change-detection pass. A pass begun inside
   * another, a `detectChanges()` called from a lifecycle hook, is part of the one around it and
   * commits with it: a library that calls it from every `ngAfterViewInit` would otherwise commit
   * the screen once for each of its components as the screen is first built.
   */
  end(): void {
    if (this.passes > 0 && --this.passes > 0) return;
    this.rendering = false;
    if (this.commit()) this.settleTurn();

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
  installNodeGlobal();
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
  //
  // `implementation` is what the i18n runtime parses the cases of a plural or select with. It asks
  // Angular's own `getDocument()` rather than the injector, which answers the global `document`
  // the Metro polyfills define for animations until it is told of this one.
  const documentStub = {
    head: undefined,
    body: undefined,
    getElementById: () => null,
    implementation: inertImplementation,
  };
  setDocument(documentStub as unknown as Document);

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
  // The locale a template's plural picks its case by. Angular's own bootstrap tells the i18n
  // runtime the `LOCALE_ID`, and without it every language is counted by the rules of `en-US`.
  setLocaleId(injector.get(LOCALE_ID) || 'en-US');

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
  // The app's own `:host` overrides it. Given under the root, which it is a share of.
  engine.appendChild(engine.root, host);
  engine.setDefaultStyle(host, ROOT_HOST_STYLE);
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
