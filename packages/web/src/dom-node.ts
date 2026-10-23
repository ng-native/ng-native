/**
 * The retained node this package hands Angular as `ElementRef.nativeElement`, and the thing every
 * `HostEngine` method actually operates on.
 *
 * `packages/fabric/src/engine.ts`'s `EngineNode` is not reusable here (its constructor-free shape
 * still carries Fabric-only bookkeeping - `committed`, `styleCache`, `templateSheet`...), but the shared
 * packages never ask for that: they ask for `HostNode`'s five fields, plus whatever a component
 * reads directly off `this.node` after `inject(ElementRef).nativeElement as EngineNode` casts it
 * back. Grepping every such read (`view-base.ts`, `pressable.ts`'s `TouchableBase`, `scroll-view.ts`,
 * `select.ts`'s `textOf`) turns up exactly `nodeKind`, `props`, `nodeText`, `childList` and `parent` - so a
 * class that implements `HostNode` honestly, backed by a real DOM node, satisfies every one of
 * them without a cast.
 *
 * `childList`/`parent` are maintained by hand rather than read live off the DOM (`el.parentElement`,
 * `el.childNodes`) for the same reason `Engine` keeps its own tree: a live DOM walk would have to
 * filter out nodes this package did not create (there are none today, but a consumer's own
 * `document.createElement` inside a projected template is not this package's to assume against),
 * and `select.ts`'s `textOf` recursion wants exactly the nodes Angular put here, in order.
 */
import type { HostNode } from '@ng-native/fabric';

export type BrowserNodeKind = 'element' | 'text' | 'anchor';

export interface BrowserNode extends HostNode {
  readonly nodeKind: BrowserNodeKind;
  /** The real DOM node this wraps. An `Element` for `element`, a `Text` for `text`. */
  readonly el: Element | Text | Comment;
  /** Lowercase template spelling, e.g. `view`. Mirrors `EngineNode.tag`; never the DOM tag. */
  readonly tag: string;
  /** `tag` again on an element, for Angular 22.0, which reads it on a component's host element. */
  readonly tagName?: string;
  /**
   * The wrapped element's attributes, on an element, for Angular's hydration. Once an app on the
   * page calls `provideClientHydration()`, every component's host element is asked for
   * `ngSkipHydration` and `ngh`, an island's included, whatever renderer created it. See
   * `BrowserEngine.wrapRoot` for the answer that keeps hydration out of an island.
   */
  readonly hasAttribute?: (this: BrowserNode, name: string) => boolean;
  readonly getAttribute?: (this: BrowserNode, name: string) => string | null;
  props: Record<string, unknown>;
  nodeText: string;
  childList: BrowserNode[];
  parent: BrowserNode | null;
  /**
   * Registered listeners, by top-level type (`topTouchStart`, `topChange`, ...). `null` until
   * the first one, so a node nothing ever listens to costs one field rather than one `Map`.
   */
  listeners: Map<string, Set<(event: unknown) => void>> | null;
  /**
   * Which opt-in event types (`topLayout`, `topPointerEnter`, `topPointerLeave`) already have
   * their real DOM listener installed - `browser-engine.ts`'s `wireOptIn` guard. `null` until
   * the first one, matching `listeners` above.
   */
  optedIn: Set<string> | null;
}

/** `event.target`, and anything else holding a real DOM node, back to the `BrowserNode` for it. */
const registry = new WeakMap<Element | Text | Comment, BrowserNode>();

const made = new WeakSet<object>();
const answered = new WeakSet<object>();

type Constructor = abstract new (...args: never[]) => object;

export function letBrowserNodesPassAsDomNodes(): void {
  const scope = globalThis as { Node?: Constructor; Element?: Constructor };
  letPass(scope.Node, (value) => made.has(value as object));
  letPass(
    scope.Element,
    (value) => made.has(value as object) && (value as BrowserNode).nodeKind === 'element',
  );
  letBrowserNodesBeObserved();
}

function letPass(target: Constructor | undefined, ours: (value: unknown) => boolean): void {
  if (typeof target !== 'function' || answered.has(target)) return;
  answered.add(target);
  const own = target[Symbol.hasInstance];
  Object.defineProperty(target, Symbol.hasInstance, {
    configurable: true,
    value(this: Constructor, value: unknown): boolean {
      return (this === target && ours(value)) || own.call(this, value);
    },
  });
}

function unwrap(target: unknown): unknown {
  return made.has(target as object) ? (target as BrowserNode).el : target;
}

const observedBy = new WeakMap<
  BrowserNode,
  Set<{ moveTo(node: BrowserNode, from: Element, to: Element): boolean }>
>();

