import type { Engine, EngineNode } from '@ng-native/fabric';
import { liveNodeList, type NodeList } from './live-list.ts';
import { report } from './events.ts';
import { isFragment } from './document-fragment.ts';

/**
 * `MutationObserver`, as the DOM has it: what a library hears of an element's attributes, its
 * text and its children, and with `subtree` of everything under it. The CDK's content observer
 * waits on the text and the children of what it watches, and libraries on an attribute.
 *
 * Every change reaches the engine, from a template's binding, from Angular's renderer and from a
 * script alike, so the engine is where a change is heard: its methods are wrapped for an engine
 * once something observes a node of it, and an engine nothing observes runs as it does. A script
 * says what it is changing around that, where the engine would hear it as something else: an
 * attribute by its name, where it is kept as another prop; and several children put in or taken
 * out at once, as one record.
 */

type Kind = 'childList' | 'attributes' | 'characterData';

interface Options {
  childList: boolean;
  attributes: boolean;
  characterData: boolean;
  subtree: boolean;
  attributeOldValue: boolean;
  characterDataOldValue: boolean;
  attributeFilter: readonly string[] | null;
}

/** An observer on a node; `source` is what it was made from, where it is a transient one. */
interface Registration {
  readonly observer: MutationObserver;
  options: Options;
  readonly source: Registration | null;
}

/** The registrations on a node, kept on it: an ancestor walk reads one field of each. */
const REGISTERED = Symbol('registered');
type Registered = EngineNode & { [REGISTERED]?: Registration[] };

/** What observes an engine: how many registrations, and how many of those are for a subtree. */
interface Watch {
  count: number;
  subtrees: number;
  /** What takes the engine's methods back to its own, while they are wrapped. */
  unhook: (() => boolean) | null;
}

const watches = new WeakMap<Engine, Watch>();

/** How many engines something observes: none, and a script's change asks nothing more. */
let watched = 0;

const hostOf = (node: EngineNode): Engine => (node as unknown as { engine: Engine }).engine;

function watchOf(node: EngineNode): Watch | undefined {
  if (!watched) return undefined;
  const watch = watches.get(hostOf(node));
  return watch?.count ? watch : undefined;
}

/** Whether anything observes the engine a node is in. */
export const observing = (node: EngineNode): boolean => watchOf(node) !== undefined;

/** A box the engine made for a rule's `::before` or `::after`, which is no node of the page's. */
const isGenerated = (node: EngineNode): boolean =>
  node.nodeKind === 'element' && node.tag.startsWith('::');

/** Whether a node is one of the page's, under a parent of the page's: none the engine made. */
const ofThePage = (parent: EngineNode, node: EngineNode): boolean =>
  !isGenerated(node) && !isGenerated(parent) && !parent.anonymous;

/** The node of the page's beside the child at `at`, before it for -1 and after it for 1. */
function beside(parent: EngineNode, at: number, step: 1 | -1): EngineNode | null {
  const { childList: children } = parent;
  for (let next = at + step; next >= 0 && next < children.length; next += step) {
    if (!isGenerated(children[next]!)) return children[next]!;
  }
  return null;
}

/** The nodes of the page's either side of the child at `at`. */
const around = (parent: EngineNode, at: number): [EngineNode | null, EngineNode | null] => [
  beside(parent, at, -1),
  beside(parent, at, 1),
];

// Records

const MAKE = Symbol('make');

interface RecordInit {
  type: Kind;
  target: EngineNode;
  added?: readonly EngineNode[];
  removed?: readonly EngineNode[];
  previousSibling?: EngineNode | null;
  nextSibling?: EngineNode | null;
  attributeName?: string | null;
  attributeNamespace?: string | null;
  oldValue?: string | null;
}

const NO_NODES: readonly EngineNode[] = [];

/** One change, as an observer is told of it. Its lists of nodes are made as they are read. */
export class MutationRecord {
  readonly type: Kind;
  readonly target: EngineNode;
  readonly previousSibling: EngineNode | null;
  readonly nextSibling: EngineNode | null;
  readonly attributeName: string | null;
  readonly attributeNamespace: string | null;
  readonly oldValue: string | null;
  private readonly added: readonly EngineNode[];
  private readonly removed: readonly EngineNode[];
  private addedList: NodeList | undefined;
  private removedList: NodeList | undefined;

