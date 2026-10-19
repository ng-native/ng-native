import { claimHost, type Engine, type EngineNode } from '@ng-native/fabric';
import { createComment } from './character-data.ts';
import { classAttribute, setClassAttribute } from './class-list.ts';
import { documentOfRoot, topOf } from './document-roots.ts';
import { insertedFor, isFragment, markFragment } from './document-fragment.ts';
import { domError, required, withLength } from './dom-error.ts';
import { byClassName, byTagName } from './elements-by.ts';
import { descendants, inDocument } from './in-document.ts';
import { liveCollection, liveNodeList, type HTMLCollection, type NodeList } from './live-list.ts';
import { adopt, adoptFirst, together } from './mutation-observer.ts';
import { copyWritten } from './node-members.ts';
import { checkEach, checkInsertion, checkRemoval, isNode } from './pre-insertion.ts';
import { engineOf } from './window.ts';

/**
 * The members of a node for the tree it is in: the live lists of what it holds, every way there
 * is to put a node in it, beside it or in its place, and to take one out, each checked as a
 * browser checks it first; a copy of it; and the top of its tree.
 */
type Dom = EngineNode & {
  readonly parentNode: Dom | null;
  readonly nextSibling: EngineNode | null;
  insertBefore(child: EngineNode, before: EngineNode | null): unknown;
  appendChild(child: EngineNode): unknown;
  removeChild(child: EngineNode): unknown;
};

/** A document a node is at the top of a tree in, as `document-children.ts` holds one. */
interface Holder {
  removeChild(child: EngineNode): unknown;
}

const holderOf = (node: EngineNode): Holder | undefined =>
  documentOfRoot(node) as Holder | undefined;

/** Each node's `childNodes`, the one list for as long as the node is. */
const childLists = new WeakMap<EngineNode, NodeList>();
/** And each element's or fragment's `children`. */
const elementLists = new WeakMap<EngineNode, HTMLCollection>();

/**
 * Put a node in a parent before another of its children, or at its end: out of the document
 * first, where it is at the top of a tree in it.
 */
function putIn(parent: EngineNode, child: EngineNode, before: EngineNode | null): void {
  if (!child.parent) holderOf(child)?.removeChild(child);
  engineOf(parent).insertBefore(parent, child, before);
}

/** What a script hands a node to put in: a node, or the text of anything else. */
const asNodes = (node: EngineNode, items: readonly unknown[]): EngineNode[] =>
  items.map((item) =>
    item && typeof item === 'object'
      ? (item as EngineNode)
      : engineOf(node).createText(String(item)),
  );

/** Put nodes in a node's parent before another of its children, or at its end. */
function putBefore(parent: Dom | null, nodes: readonly EngineNode[], before: EngineNode | null) {
  if (!parent) return;
  together(parent, () => {
    for (const node of nodes) parent.insertBefore(node, before);
  });
}

/** The first node after `node` that is none of those being put in, which may be beside it now. */
function nextNotAmong(node: Dom, nodes: readonly EngineNode[]): EngineNode | null {
  let next = node.nextSibling as Dom | null;
  while (next && nodes.includes(next)) next = next.nextSibling as Dom | null;
  return next;
}

/** `insertAdjacentElement` and `insertAdjacentText`: a node put at a place named around one. */
function insertAdjacent(node: Dom, where: unknown, child: EngineNode): EngineNode | null {
  const parent = node.parent as Dom | null;
  switch (String(where).toLowerCase()) {
    case 'beforebegin':
      return parent ? (parent.insertBefore(child, node) as EngineNode) : null;
    case 'afterbegin':
      return node.insertBefore(child, inDocument(node)[0] ?? null) as EngineNode;
    case 'beforeend':
      return node.appendChild(child) as EngineNode;
    case 'afterend':
      return parent ? (parent.insertBefore(child, node.nextSibling) as EngineNode) : null;
    default:
      throw domError(`'${String(where)}' is no place beside an element.`, 'SyntaxError');
  }
}

