/**
 * `Renderer2`/`RendererFactory2` over `BrowserEngine`, the browser counterpart to
 * `packages/platform/src/adapter.ts`'s `NativeRenderer`/`NativeRendererFactory`.
 *
 * Much smaller than that file, and for the reason its own doc comment gives: a real DOM already
 * does attribute, class and style writes, and there is no style resolver here at all - the class
 * strings Angular writes with `addClass`/`removeClass` are matched by a real stylesheet loaded
 * into the page, the way they would be in any other Angular app. What is not smaller is
 * `setProperty`/`setAttribute`: those still delegate to `BrowserEngine.setProp`, not to a raw DOM
 * write, because a component's own host bindings (`text-input.ts`'s forty-odd, `switch.ts`'s
 * handful) are *logical* props with a translation `props.ts` owns - exactly the reason
 * `NativeRenderer.setProperty` delegates to `engine.setProp` rather than writing a native prop
 * directly. `class` and `style` are the two genuine exceptions, because a browser's own cascade is
 * what resolves them and nothing here needs to get in front of that.
 *
 * `setStyle`/`removeStyle` do one thing beyond the real DOM write: they keep `node.props['style']`
 * in sync as a plain object, mirroring `NativeRenderer`'s own `OWN_STYLES`-owned-object trick.
 * Three components read `this.node.props['style']` directly rather than going through the
 * engine - `touchable-opacity.ts` (the resting opacity a fade eases back to),
 * `image-background.ts` (the outer view's width/height, copied onto the absolutely-filled
 * image), `animated-style.ts` (the style an animation frame merges into) - and without this they
 * would read whatever was there before Angular's *first* style write, forever.
 */
import {
  RendererStyleFlags2,
  ViewEncapsulation,
  type Renderer2,
  type RendererFactory2,
} from '@angular/core';
import { reportUnboundFormsInput } from '@ng-native/fabric';
import { letBrowserNodesPassAsNodes, type BrowserNode } from './dom-node.ts';
import type { BrowserEngine } from './browser-engine.ts';
import { dashCase } from './css-units.ts';
import { writeStyleKey } from './native-style.ts';

/** `(touchEnd)` -> `topTouchEnd`. No alias for `press`; see `packages/platform/src/adapter.ts`. */
function topLevelType(eventName: string): string {
  return 'top' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
}

/** The style objects this renderer made, and may therefore mutate in place. See the file doc. */
const OWN_STYLES = new WeakSet<object>();

export class BrowserRenderer implements Renderer2 {
  readonly data: Record<string, unknown> = Object.create(null);
  /** Nothing here needs teardown beyond garbage collection; matches the native adapter's null. */
  readonly destroyNode: ((node: unknown) => void) | null = null;

  private readonly engine: BrowserEngine;
  private readonly document: Document;

  constructor(engine: BrowserEngine, document: Document) {
    this.engine = engine;
    this.document = document;
  }

  destroy(): void {}

  createElement(name: string): BrowserNode {
    return this.engine.createElementNode(name);
  }

  createComment(): BrowserNode {
    return this.engine.createAnchorNode();
  }

  createText(value: string): BrowserNode {
    return this.engine.createTextNode(value);
  }

  appendChild(parent: BrowserNode, child: BrowserNode): void {
    this.detach(child);
    child.parent = parent;
    parent.childList.push(child);
    (parent.el as Element).appendChild(child.el);
  }

  insertBefore(parent: BrowserNode, child: BrowserNode, refChild: BrowserNode | null): void {
    if (!parent) return;
    this.detach(child);
    child.parent = parent;
    const at = refChild ? parent.childList.indexOf(refChild) : -1;
    if (at === -1) parent.childList.push(child);
    else parent.childList.splice(at, 0, child);
    (parent.el as Element).insertBefore(child.el, refChild?.el ?? null);
  }

  removeChild(parent: BrowserNode | null, child: BrowserNode): void {
    // Angular removes a root component's host element when the component is destroyed. Here that
    // element is the one `mount` was given - a `<div>` of the caller's, or an `<ng-native-island>`
    // in a host app's template - and it is not this app's to take out of the page. What was
    // rendered into it goes; the element stays, empty, for its owner.
    if (this.engine.isRoot(child)) {
      for (const node of [...child.childList]) this.removeChild(child, node);
      // A root is always an element: `wrapRoot` only ever wraps one.
      (child.el as Element).replaceChildren();
      return;
    }
    const actualParent = parent ?? child.parent;
    if (actualParent) {
      const at = actualParent.childList.indexOf(child);
      if (at !== -1) actualParent.childList.splice(at, 1);
    }
    child.el.parentNode?.removeChild(child.el);
    child.parent = null;
  }

