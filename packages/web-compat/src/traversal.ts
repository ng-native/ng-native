import type { Engine, EngineNode } from '@ng-native/fabric';
import { documentOfRoot } from './document-roots.ts';
import { domError } from './dom-error.ts';
import { inDocument } from './in-document.ts';
import { WeakList } from './weak-list.ts';
import { engineOf } from './window.ts';

/**
 * `document.createTreeWalker` and `createNodeIterator`, as the DOM has them: a focus trap walks
 * what can take the focus in a box with one, and an editor walks the text under a node with the
 * other. Each is walked as it is asked, so what changes in the tree between two steps is seen,
 * and an iterator is moved off a node that is taken out of the tree, as a browser moves it.
 */

/** What a walk is told to show, one bit for each kind of node, and what its filter answers. */
export const NodeFilter = Object.freeze({
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_ALL: 0xffffffff,
  SHOW_ELEMENT: 0x1,
  SHOW_ATTRIBUTE: 0x2,
  SHOW_TEXT: 0x4,
  SHOW_CDATA_SECTION: 0x8,
  SHOW_ENTITY_REFERENCE: 0x10,
  SHOW_ENTITY: 0x20,
  SHOW_PROCESSING_INSTRUCTION: 0x40,
  SHOW_COMMENT: 0x80,
  SHOW_DOCUMENT: 0x100,
  SHOW_DOCUMENT_TYPE: 0x200,
  SHOW_DOCUMENT_FRAGMENT: 0x400,
  SHOW_NOTATION: 0x800,
});

const { FILTER_ACCEPT, FILTER_REJECT, FILTER_SKIP } = NodeFilter;

/** A node of a tree as a walk sees one: an engine node, or a document, which holds one. */
type TreeNode = object;
type Filter = ((node: TreeNode) => unknown) | { acceptNode?: unknown } | null;

const isEngineNode = (node: TreeNode): node is EngineNode => 'nodeKind' in node && 'engine' in node;

/** What a node holds, in the order of the page: a document its element, and its doctype first. */
function kids(node: TreeNode): TreeNode[] {
  if (isEngineNode(node)) return inDocument(node);
  const { childNodes, documentElement } = node as {
    childNodes?: ArrayLike<TreeNode | null>;
    documentElement?: TreeNode | null;
  };
  if (childNodes) return Array.from(childNodes).filter((child) => child != null);
  return documentElement ? [documentElement] : [];
}

/** What a node is in: a doctype its document, and a document nothing. */
function parentOf(node: TreeNode): TreeNode | null {
  if (!isEngineNode(node)) return (node as { parentNode?: TreeNode | null }).parentNode ?? null;
  return node.parent ?? documentOfRoot(node) ?? null;
}

function besideOf(node: TreeNode, by: 1 | -1): TreeNode | null {
  const parent = parentOf(node);
  if (!parent) return null;
  const all = kids(parent);
  return all[all.indexOf(node) + by] ?? null;
}

const firstOf = (node: TreeNode): TreeNode | null => kids(node)[0] ?? null;
const lastOf = (node: TreeNode): TreeNode | null => kids(node).at(-1) ?? null;

/** `nodeType` as the DOM numbers it, which is one more than the bit `whatToShow` has for it. */
const typeOf = (node: TreeNode): number => Number((node as { nodeType?: unknown }).nodeType) || 0;

/** Whether `node` is `ancestor` or under it. */
function within(node: TreeNode, ancestor: TreeNode): boolean {
  for (let at: TreeNode | null = node; at; at = parentOf(at)) if (at === ancestor) return true;
  return false;
}

/** The node after `node` in the order of the page, inside `root`, or past what `node` holds. */
function following(node: TreeNode, root: TreeNode, skipInside = false): TreeNode | null {
  if (!skipInside) {
    const first = firstOf(node);
    if (first) return first;
  }
  for (let at: TreeNode | null = node; at && at !== root; at = parentOf(at)) {
    const next = besideOf(at, 1);
    if (next) return next;
  }
  return null;
}

