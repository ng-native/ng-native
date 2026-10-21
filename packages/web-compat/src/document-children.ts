import type { EngineNode } from '@ng-native/fabric';
import { documentOfRoot, markRoot, unmarkRoot } from './document-roots.ts';
import { insertedFor, isFragment } from './document-fragment.ts';
import {
  adoptDocumentType,
  isDocumentType,
  placeDocumentType,
  type DocumentType,
} from './document-type.ts';
import { domError, required, withLength } from './dom-error.ts';
import { isNode } from './pre-insertion.ts';
import { engineOf } from './window.ts';
import { takingFromDocument } from './traversal.ts';

/**
 * What a document holds, in order: one element at most, one doctype at most and before it, and
 * comments and processing instructions anywhere among them. No text. The page's document holds
 * the engine's root as its element, which the app is drawn in: it is moved among the rest, and
 * never taken out.
 *
 * The engine has no node for a document, so these are kept here, each noted as the top of a tree
 * in the document, and taken out of it as they are put anywhere else: see `tree-members.ts`.
 */

type Child = EngineNode | DocumentType;

const hierarchy = (message: string) => domError(message, 'HierarchyRequestError');

const isElement = (node: Child): boolean =>
  !isDocumentType(node) && node.nodeKind === 'element' && !isFragment(node);

/** Where a node is to go in a document: by `child`, or in its place where `replacing`. */
interface Place {
  readonly child: Child | null;
  readonly replacing: boolean;
  /** What the document holds besides `child` where it is replaced. */
  readonly others: readonly Child[];
  readonly before: readonly Child[];
  readonly after: readonly Child[];
}

/** A node a document is handed: one that can go in a document, or a refusal. */
function nodeGiven(node: unknown, document: object, method: string): Child {
  if (node === document) throw hierarchy('A document cannot go in itself.');
  if (isNode(node) || isDocumentType(node)) return node;
  const type = (node as { nodeType?: unknown } | null)?.nodeType;
  if (type === 9) throw hierarchy('A document cannot go in a document.');
  throw new TypeError(`Failed to execute '${method}': the node given is not a Node.`);
}

/** A doctype goes before the element, and there is one at most. */
function checkDoctype({ child, others, before }: Place): void {
  if (others.some(isDocumentType)) throw hierarchy('A document holds one doctype.');
  if (before.some(isElement) || (child === null && others.some(isElement))) {
    throw hierarchy('A doctype goes before the element of a document.');
  }
}

/** An element, or a fragment's, goes after the doctype, and there is one at most; no text. */
function checkElements(node: EngineNode, { child, replacing, others, after }: Place): void {
  const nodes = isFragment(node) ? insertedFor(node) : [node];
  if (nodes.some((each) => each.nodeKind === 'text')) throw hierarchy('A document holds no text.');
  const placed = nodes.filter(isElement);
  if (placed.length > 1) throw hierarchy('A document holds one element.');
  if (placed.length === 0) return;
  if (others.some(isElement)) throw hierarchy('A document holds one element.');
  const beforeDoctype = !replacing && child !== null && isDocumentType(child);
  if (beforeDoctype || after.some(isDocumentType)) {
    throw hierarchy('The element of a document goes after its doctype.');
  }
}

const staysIn = () =>
  domError("The page's element stays in it: the app is drawn in it.", 'NotSupportedError');

/** How each document checks the nodes a child of it puts beside it: see `checkInDocument`. */
const checks = new WeakMap<
  object,
  (items: readonly unknown[], child: Child | null, gone: readonly Child[], method: string) => void
>();

/**
 * Throw where the nodes a child of a document is handed cannot go in it before `child`, with
 * those `gone` taken out first: a child's `before`, `after` and `replaceWith`, checked as one
 * before any is put in. See `tree-members.ts`.
 */
export function checkInDocument(
  document: object,
  items: readonly unknown[],
  child: EngineNode | null,
  gone: readonly EngineNode[],
  method: string,
): void {
  checks.get(document)?.(items, child, gone, method);
}