  constructor(make: unknown, init: RecordInit) {
    if (make !== MAKE) throw new TypeError('Illegal constructor');
    this.type = init.type;
    this.target = init.target;
    this.added = init.added ?? NO_NODES;
    this.removed = init.removed ?? NO_NODES;
    this.previousSibling = init.previousSibling ?? null;
    this.nextSibling = init.nextSibling ?? null;
    this.attributeName = init.attributeName ?? null;
    this.attributeNamespace = init.attributeNamespace ?? null;
    this.oldValue = init.oldValue ?? null;
  }

  get addedNodes(): NodeList {
    return (this.addedList ??= liveNodeList(hostOf(this.target), () => [...this.added]));
  }

  get removedNodes(): NodeList {
    return (this.removedList ??= liveNodeList(hostOf(this.target), () => [...this.removed]));
  }
}

// Who is told

/** Each observer told of a change, and whether it asked for the value before it. */
type Interested = Map<MutationObserver, boolean>;

function accepts(options: Options, kind: Kind, name?: string, namespace?: string | null): boolean {
  if (!options[kind]) return false;
  const filter = kind === 'attributes' ? options.attributeFilter : null;
  return !filter || (namespace == null && filter.includes(name!));
}

const wantsOld = (options: Options, kind: Kind): boolean =>
  (kind === 'attributes' && options.attributeOldValue) ||
  (kind === 'characterData' && options.characterDataOldValue);

/**
 * The observers a change to `target` is for: those on it, and with a subtree observed anywhere in
 * the engine, those on each node it is under that asked for a subtree.
 */
function interested(
  watch: Watch,
  target: EngineNode,
  kind: Kind,
  name?: string,
  namespace?: string | null,
): Interested | null {
  let found: Interested | null = null;
  for (let node: EngineNode | null = target; node; node = watch.subtrees ? node.parent : null) {
    for (const registration of (node as Registered)[REGISTERED] ?? []) {
      const { options, observer } = registration;
      if ((node !== target && !options.subtree) || !accepts(options, kind, name, namespace)) {
        continue;
      }
      found ??= new Map();
      found.set(observer, wantsOld(options, kind) || found.get(observer) === true);
    }
  }
  return found;
}

/** Queue a record for each observer a change is for, with the old value where it asked. */
function queue(found: Interested, init: RecordInit): void {
  for (const [observer, old] of found) {
    enqueue(observer, new MutationRecord(MAKE, old ? init : { ...init, oldValue: null }));
  }
}

const wantsAnyOld = (found: Interested): boolean => [...found.values()].includes(true);

// Delivery

/** The observers with records, or transient registrations, that the next delivery is for. */
const due = new Set<MutationObserver>();
let scheduled = false;

function enqueue(observer: MutationObserver, record: MutationRecord): void {
  observer[QUEUE].push(record);
  due.add(observer);
  schedule();
}

/** Have the observers told once this task is over, once however much changes in it. */
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(notify);
}

/** Tell each observer what it has, in the order the observers were made. */
function notify(): void {
  scheduled = false;
  const observers = [...due].sort((a, b) => a[ORDER] - b[ORDER]);
  due.clear();
  for (const observer of observers) observer[DELIVER]();
}

// Registrations

function watchFor(engine: Engine): Watch {
  let watch = watches.get(engine);
  if (!watch) watches.set(engine, (watch = { count: 0, subtrees: 0, unhook: null }));
  return watch;
}

/** The engine methods a change goes through, which are wrapped while something observes. */
const HOOKED = [
  ...['appendChild', 'insertBefore', 'removeChild', 'setText', 'setProp', 'setClasses'],
  ...['addClass', 'removeClass', 'styleChanged', 'setCustomProperty', 'setEventListener'],
] as const;

/**
 * Wrap an engine's methods, and answer what unwraps them: where nothing has wrapped one over
 * them since, as `traversal.ts` and `live-list.ts` do, they are its own again, else they stay and
 * cost a check.
 */