/** A prop for a copy of a node: a style object is the copy's own, any other value is shared. */
const ownCopy = (value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : value;

/**
 * A copy of a node, as `cloneNode` makes one: an element of the same name with the same classes
 * and what is set on it, in no tree, and with `deep` a copy of each thing it holds. Its style is
 * its own object, so a change to one is not a change to the other. Listeners are not copied, as
 * a browser copies none, nor a box a rule generated, which the copy is given its own of.
 */
function cloned(engine: Engine, node: EngineNode, deep: boolean): EngineNode {
  if (node.nodeKind === 'text') return engine.createText(node.nodeText);
  if (node.nodeKind !== 'element') return createComment(engine, node.nodeText);
  const copy = engine.createElement(node.tag, node.templateSheet);
  // Its component's, as the one it is a copy of is: no `<view>` a template forgot to import.
  if (node.claimed) claimHost(copy as never);
  if (isFragment(node)) markFragment(copy);
  const classes = classAttribute(node);
  if (classes !== null) setClassAttribute(copy, classes);
  for (const [key, value] of Object.entries(node.props)) engine.setProp(copy, key, ownCopy(value));
  copyWritten(node, copy);
  if (deep) {
    for (const child of inDocument(node)) engine.appendChild(copy, cloned(engine, child, true));
  }
  return copy;
}

/** What a node is under at the top: the document, where its tree is in one, or its own top. */
function rootOf(node: EngineNode): object {
  const top = topOf(node);
  return documentOfRoot(top) ?? top;
}

const get = (read: (this: Dom) => unknown) => ({ get: read });
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

export const treeMembers: PropertyDescriptorMap = {
  // Live: a library keeps the list and reads it again after the tree changes. See `live-list.ts`.
  childNodes: get(function () {
    let list = childLists.get(this);
    if (!list) childLists.set(this, (list = liveNodeList(engineOf(this), () => inDocument(this))));
    return list;
  }),
  // The elements among them, as live: a text or a comment has none to give.
  children: get(function () {
    if (this.nodeKind !== 'element') return undefined;
    let list = elementLists.get(this);
    if (!list) {
      const elements = () => inDocument(this).filter((child) => child.nodeKind === 'element');
      elementLists.set(this, (list = liveCollection(engineOf(this), elements)));
    }
    return list;
  }),

  appendChild: method(function (value: unknown) {
    const child = checkInsertion(this, value, null, 'appendChild');
    // Out of where it is, and then in: two changes, where a fragment's children are one.
    adopt(child);
    together(this, () => {
      for (const each of insertedFor(child)) putIn(this, each, null);
    });
    return child;
  }),
  insertBefore: method(
    withLength(2, function (this: EngineNode, ...args: unknown[]) {
      required(args, 2, 'insertBefore');
      const child = checkInsertion(this, args[0], args[1], 'insertBefore');
      // Before itself is where it is: before what comes after it.
      const given = (args[1] ?? null) as EngineNode | null;
      const before = given === child ? (child as Dom).nextSibling : given;
      adopt(child);
      together(this, () => {
        for (const each of insertedFor(child)) putIn(this, each, before);
      });
      return child;
    }),
  ),
  // `insertBefore` for a node that stays in its own tree: here a move is a removal and an
  // insertion, as one was before `moveBefore`, so what the node keeps across it is what the
  // engine keeps across those.
  moveBefore: method(
    withLength(2, function (this: Dom, ...args: unknown[]) {
      required(args, 2, 'moveBefore');
      const node = checkInsertion(this, args[0], args[1], 'moveBefore');
      if (rootOf(this) !== rootOf(node)) {
        throw domError('A node moves only within its own tree.', 'HierarchyRequestError');
      }
      if (isFragment(node)) {
        throw domError('Only an element or character data moves.', 'HierarchyRequestError');
      }
      this.insertBefore(node, (args[1] ?? null) as EngineNode | null);
    }),
  ),
  removeChild: method(function (value: unknown) {
    const child = checkRemoval(this, value);
    engineOf(this).removeChild(this, child);
    return child;
  }),
  replaceChild: method(
    withLength(2, function (this: EngineNode, ...args: unknown[]) {
      required(args, 2, 'replaceChild');
      const old = args[1];
      if (!isNode(old)) throw new TypeError("Failed to execute 'replaceChild': no child given.");
      const child = checkInsertion(this, args[0], old, 'replaceChild');
      // In its own place is where it is already.
      if (child === old) return old;
      // Taken out of where it is first, and then one change: the one put in for the one out.
      adopt(child);
      together(this, () => {
        for (const each of insertedFor(child)) putIn(this, each, old);
        engineOf(this).removeChild(this, old);
      });
      return old;
    }),
  ),
  // Out of its parent, or out of the document it is at the top of: see `document-children.ts`.
  remove: method(function () {
    if (this.parent) engineOf(this).removeChild(this.parent, this);
    else holderOf(this)?.removeChild(this);
  }),

  append: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    checkEach(this, nodes);
    adoptFirst(nodes);
    together(this, () => {
      for (const node of nodes.flatMap(insertedFor)) putIn(this, node, null);
    });
  }),
  prepend: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    checkEach(this, nodes);
    adoptFirst(nodes);
    // After a box a rule generated before what it holds, which stays first.
    const before = inDocument(this)[0] ?? null;
    together(this, () => {
      for (const node of nodes.flatMap(insertedFor)) putIn(this, node, before);
    });
  }),
  // One change: every child out, and what is handed over in, each taken out of where it was
  // first where there are several.
  replaceChildren: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    checkEach(this, nodes);
    adoptFirst(nodes);
    together(this, () => {
      for (const child of inDocument(this)) engineOf(this).removeChild(this, child);
      for (const node of nodes.flatMap(insertedFor)) putIn(this, node, null);
    });
  }),
  before: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    adoptFirst(nodes.filter((node) => node !== this));
    // Before itself, or what follows it where it is one of those moved.
    putBefore(this.parentNode, nodes, nodes.includes(this) ? nextNotAmong(this, nodes) : this);
  }),
  after: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    adoptFirst(nodes.filter((node) => node !== this));
    putBefore(this.parentNode, nodes, nextNotAmong(this, nodes));
  }),
  replaceWith: method(function (...items: unknown[]) {
    const nodes = asNodes(this, items);
    const parent = this.parentNode;
    const next = nextNotAmong(this, nodes);
    if (parent && !nodes.includes(this)) parent.removeChild(this);
    putBefore(parent, nodes, next);
  }),
  insertAdjacentElement: method(function (...args: unknown[]) {
    required(args, 2, 'insertAdjacentElement');
    const element = args[1] as EngineNode | null;
    if (element?.nodeKind !== 'element') throw new TypeError('The node given is not an Element.');
    return insertAdjacent(this, args[0], element);
  }),
  insertAdjacentText: method(function (...args: unknown[]) {
    required(args, 2, 'insertAdjacentText');
    insertAdjacent(this, args[0], engineOf(this).createText(String(args[1])));
  }),

  cloneNode: method(function (deep?: boolean) {
    return cloned(engineOf(this), this, deep === true);
  }),
  // The document, where the tree a node is in is the page's, and the top of it where it is not.
  getRootNode: method(function () {
    return rootOf(this);
  }),

  // Live lists of the elements under it: see `elements-by.ts`.
  getElementsByTagName: method(function (name: string) {
    return byTagName(engineOf(this), () => descendants(this), name);
  }),
  getElementsByClassName: method(function (names: string) {
    return byClassName(engineOf(this), () => descendants(this), names);
  }),
};