  private detach(child: BrowserNode): void {
    if (child.parent) this.removeChild(child.parent, child);
  }

  selectRootElement(selectorOrNode: string | BrowserNode): BrowserNode {
    if (typeof selectorOrNode !== 'string') return selectorOrNode;
    const found = this.document.querySelector(selectorOrNode);
    if (!found) throw new Error(`BrowserRenderer: no element matches '${selectorOrNode}'`);
    found.textContent = '';
    return this.engine.wrapRoot(found);
  }

  parentNode(node: BrowserNode): BrowserNode | null {
    return node.parent;
  }

  nextSibling(node: BrowserNode): BrowserNode | null {
    const siblings = node.parent?.childList;
    if (!siblings) return null;
    return siblings[siblings.indexOf(node) + 1] ?? null;
  }

  setAttribute(node: BrowserNode, name: string, value: string): void {
    // `class` drives real CSS selector matching; nothing about it goes through `props.ts`.
    //
    // `setAttribute('class', ...)`, not `.className =`: an SVG element's `className` is a
    // read-only `SVGAnimatedString` - only `.baseVal` is writable - so a direct assignment throws
    // in strict mode (every file in this package is a module, so every file is strict mode).
    // `setAttribute` is the one spelling that commits a class list on both an `HTMLElement` and
    // an `SVGElement`, which is what a static `class="..."` on an icon's `<svg>`/`<path>` needs -
    // found by every test that opens a dialog with its default close button, an icon with a
    // static class the compiler writes through this exact path.
    if (name === 'class') {
      (node.el as Element).setAttribute('class', value);
      return;
    }
    this.engine.setProp(node, name, value);
  }

  removeAttribute(node: BrowserNode, name: string): void {
    if (name === 'class') {
      (node.el as Element).removeAttribute('class');
      return;
    }
    this.engine.setProp(node, name, null);
  }

  addClass(node: BrowserNode, name: string): void {
    (node.el as Element).classList.add(name);
  }

  removeClass(node: BrowserNode, name: string): void {
    (node.el as Element).classList.remove(name);
  }

  setStyle(node: BrowserNode, style: string, value: unknown, flags?: RendererStyleFlags2): void {
    if (value === null || value === undefined) {
      this.removeStyle(node, style);
      return;
    }
    const key = styleName(style);
    const important = !!(flags && flags & RendererStyleFlags2.Important);
    this.mirrorStyle(node, key, value);
    this.writeStyle(node, key, important ? 'important' : '');
  }

  removeStyle(node: BrowserNode, style: string): void {
    const key = styleName(style);
    this.mirrorStyle(node, key, undefined);
    this.writeStyle(node, key, '');
  }

  /** From the mirror, which is the whole style: see `native-style.ts` for why one key needs it. */
  private writeStyle(node: BrowserNode, key: string, priority: string): void {
    const style = (node.props['style'] ?? {}) as Record<string, unknown>;
    writeStyleKey((node.el as HTMLElement).style, key, style, priority);
  }

  /** Keeps `node.props['style']` an accurate mirror of the real inline style. See the file doc. */
  private mirrorStyle(node: BrowserNode, key: string, value: unknown): void {
    const current = node.props['style'] as Record<string, unknown> | undefined;
    if (current && OWN_STYLES.has(current)) {
      if (value === undefined) delete current[key];
      else current[key] = value;
      return;
    }
    if (value === undefined && (!current || !(key in current))) return;
    const next = { ...current };
    if (value === undefined) delete next[key];
    else next[key] = value;
    OWN_STYLES.add(next);
    node.props['style'] = next;
  }

  setProperty(node: BrowserNode, name: string, value: unknown): void {
    // `ngDevMode`, not a build-time flag: this package ships to a browser bundler rather than
    // through Metro, so there is no `__DEV__` to fold away - `ngDevMode` is the one dev/release
    // signal Angular itself sets the same way here as it does natively. See
    // `packages/platform/src/adapter.ts`'s `NativeRenderer.setProperty` for the native check this
    // mirrors, and `@ng-native/fabric`'s `forms-inputs.ts` for the table and report both share.
    if (typeof ngDevMode !== 'undefined' && ngDevMode)
      reportUnboundFormsInput(this.engine, node, name);
    this.engine.setProp(node, name, value);
  }

  setValue(node: BrowserNode, value: string): void {
    node.nodeText = value;
    (node.el as Text).data = value;
  }

  listen(
    target: BrowserNode,
    eventName: string,
    callback: (event: unknown) => boolean | void,
  ): () => void {
    return this.engine.setEventListener(target, topLevelType(eventName), callback);
  }
}