function hooked(engine: Engine, watch: Watch): () => boolean {
  const own = engine as unknown as Record<string, unknown>;
  const before = HOOKED.map((key) => (Object.hasOwn(own, key) ? own[key] : undefined));
  hook(engine, watch);
  const wrappers = HOOKED.map((key) => own[key]);
  return () => {
    if (HOOKED.some((key, at) => own[key] !== wrappers[at])) return false;
    HOOKED.forEach((key, at) => {
      if (before[at] === undefined) delete own[key];
      else own[key] = before[at];
    });
    return true;
  };
}

/** Count a registration in or out of its engine's, by `by`. */
function count(node: EngineNode, options: Options, by: 1 | -1): void {
  const engine = hostOf(node);
  const watch = watchFor(engine);
  if (watch.count === 0 && by > 0) {
    watched++;
    watch.unhook ??= hooked(engine, watch);
  }
  watch.count += by;
  if (options.subtree) watch.subtrees += by;
  if (watch.count > 0) return;
  watched--;
  if (watch.unhook?.()) watch.unhook = null;
}

function register(node: EngineNode, registration: Registration): void {
  ((node as Registered)[REGISTERED] ??= []).push(registration);
  count(node, registration.options, 1);
}

/** Take the registrations `which` picks off a node. */
function unregister(node: EngineNode, which: (registration: Registration) => boolean): void {
  const list = (node as Registered)[REGISTERED];
  if (!list) return;
  const kept = list.filter((registration) => {
    if (!which(registration)) return true;
    count(node, registration.options, -1);
    return false;
  });
  (node as Registered)[REGISTERED] = kept.length ? kept : undefined;
}

/**
 * A node taken out of an observed subtree is still heard until the observers are next told, as
 * a browser hears it: each registration for a subtree above where it was is put on it for that
 * long.
 */
function keepHearing(watch: Watch, parent: EngineNode, node: EngineNode): void {
  if (!watch.subtrees) return;
  for (let at: EngineNode | null = parent; at; at = at.parent) {
    for (const source of (at as Registered)[REGISTERED] ?? []) {
      if (!source.options.subtree) continue;
      // From what it was observed through in the end: observed again, that lets go of it.
      const from = source.source ?? source;
      register(node, { observer: source.observer, options: source.options, source: from });
      source.observer[TRANSIENT].add(node);
      due.add(source.observer);
      // Let go of at the next delivery, whether or not anything is told at it.
      schedule();
    }
  }
}

// What changed

/** Children changed in a parent under a batch: their records are merged, one a parent. */
interface Pending {
  readonly watch: Watch;
  readonly added: EngineNode[];
  readonly removed: EngineNode[];
  readonly previous: EngineNode | null;
  next: EngineNode | null;
}

let batch: Map<EngineNode, Pending> | null = null;

/** Who a change to a parent's children is for: its observers now, or the batch it is part of. */
type Told = Interested | Map<EngineNode, Pending>;

const toldOf = (watch: Watch, parent: EngineNode): Told | null =>
  batch ?? interested(watch, parent, 'childList');

/** Children came or went: a record now, or a part of one where a script's call makes several. */
function childList(
  told: Told,
  watch: Watch,
  target: EngineNode,
  change: { added?: EngineNode; removed?: EngineNode },
  siblings: [previous: EngineNode | null, next: EngineNode | null],
): void {
  const added = change.added ? [change.added] : [];
  const removed = change.removed ? [change.removed] : [];
  const [previous, next] = siblings;
  if (told !== batch) {
    queue(told as Interested, childListRecord(target, added, removed, previous, next));
    return;
  }
  let pending = batch.get(target);
  if (!pending) batch.set(target, (pending = { watch, added: [], removed: [], previous, next }));
  pending.added.push(...added);
  pending.removed.push(...removed);
  pending.next = next;
}

const childListRecord = (
  target: EngineNode,
  added: EngineNode[],
  removed: EngineNode[],
  previousSibling: EngineNode | null,
  nextSibling: EngineNode | null,
): RecordInit => ({ type: 'childList', target, added, removed, previousSibling, nextSibling });