/** The page's own element and doctype, for its document: see `document.ts`. */
interface PageHeld {
  readonly element: EngineNode;
  readonly doctype: DocumentType;
}

/** The members of a document for what it holds, `childNodes` to `replaceChildren`. */
export function documentChildren(document: object, page?: PageHeld): PropertyDescriptorMap {
  let kids: Child[] = page ? [page.doctype, page.element] : [];
  if (page) placeDocumentType(page.doctype, document);
  /** What it holds still: none put somewhere else since. */
  const held = (): Child[] =>
    (kids = kids.filter((kid) =>
      isDocumentType(kid)
        ? kid.parentNode === document
        : kid === page?.element || (!kid.parent && documentOfRoot(kid) === document),
    ));
  const elementOf = () => held().find(isElement) ?? null;
  const doctypeOf = () => (held().find(isDocumentType) as DocumentType | undefined) ?? null;

  /** Throw where `node` cannot go in the document, before `child` or in its place. */
  function check(
    node: unknown,
    child: Child | null,
    replacing: boolean,
    method: string,
    gone: readonly Child[] = [],
  ): Child {
    const given = nodeGiven(node, document, method);
    // What is taken out first: all there is for `replaceChildren`, the node replaced for
    // `replaceWith`.
    const all = held().filter((kid) => !gone.includes(kid));
    if (child !== null && !all.includes(child)) {
      throw domError(`The node to go by is not a child of this document.`, 'NotFoundError');
    }
    const at = child === null ? all.length : all.indexOf(child);
    const place: Place = {
      child,
      replacing,
      others: replacing ? all.filter((kid) => kid !== child) : all,
      before: all.slice(0, at),
      after: all.slice(replacing ? at + 1 : at),
    };
    if (isDocumentType(given)) checkDoctype(place);
    else checkElements(given, place);
    return given;
  }

  /** Take a node out of where it is: its parent, or the document it is at the top of a tree in. */
  function takeOut(node: Child): void {
    if (isDocumentType(node)) return node.remove();
    if (node.parent) return engineOf(node).removeChild(node.parent, node);
    // The page's element is never taken out: it is moved where it is put, as it is left.
    if (node === page?.element) return;
    (documentOfRoot(node) as { removeChild?(node: Child): void } | undefined)?.removeChild?.(node);
  }

  /** Take a node out of where it is and put it in the document, before `child`. */
  function put(node: Child, child: Child | null): void {
    const nodes: Child[] = isDocumentType(node) ? [node] : insertedFor(node);
    for (const each of nodes) takeOut(each);
    const all = held().filter((kid) => !nodes.includes(kid));
    const at = child === null ? all.length : all.indexOf(child);
    kids = [...all.slice(0, at), ...nodes, ...all.slice(at)];
    for (const each of nodes) {
      if (isDocumentType(each)) {
        adoptDocumentType(each, document);
        placeDocumentType(each, document);
      } else if (each !== page?.element) markRoot(each, document);
    }
  }

  function take(child: Child): void {
    if (child === page?.element) throw staysIn();
    takingFromDocument(child);
    kids = held().filter((kid) => kid !== child);
    if (isDocumentType(child)) placeDocumentType(child, null);
    else unmarkRoot(child);
  }

  /**
   * What `append`, `prepend`, `replaceChildren` and a child's `before` and the rest are given, as
   * one node or several, checked as one before any is put in: a browser puts several in a
   * fragment, which it checks.
   */
  function given(
    items: readonly unknown[],
    method: string,
    gone: readonly Child[] = [],
    child: Child | null = null,
  ) {
    for (const item of items) {
      if (typeof item === 'string') throw hierarchy('A document holds no text.');
    }
    // Several are put in a fragment first, where a doctype cannot go.
    if (items.length > 1 && items.some(isDocumentType)) {
      throw hierarchy('A doctype cannot go in a fragment.');
    }
    const nodes = items.map((item) => check(item, child, false, method, gone));
    if (nodes.length > 1) {
      const elements = nodes.flatMap((node) =>
        isDocumentType(node) ? [] : insertedFor(node).filter(isElement),
      );
      if (elements.length > 1) throw hierarchy('A document holds one element.');
    }
    return nodes;
  }

  checks.set(document, (items, child, gone, method) => void given(items, method, gone, child));

  const get = (read: () => unknown) => ({ get: read, configurable: true });
  const method = (value: (...args: never[]) => unknown) => ({
    value,
    writable: true,
    configurable: true,
  });
  return {
    childNodes: get(() => held()),
    firstChild: get(() => held()[0] ?? null),
    lastChild: get(() => held().at(-1) ?? null),
    documentElement: get(elementOf),
    firstElementChild: get(elementOf),
    lastElementChild: get(elementOf),
    childElementCount: get(() => (elementOf() ? 1 : 0)),
    children: get(() => held().filter(isElement)),
    doctype: get(doctypeOf),
    hasChildNodes: method(() => held().length > 0),
    appendChild: method((...args: unknown[]) => {
      required(args, 1, 'appendChild');
      const node = check(args[0], null, false, 'appendChild');
      put(node, null);
      return node;
    }),
    insertBefore: method(
      withLength(2, (...args: unknown[]) => {
        required(args, 2, 'insertBefore');
        const child = (args[1] ?? null) as Child | null;
        const node = check(args[0], child, false, 'insertBefore');
        put(node, child === node ? (held()[held().indexOf(child) + 1] ?? null) : child);
        return node;
      }),
    ),
    // `insertBefore` for a node of this document's own tree, as an element's is: see `node-members.ts`.
    moveBefore: method(
      withLength(2, (...args: unknown[]) => {
        required(args, 2, 'moveBefore');
        const child = (args[1] ?? null) as Child | null;
        const node = check(args[0], child, false, 'moveBefore');
        let top = node as { parent?: unknown };
        while (top.parent) top = top.parent as { parent?: unknown };
        if (!held().includes(top as Child))
          throw hierarchy('A node moves only within its own tree.');
        if (isDocumentType(node) || isFragment(node)) {
          throw hierarchy('Only an element or character data moves.');
        }
        put(node, child === node ? (held()[held().indexOf(child) + 1] ?? null) : child);
      }),
    ),
    replaceChild: method(
      withLength(2, (...args: unknown[]) => {
        required(args, 2, 'replaceChild');
        const child = args[1] as Child;
        if (!isNode(child) && !isDocumentType(child)) {
          throw new TypeError("Failed to execute 'replaceChild': the child given is not a Node.");
        }
        const node = check(args[0], child, true, 'replaceChild');
        if (node === child) return child;
        const next = held()[held().indexOf(child) + 1] ?? null;
        take(child);
        put(node, next === node ? (held()[held().indexOf(node) + 1] ?? null) : next);
        return child;
      }),
    ),
    removeChild: method((...args: unknown[]) => {
      required(args, 1, 'removeChild');
      const child = args[0] as Child;
      if (!held().includes(child)) {
        if (!isNode(child) && !isDocumentType(child)) {
          throw new TypeError("Failed to execute 'removeChild': the node given is not a Node.");
        }
        throw domError('The node to remove is not a child of this document.', 'NotFoundError');
      }
      take(child);
      return child;
    }),
    append: method((...items: unknown[]) => {
      for (const node of given(items, 'append')) put(node, null);
    }),
    prepend: method((...items: unknown[]) => {
      const first = held()[0] ?? null;
      for (const node of given(items, 'prepend', [], first)) put(node, first);
    }),
    replaceChildren: method((...items: unknown[]) => {
      const nodes = given(items, 'replaceChildren', held());
      const kept = nodes.flatMap((node): Child[] =>
        isDocumentType(node) ? [node] : insertedFor(node),
      );
      const taken = held().filter((kid) => !kept.includes(kid));
      // The page's element among what goes, which stays, refused before anything is taken out.
      if (page && taken.includes(page.element)) throw staysIn();
      for (const kid of taken) take(kid);
      for (const node of nodes) put(node, null);
    }),
  };
}