/** The node before `node` in the order of the page, inside `root`. */
function preceding(node: TreeNode, root: TreeNode): TreeNode | null {
  if (node === root) return null;
  let at = besideOf(node, -1);
  if (!at) return parentOf(node);
  for (let last = lastOf(at); last; last = lastOf(at)) at = last;
  return at;
}

/** What a filter is, as the DOM reads the one it was given: a function, or an object's method. */
function callFilter(filter: Filter, node: TreeNode): unknown {
  if (typeof filter === 'function') return filter.call(undefined, node);
  const accept = (filter as { acceptNode?: unknown }).acceptNode;
  if (typeof accept !== 'function') throw new TypeError('The filter has no acceptNode method.');
  return accept.call(filter, node);
}

/** What walks the tree from a root, and what it shows of it: see `TreeWalker`, `NodeIterator`. */
abstract class Traversal {
  readonly #root: TreeNode;
  readonly #whatToShow: number;
  readonly #filter: Filter;
  private active = false;

  constructor(root: TreeNode, whatToShow: number, filter: Filter) {
    this.#root = root;
    this.#whatToShow = whatToShow;
    this.#filter = filter;
  }

  // Read only, as the DOM has them.
  get root(): TreeNode {
    return this.#root;
  }

  get whatToShow(): number {
    return this.#whatToShow;
  }

  get filter(): Filter {
    return this.#filter;
  }

  /** Whether the walk shows a node, and if so what its filter says of it. */
  protected judge(node: TreeNode): number {
    if (this.active) throw domError('The filter is already running.', 'InvalidStateError');
    if (!((this.whatToShow >>> (typeOf(node) - 1)) & 1)) return FILTER_SKIP;
    if (this.filter == null) return FILTER_ACCEPT;
    this.active = true;
    try {
      return Number(callFilter(this.filter, node)) & 0xffff;
    } finally {
      this.active = false;
    }
  }
}

const asWhatToShow = (value: unknown) =>
  value === undefined ? NodeFilter.SHOW_ALL : Number(value) >>> 0;

function asRoot(root: unknown): TreeNode {
  if (root && typeof root === 'object' && typeOf(root) > 0) return root;
  throw new TypeError('The root is not a node.');
}

export class TreeWalker extends Traversal {
  private current: TreeNode;

  constructor(root: TreeNode, whatToShow: number, filter: Filter) {
    super(root, whatToShow, filter);
    this.current = root;
  }

  get [Symbol.toStringTag]() {
    return 'TreeWalker';
  }

  get currentNode(): TreeNode {
    return this.current;
  }

  set currentNode(node: TreeNode) {
    this.current = asRoot(node);
  }

  /** Where the walk goes from here, if anywhere: it is moved there. */
  private moveTo(node: TreeNode | null): TreeNode | null {
    if (node) this.current = node;
    return node;
  }

  parentNode(): TreeNode | null {
    for (let at = this.current; at !== this.root;) {
      const parent = parentOf(at);
      if (!parent) return null;
      if (this.judge(parent) === FILTER_ACCEPT) return this.moveTo(parent);
      at = parent;
    }
    return null;
  }

  firstChild(): TreeNode | null {
    return this.children(true);
  }

  lastChild(): TreeNode | null {
    return this.children(false);
  }

  previousSibling(): TreeNode | null {
    return this.siblings(false);
  }

  nextSibling(): TreeNode | null {
    return this.siblings(true);
  }

  /** The DOM's "traverse children": the first or last child shown, looking into those skipped. */
  private children(first: boolean): TreeNode | null {
    const start = (node: TreeNode) => (first ? firstOf(node) : lastOf(node));
    let node = start(this.current);
    while (node) {
      const result = this.judge(node);
      if (result === FILTER_ACCEPT) return this.moveTo(node);
      const inside = result === FILTER_SKIP ? start(node) : null;
      if (inside) {
        node = inside;
        continue;
      }
      node = this.nextUp(node, first);
    }
    return null;
  }