/**
 * The changes `change` makes to children, told as one record a parent: what `innerHTML`,
 * `replaceChildren` and a fragment put in each are, to a browser.
 */
export function together<T>(node: EngineNode, change: () => T): T {
  if (batch || !watchOf(node)) return change();
  batch = new Map();
  try {
    return change();
  } finally {
    const done = batch;
    batch = null;
    for (const [target, { watch, added, removed, previous, next }] of done) {
      const found = interested(watch, target, 'childList');
      if (found) queue(found, childListRecord(target, added, removed, previous, next));
    }
  }
}

/**
 * Take a node out of where it is before it is put somewhere, where it is to be told as its own
 * change: a browser takes a node out of its parent first as it replaces a child with it. A
 * fragment is told as it empties.
 */
export function adopt(node: EngineNode): void {
  if (!node.parent || isFragment(node) || !watchOf(node)) return;
  hostOf(node).removeChild(node.parent, node);
}

/**
 * Take each of several nodes out of where it is before they are put in together: a browser
 * moves them into a fragment first, and the parent each leaves is told on its own.
 */
export function adoptFirst(nodes: readonly EngineNode[]): void {
  if (nodes.length > 1) for (const node of nodes) adopt(node);
}

/** The node an attribute change is told for by a script, which the engine's hears as its own. */
let scoped: EngineNode | null = null;

/** An attribute change heard: the observers told, with what it was where they asked. */
function attributeChange<T>(
  watch: Watch,
  node: EngineNode,
  name: string,
  namespace: string | null,
  change: () => T,
): T {
  const found = interested(watch, node, 'attributes', name, namespace);
  if (!found) return change();
  const old = wantsAnyOld(found) ? readAttribute(node, name) : null;
  const result = change();
  queue(found, {
    type: 'attributes',
    target: node,
    attributeName: localOf(name),
    attributeNamespace: namespace,
    oldValue: old,
  });
  return result;
}

const readAttribute = (node: EngineNode, name: string): string | null =>
  (node as unknown as { getAttribute?(name: string): string | null }).getAttribute?.(name) ?? null;

/** The name a record has: the local one, past the prefix of one in a namespace. */
const localOf = (name: string): string => name.slice(name.indexOf(':') + 1);

/**
 * A script sets an attribute: told as it is named, and told even where it is set to what it
 * was, as a browser tells it. What the engine is told while it is set is this, and not heard.
 */
export function settingAttribute<T>(
  node: EngineNode,
  name: string,
  change: () => T,
  namespace: string | null = null,
): T {
  const watch = watchOf(node);
  if (!watch || scoped === node) return change();
  return within(node, () => attributeChange(watch, node, name, namespace, change));
}

/** A script takes an attribute off: told where the element had it. */
export function removingAttribute<T>(
  node: EngineNode,
  name: string,
  change: () => T,
  namespace: string | null = null,
): T {
  const watch = watchOf(node);
  if (!watch || scoped === node) return change();
  const has = (node as unknown as { hasAttribute?(name: string): boolean }).hasAttribute;
  if (has && !has.call(node, name)) return within(node, change);
  return within(node, () => attributeChange(watch, node, name, namespace, change));
}

/** Run a script's change to a node, with what the engine is told of it not heard again. */
function within<T>(node: EngineNode, change: () => T): T {
  const outer = scoped;
  scoped = node;
  try {
    return change();
  } finally {
    scoped = outer;
  }
}

/** The words of a comment changed, which the engine keeps none of. */
export function dataChanged(node: EngineNode, old: string): void {
  const watch = watchOf(node);
  const found = watch && interested(watch, node, 'characterData');
  if (found) queue(found, { type: 'characterData', target: node, oldValue: old });
}

// The engine's hooks

/** What a prop is as an attribute: none for one the engine keeps for itself. */
function propAttribute(key: string): string | undefined {
  if (key === 'nativeID') return 'id';
  if (key === 'ɵdisabled') return 'disabled';
  return key.startsWith('ɵ') || ENGINE_PROPS.has(key) ? undefined : key;
}