function letBrowserNodesBeObserved(): void {
  const scope = globalThis as { IntersectionObserver?: typeof IntersectionObserver };
  const Native = scope.IntersectionObserver;
  if (typeof Native !== 'function' || answered.has(Native)) return;
  const asSeen = (wrapped: WeakMap<Element, BrowserNode>, entry: IntersectionObserverEntry) => {
    const node = wrapped.get(entry.target);
    if (!node) return entry;
    return {
      time: entry.time,
      rootBounds: entry.rootBounds,
      boundingClientRect: entry.boundingClientRect,
      intersectionRect: entry.intersectionRect,
      intersectionRatio: entry.intersectionRatio,
      isIntersecting: entry.isIntersecting,
      target: node,
    } as unknown as IntersectionObserverEntry;
  };
  class Observer extends Native {
    private wrapped = new WeakMap<Element, BrowserNode>();

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      super(
        (entries, observer) =>
          callback(
            entries.map((entry) => asSeen((observer as Observer).wrapped, entry)),
            observer,
          ),
        options,
      );
    }

    override observe(target: Element): void {
      const el = unwrap(target) as Element;
      if (el !== target) {
        const node = target as unknown as BrowserNode;
        this.wrapped.set(el, node);
        let observers = observedBy.get(node);
        if (!observers) observedBy.set(node, (observers = new Set()));
        observers.add(this);
      } else this.wrapped.delete(el);
      super.observe(el);
    }

    override unobserve(target: Element): void {
      const el = unwrap(target) as Element;
      this.wrapped.delete(el);
      super.unobserve(el);
    }

    override disconnect(): void {
      this.wrapped = new WeakMap();
      super.disconnect();
    }

    override takeRecords(): IntersectionObserverEntry[] {
      return super.takeRecords().map((entry) => asSeen(this.wrapped, entry));
    }

    moveTo(node: BrowserNode, from: Element, to: Element): boolean {
      if (this.wrapped.get(from) !== node) return false;
      this.unobserve(from);
      this.observe(to);
      this.wrapped.set(to, node);
      return true;
    }
  }
  answered.add(Observer);
  scope.IntersectionObserver = Observer;
}

interface Added {
  readonly type: string;
  readonly listener: EventListenerOrEventListenerObject;
  readonly options: AddEventListenerOptions | boolean | undefined;
  readonly capture: boolean;
  /** What the element was given: `listener`, or for a `once` one, a wrapper that forgets it. */
  readonly registered: EventListenerOrEventListenerObject;
  readonly forget: () => void;
}

const addedTo = new WeakMap<BrowserNode, Added[]>();

const captures = (options: EventListenerOptions | boolean | undefined) =>
  typeof options === 'boolean' ? options : options?.capture === true;

function addEventListener(
  this: BrowserNode,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): void {
  const capture = captures(options);
  let added = addedTo.get(this);
  if (!added) addedTo.set(this, (added = []));
  if (added.some((a) => a.type === type && a.listener === listener && a.capture === capture)) {
    return;
  }
  const signal = typeof options === 'object' ? options.signal : undefined;
  if (signal?.aborted) return;
  const list = added;
  const forget = () => {
    const at = list.indexOf(entry);
    if (at !== -1) list.splice(at, 1);
    signal?.removeEventListener('abort', forget);
  };
  // A `once` listener is forgotten before it runs, so a swap never brings it back: not when it
  // stops the event, and not when it swaps the element itself.
  const registered =
    typeof options === 'object' && options.once === true
      ? function (this: EventTarget, event: Event) {
          forget();
          if (typeof listener === 'function') listener.call(this, event);
          else listener.handleEvent(event);
        }
      : listener;
  const entry: Added = { type, listener, options, capture, registered, forget };
  list.push(entry);
  signal?.addEventListener('abort', forget);
  this.el.addEventListener(type, registered, options);
}

function removeEventListener(
  this: BrowserNode,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: EventListenerOptions | boolean,
): void {
  const capture = captures(options);
  const added = addedTo
    .get(this)
    ?.find((a) => a.type === type && a.listener === listener && a.capture === capture);
  this.el.removeEventListener(type, added?.registered ?? listener, options);
  added?.forget();
}

/**
 * The prototype of every element node. Angular's development build reports a binding as an unknown
 * property (NG0303) unless `name in element` is true, and every binding on an element here goes to
 * `setProperty`, whatever its name.
 */
const anyProperty = new Proxy(
  { addEventListener, removeEventListener },
  { has: (_, name) => typeof name === 'string' },
);

/**
 * The SVG names whose `fill`/`stroke` need a seeded `props` entry from the moment they are
 * created - see the block below for why. `svg-line` is left out: a `<line>` has no fill of its
 * own to paint (react-native-svg's `Line` never reads `fill` either), so there is nothing an
 * explicit `fill="none"` there could mean.
 */
const SVG_BRUSH_ELEMENTS = new Set([
  'svg-g',
  'svg-path',
  'svg-circle',
  'svg-ellipse',
  'svg-rect',
  'svg-text',
  'svg-tspan',
]);