/**
 * A component with emulated encapsulation: every element its template creates carries
 * `_ngcontent-<id>`, and its host carries `_nghost-<id>`, which is what the selectors Angular's
 * compiler rewrote (`.card[_ngcontent-%COMP%]`, `[_nghost-%COMP%]`) match. These are the
 * attributes `@angular/platform-browser`'s own emulated renderer writes, so a component's CSS is
 * scoped here exactly as in any other Angular app - and as on a device, where a component's
 * renderer only ever matches its own elements against its own sheet.
 */
class EmulatedRenderer extends BrowserRenderer {
  private readonly contentAttr: string;
  private readonly hostAttr: string;

  constructor(engine: BrowserEngine, document: Document, id: string) {
    super(engine, document);
    this.contentAttr = `_ngcontent-${id}`;
    this.hostAttr = `_nghost-${id}`;
  }

  applyToHost(host: BrowserNode): void {
    if (host.nodeKind === 'element') (host.el as Element).setAttribute(this.hostAttr, '');
  }

  override createElement(name: string): BrowserNode {
    const node = super.createElement(name);
    (node.el as Element).setAttribute(this.contentAttr, '');
    return node;
  }
}

/** The slice of Angular's component definition `createRenderer` is handed that matters here. */
interface ComponentDefLike {
  readonly id: string;
  readonly styles?: readonly string[];
  readonly encapsulation?: ViewEncapsulation;
}

/** The placeholder Angular's compiler writes into scoped selectors, for the renderer to resolve. */
const COMPONENT_ID = /%COMP%/g;

/**
 * The placeholder Angular 22's compiler writes into every custom property in a component's
 * styles, `--%NS%tint`, for a renderer to fill with the app's CSS variable namespace. This host
 * has no namespace, as platform-browser has none by default, so it is filled with nothing: left
 * in, `var(--tint)` never finds `--%NS%tint` and every custom property silently does nothing.
 */
const CSS_VAR_NAMESPACE = /%NS%/g;

/**
 * The property a style binding names. A bound custom property, `[style.--tint]`, arrives with the
 * same placeholder as `--%NS%tint`, filled with nothing for the same reason, and keeps its case:
 * `--brandTint` and `--brand-tint` are two different properties.
 */
function styleName(style: string): string {
  return style.startsWith('--') ? style.replace(CSS_VAR_NAMESPACE, '') : dashCase(style);
}

export class BrowserRendererFactory implements RendererFactory2 {
  private readonly renderer: BrowserRenderer;
  /** One renderer per component with scoped styles, because each stamps its own attribute. */
  private readonly byComponent = new Map<string, EmulatedRenderer>();
  /** Component ids whose stylesheet is already in the document. */
  private readonly styled = new Set<string>();
  private readonly document: Document;
  readonly engine: BrowserEngine;

  constructor(engine: BrowserEngine, document: Document) {
    this.engine = engine;
    this.document = document;
    this.renderer = new BrowserRenderer(engine, document);
    letBrowserNodesPassAsNodes();
  }

  /**
   * One shared renderer for every component without styles of its own, and one per component
   * with them. A component's `styles` go into the document once, the first time it renders, with
   * the compiler's `%COMP%` placeholder resolved to its id. `ViewEncapsulation.None` adds them as
   * written and needs no attributes. Shadow DOM encapsulation is treated as emulated: a native
   * view has no shadow root either, and emulated scoping is what the device's matcher does.
   *
   * The compiler already turns `Emulated` into `None` for a component with no styles, so the
   * shared renderer is still what nearly every component here gets.
   */
  createRenderer(host: unknown, type: ComponentDefLike | null): Renderer2 {
    if (!type?.styles?.length) return this.renderer;
    this.addStyles(type.id, type.styles);
    if (type.encapsulation === ViewEncapsulation.None) return this.renderer;

    let renderer = this.byComponent.get(type.id);
    if (!renderer) {
      renderer = new EmulatedRenderer(this.engine, this.document, type.id);
      this.byComponent.set(type.id, renderer);
    }
    if (host) renderer.applyToHost(host as BrowserNode);
    return renderer;
  }

  private addStyles(id: string, styles: readonly string[]): void {
    if (this.styled.has(id)) return;
    this.styled.add(id);
    const style = this.document.createElement('style');
    style.setAttribute('data-ng-native-component', id);
    style.textContent = styles
      .map((css) => css.replace(COMPONENT_ID, id).replace(CSS_VAR_NAMESPACE, ''))
      .join('\n');
    this.document.head.appendChild(style);
  }
}