  /** The next sibling to try after `node`, climbing out of skipped parents, or none. */
  private nextUp(from: TreeNode, forward: boolean): TreeNode | null {
    for (let node: TreeNode | null = from; node;) {
      const sibling = besideOf(node, forward ? 1 : -1);
      if (sibling) return sibling;
      const parent = parentOf(node);
      if (!parent || parent === this.root || parent === this.current) return null;
      node = parent;
    }
    return null;
  }

  /** The DOM's "traverse siblings". */
  private siblings(forward: boolean): TreeNode | null {
    const beside = (node: TreeNode) => besideOf(node, forward ? 1 : -1);
    const into = (node: TreeNode) => (forward ? firstOf(node) : lastOf(node));
    let node: TreeNode | null = this.current;
    if (node === this.root) return null;
    for (;;) {
      let sibling = beside(node);
      while (sibling) {
        node = sibling;
        const result = this.judge(node);
        if (result === FILTER_ACCEPT) return this.moveTo(node);
        sibling = (result !== FILTER_REJECT && into(node)) || beside(node);
      }
      node = parentOf(node!);
      if (!node || node === this.root || this.judge(node) === FILTER_ACCEPT) return null;
    }
  }

  previousNode(): TreeNode | null {
    let node = this.current;
    while (node !== this.root) {
      let sibling = besideOf(node, -1);
      while (sibling) {
        node = sibling;
        let result = this.judge(node);
        for (let last = lastOf(node); result !== FILTER_REJECT && last; last = lastOf(node)) {
          node = last;
          result = this.judge(node);
        }
        if (result === FILTER_ACCEPT) return this.moveTo(node);
        sibling = besideOf(node, -1);
      }
      const parent = parentOf(node);
      if (node === this.root || !parent) return null;
      node = parent;
      if (this.judge(node) === FILTER_ACCEPT) return this.moveTo(node);
    }
    return null;
  }

  nextNode(): TreeNode | null {
    let node = this.current;
    let result: number = FILTER_ACCEPT;
    for (;;) {
      for (let first = firstOf(node); result !== FILTER_REJECT && first; first = firstOf(node)) {
        node = first;
        result = this.judge(node);
        if (result === FILTER_ACCEPT) return this.moveTo(node);
      }
      const next = this.followingOutside(node);
      if (!next) return null;
      node = next;
      result = this.judge(node);
      if (result === FILTER_ACCEPT) return this.moveTo(node);
    }
  }

  /** The node after `node` and all it holds, inside the root. */
  private followingOutside(node: TreeNode): TreeNode | null {
    for (let at: TreeNode | null = node; at && at !== this.root; at = parentOf(at)) {
      const next = besideOf(at, 1);
      if (next) return next;
    }
    return null;
  }
}

/** Every iterator still held, which a node taken out of a document moves off: see below. */
const everyIterator = new WeakList<NodeIterator>();

/**
 * A doctype, comment or element is about to be taken out of a document, which no engine does:
 * each iterator moves off it, as for a node an engine takes out.
 */
export function takingFromDocument(node: TreeNode): void {
  everyIterator.forEach((iterator) => iterator.removing(node));
}

/** The iterators an engine has made that are still held, to move off a node taken out. */
const iterators = new WeakMap<Engine, WeakList<NodeIterator>>();

/** Where an iterator is: at a node, and before it or after it. */
interface Position {
  node: TreeNode;
  before: boolean;
}

/**
 * The DOM's "pre-removing steps" for a place in the tree: where `removed` is about to be taken
 * out, a place in it is moved to the node after it, or failing that to the last before it.
 */
function moveOff(at: Position, removed: TreeNode, root: TreeNode): Position {
  if (removed === root || !within(at.node, removed) || !within(removed, root)) return at;
  if (at.before) {
    const next = following(removed, root, true);
    if (next) return { node: next, before: true };
  }
  let last = besideOf(removed, -1);
  if (!last) return { node: parentOf(removed) ?? root, before: false };
  for (let deeper = lastOf(last); deeper; deeper = lastOf(last)) last = deeper;
  return { node: last, before: false };
}