/** Props the engine sets on a view for itself, which no script wrote. */
const ENGINE_PROPS = new Set(['collapsable', 'styleOverride']);

/** Whether a prop set to `value` is changed by it. */
const changes = (node: EngineNode, key: string, value: unknown): boolean => {
  const before = node.props[key];
  return before !== value && !(before == null && value == null);
};

/** While the engine sets what a listener needs: a prop nothing wrote. */
let quiet = false;

type Method<A extends unknown[]> = (this: Engine, node: EngineNode, ...args: A) => void;

function hook(engine: Engine, watch: Watch): void {
  hookChildren(engine, watch);
  hookText(engine, watch);
  /** An engine method that changes the attribute `nameOf` answers, where it answers one. */
  const attribute = <A extends unknown[]>(
    method: Method<A>,
    nameOf: (node: EngineNode, ...args: A) => string | undefined,
  ): Method<A> =>
    function (node, ...args) {
      const name =
        watch.count && !quiet && scoped !== node && !isGenerated(node)
          ? nameOf(node, ...args)
          : undefined;
      if (name === undefined) return method.call(this, node, ...args);
      attributeChange(watch, node, name, null, () => method.call(this, node, ...args));
    };
  const { setProp, setClasses, addClass, removeClass, styleChanged, setCustomProperty } = engine;
  engine.setProp = attribute(setProp, (node, key: string, value: unknown) =>
    changes(node, key, value) ? propAttribute(key) : undefined,
  );
  const classes = () => 'class';
  engine.setClasses = attribute(setClasses, classes);
  engine.addClass = attribute(addClass, classes);
  engine.removeClass = attribute(removeClass, classes);
  // ponytail: the style the renderer changes in place is read after it changed, as its old value.
  engine.styleChanged = attribute(styleChanged, () => 'style');
  engine.setCustomProperty = attribute(setCustomProperty, () => 'style');
  const { setEventListener } = engine;
  engine.setEventListener = function (...args) {
    quiet = true;
    try {
      return setEventListener.apply(this, args);
    } finally {
      quiet = false;
    }
  };
}

function hookChildren(engine: Engine, watch: Watch): void {
  const { appendChild, insertBefore, removeChild } = engine;
  const added = (parent: EngineNode, child: EngineNode) => {
    const told = watch.count && ofThePage(parent, child) ? toldOf(watch, parent) : null;
    if (!told) return;
    const at = parent.childList.lastIndexOf(child);
    childList(told, watch, parent, { added: child }, around(parent, at));
  };
  engine.appendChild = function (parent, child) {
    appendChild.call(this, parent, child);
    added(parent, child);
  };
  engine.insertBefore = function (parent, child, before) {
    insertBefore.call(this, parent, child, before);
    added(parent, child);
  };
  engine.removeChild = function (parent, child) {
    const from = parent ?? child.parent;
    // Only a child of the parent it is taken out of, which the engine leaves where it is.
    if (!watch.count || !from || child.parent !== from || !ofThePage(from, child)) {
      return removeChild.call(this, parent, child);
    }
    const told = toldOf(watch, from);
    const siblings = told && around(from, from.childList.indexOf(child));
    removeChild.call(this, parent, child);
    keepHearing(watch, from, child);
    if (told && siblings) childList(told, watch, from, { removed: child }, siblings);
  };
}

function hookText(engine: Engine, watch: Watch): void {
  const { setText } = engine;
  engine.setText = function (node, value) {
    const parent = node.parent;
    if (!watch.count || (parent && !ofThePage(parent, node)))
      return setText.call(this, node, value);
    const found = interested(watch, node, 'characterData');
    const old = node.nodeText;
    setText.call(this, node, value);
    if (found) queue(found, { type: 'characterData', target: node, oldValue: old });
  };
}

// The observer

const QUEUE = Symbol('queue');
const ORDER = Symbol('order');
const DELIVER = Symbol('deliver');
const TRANSIENT = Symbol('transient');
let made = 0;