function hasAttribute(this: BrowserNode, name: string): boolean {
  return (this.el as Element).hasAttribute(name);
}

function getAttribute(this: BrowserNode, name: string): string | null {
  return (this.el as Element).getAttribute(name);
}

export function makeElementNode(name: string, el: Element): BrowserNode {
  const props: Record<string, unknown> = {};
  // `packages/icons/src/svg-props.ts`'s `brushOf` turns a literal `fill="none"`/`stroke="none"`
  // into `null` - a real, meaningful value ("paint nothing"), not an absent one. But
  // `BrowserEngine.setProp` treats `null` exactly like `undefined` on a key it has never seen
  // before: `if (!(key in node.props)) return;`, its fast path for "nothing to remove, so nothing
  // changed". That path is right for almost everything a `null` prop could mean, and wrong here -
  // it would skip `applyProp` entirely on a chart line's `fill="none"` (`chart-line.ts`,
  // `chart-area.ts`), leaving the attribute unset, and an unset `fill` defaults to opaque black in
  // a browser (the real SVG initial value) rather than to unpainted (what react-native-svg's own
  // `propList` convention, and every one of these charts, is relying on). Seeding the key here -
  // present, value `undefined` - costs nothing on a shape that never touches the prop again, and
  // is what lets that first `null` reach `props.ts`'s real translation instead of being dropped by
  // the fast path. See `props.ts`'s `applyBrush` for the other half: it is what turns a seeded
  // key's `null` into a written `fill="none"`/`stroke="none"` rather than a removed attribute.
  if (SVG_BRUSH_ELEMENTS.has(name)) {
    props['fill'] = undefined;
    props['stroke'] = undefined;
  }
  const node: BrowserNode = {
    nodeKind: 'element',
    el,
    tag: name,
    tagName: name,
    hasAttribute,
    getAttribute,
    props,
    nodeText: '',
    childList: [],
    parent: null,
    listeners: null,
    optedIn: null,
  };
  Object.setPrototypeOf(node, anyProperty);
  registry.set(el, node);
  made.add(node);
  return node;
}

export function makeTextNode(text: Text): BrowserNode {
  const node: BrowserNode = {
    nodeKind: 'text',
    el: text,
    tag: '#text',
    props: {},
    nodeText: text.data,
    childList: [],
    parent: null,
    listeners: null,
    optedIn: null,
  };
  registry.set(text, node);
  made.add(node);
  return node;
}

/** Angular's `@if`/`@for`/`ViewContainerRef` markers, backed by a real `Comment`. */
export function makeAnchorNode(comment: Comment): BrowserNode {
  const node: BrowserNode = {
    nodeKind: 'anchor',
    el: comment,
    tag: '#anchor',
    props: {},
    nodeText: '',
    childList: [],
    parent: null,
    listeners: null,
    optedIn: null,
  };
  registry.set(comment, node);
  made.add(node);
  return node;
}

/**
 * Puts `el` in place of the element `node` wraps, so `nodeOf` finds the node from either, and moves
 * the listeners and observations added through `node` from the old element to `el`.
 */
export function rebindElement(node: BrowserNode, el: Element): void {
  const old = node.el as Element;
  registry.delete(old);
  (node as { el: Element | Text | Comment }).el = el;
  registry.set(el, node);
  for (const added of addedTo.get(node) ?? []) {
    old.removeEventListener(added.type, added.registered, added.capture);
    el.addEventListener(added.type, added.registered, added.options);
  }
  const observers = observedBy.get(node);
  for (const observer of observers ?? []) {
    if (!observer.moveTo(node, old, el)) observers!.delete(observer);
  }
}

/** The `BrowserNode` a real DOM node was created with, or `null` for one this package did not make. */
export function nodeOf(el: Element | Text | Comment | null): BrowserNode | null {
  return el ? (registry.get(el) ?? null) : null;
}

/**
 * The nearest `BrowserNode` starting at a real `Element` and walking up `parentElement`.
 *
 * Used to resolve `event.target` for events this package listens for on `document` rather than
 * per-node (the responder system's pointer events, focus/blur, selection change): the physical
 * hit is always a real element this package created, but it is not always one with its own
 * listeners, so the search has to climb past any that are not tracked before it gets to `body`
 * and turns up nothing.
 */
export function nearestNodeOf(el: Element | null): BrowserNode | null {
  for (let current = el; current; current = current.parentElement) {
    const node = registry.get(current);
    if (node) return node;
  }
  return null;
}

/** Root-first path from the tree's root to `node`, inclusive. Mirrors `Engine`'s own `pathTo`. */
export function pathTo(node: BrowserNode): BrowserNode[] {
  const path: BrowserNode[] = [];
  for (let current: BrowserNode | null = node; current; current = current.parent)
    path.push(current);
  return path.reverse();
}