export class NodeIterator extends Traversal {
  private at: Position;
  /** Where a walk that is asking the filter has got to, which a removal moves too. */
  private flight: Position | undefined;

  constructor(root: TreeNode, whatToShow: number, filter: Filter) {
    super(root, whatToShow, filter);
    this.at = { node: root, before: true };
    const engine = isEngineNode(root) ? engineOf(root) : engineOfDocument(root);
    if (engine) watchRemovals(engine).add(new WeakRef(this));
    everyIterator.add(new WeakRef(this));
  }

  get [Symbol.toStringTag]() {
    return 'NodeIterator';
  }

  get referenceNode(): TreeNode {
    return this.at.node;
  }

  get pointerBeforeReferenceNode(): boolean {
    return this.at.before;
  }

  /** Nothing, as a browser has it now: an iterator lets go of nothing it holds. */
  detach(): void {}

  nextNode(): TreeNode | null {
    return this.traverse(true);
  }

  previousNode(): TreeNode | null {
    return this.traverse(false);
  }

  /**
   * The DOM's "traverse". The node the filter is asked of is where the walk is until it is
   * accepted, and then the iterator's: a filter that takes it out moves the walk off it, and
   * the walk goes on, or the iterator is left, where it was moved to.
   */
  private traverse(forward: boolean): TreeNode | null {
    let at: Position = this.at;
    try {
      for (;;) {
        const node = forward === at.before ? at.node : step(at.node, forward, this.root);
        if (!node) return null;
        this.flight = at = { node, before: !forward };
        const result = this.judge(node);
        at = this.flight;
        if (result === FILTER_ACCEPT) {
          this.at = at;
          return node;
        }
      }
    } finally {
      this.flight = undefined;
    }
  }

  /** A node is about to be taken out of its parent: see `moveOff`. */
  removing(node: TreeNode): void {
    this.at = moveOff(this.at, node, this.root);
    if (this.flight) this.flight = moveOff(this.flight, node, this.root);
  }
}

const step = (node: TreeNode, forward: boolean, root: TreeNode) =>
  forward ? following(node, root) : preceding(node, root);

function engineOfDocument(document: TreeNode): Engine | undefined {
  const element = (document as { documentElement?: EngineNode | null }).documentElement;
  return element ? engineOf(element) : undefined;
}

/**
 * The iterators of an engine, told of each node it takes out before it does: an iterator on a
 * node taken out would otherwise walk on from a node that is in no tree.
 */
function watchRemovals(engine: Engine): WeakList<NodeIterator> {
  let held = iterators.get(engine);
  if (held) return held;
  const all = (held = new WeakList());
  iterators.set(engine, all);
  const removing = (child: EngineNode) => all.forEach((iterator) => iterator.removing(child));
  const { removeChild, appendChild, insertBefore } = engine;
  engine.removeChild = function (parent, child) {
    removing(child);
    removeChild.call(this, parent, child);
  };
  // A node moved is taken out of where it was first.
  engine.appendChild = function (parent, child) {
    if (child.parent) removing(child);
    appendChild.call(this, parent, child);
  };
  engine.insertBefore = function (parent, child, before) {
    if (child.parent) removing(child);
    insertBefore.call(this, parent, child, before);
  };
  return all;
}

/** `document.createTreeWalker`. */
export const createTreeWalker = (root: unknown, whatToShow?: unknown, filter?: Filter) =>
  new TreeWalker(asRoot(root), asWhatToShow(whatToShow), filter ?? null);

/** `document.createNodeIterator`. */
export const createNodeIterator = (root: unknown, whatToShow?: unknown, filter?: Filter) =>
  new NodeIterator(asRoot(root), asWhatToShow(whatToShow), filter ?? null);