/** The options as `observe` takes them, checked, with what each implies. */
function optionsOf(given: Record<string, unknown> = {}): Options {
  const filter = given['attributeFilter'];
  const options: Options = {
    childList: !!given['childList'],
    attributes: !!given['attributes'],
    characterData: !!given['characterData'],
    subtree: !!given['subtree'],
    attributeOldValue: !!given['attributeOldValue'],
    characterDataOldValue: !!given['characterDataOldValue'],
    attributeFilter: filter === undefined ? null : Array.from(filter as Iterable<unknown>, String),
  };
  const implied = (key: string, ...by: string[]) =>
    given[key] === undefined && by.some((each) => given[each] !== undefined);
  if (implied('attributes', 'attributeOldValue', 'attributeFilter')) options.attributes = true;
  if (implied('characterData', 'characterDataOldValue')) options.characterData = true;
  checkOptions(options);
  return options;
}

function checkOptions(options: Options): void {
  if (!options.childList && !options.attributes && !options.characterData) {
    throw new TypeError('One of childList, attributes or characterData must be true.');
  }
  if ((options.attributeOldValue || options.attributeFilter) && !options.attributes) {
    throw new TypeError(
      'attributeOldValue and attributeFilter are for attributes, which is false.',
    );
  }
  if (options.characterDataOldValue && !options.characterData) {
    throw new TypeError('characterDataOldValue is for characterData, which is false.');
  }
}

/**
 * The node `observe` is given: a node, or the page's document, which is its root element's
 * subtree, since nothing is ever put in a document beside it.
 */
function targetOf(target: unknown, subtree: boolean): EngineNode | null {
  const node = target as {
    engine?: Engine;
    nodeKind?: string;
    documentElement?: EngineNode | null;
  };
  if (node && typeof node === 'object' && node.engine && node.nodeKind) return target as EngineNode;
  if (node && typeof node === 'object' && 'documentElement' in node) {
    return subtree ? (node.documentElement ?? null) : null;
  }
  throw new TypeError(
    "Failed to execute 'observe' on 'MutationObserver': the target is not a Node.",
  );
}

type Callback = (records: MutationRecord[], observer: MutationObserver) => void;

export class MutationObserver {
  [QUEUE]: MutationRecord[] = [];
  readonly [ORDER] = made++;
  /** The nodes this observes, and those it hears for a while after they were taken out. */
  private readonly nodes = new Set<EngineNode>();
  readonly [TRANSIENT] = new Set<EngineNode>();
  private readonly callback: Callback;

  constructor(...args: unknown[]) {
    if (typeof args[0] !== 'function') {
      throw new TypeError(
        "Failed to construct 'MutationObserver': the callback is not a function.",
      );
    }
    this.callback = args[0] as Callback;
  }

  observe(target: unknown, given?: Record<string, unknown>): void {
    const options = optionsOf(given);
    const node = targetOf(target, options.subtree);
    if (!node) return;
    const existing = (node as Registered)[REGISTERED]?.find(
      (registration) => registration.observer === this && !registration.source,
    );
    if (!existing) {
      register(node, { observer: this, options, source: null });
      this.nodes.add(node);
      return;
    }
    for (const each of this[TRANSIENT])
      unregister(each, (registration) => registration.source === existing);
    // Counted in and out again, as its subtree may be another.
    count(node, options, 1);
    count(node, existing.options, -1);
    existing.options = options;
  }

  disconnect(): void {
    for (const node of [...this.nodes, ...this[TRANSIENT]]) {
      unregister(node, (registration) => registration.observer === this);
    }
    this.nodes.clear();
    this[TRANSIENT].clear();
    this[QUEUE] = [];
  }

  takeRecords(): MutationRecord[] {
    const records = this[QUEUE];
    this[QUEUE] = [];
    return records;
  }

  /** Told: what it heard since it last was, and what it heard of taken-out nodes let go. */
  [DELIVER](): void {
    const records = this.takeRecords();
    for (const node of this[TRANSIENT]) {
      unregister(node, (registration) => registration.observer === this && !!registration.source);
    }
    this[TRANSIENT].clear();
    if (!records.length) return;
    try {
      this.callback.call(this, records, this);
    } catch (error) {
      report(error);
    }
  }
}
