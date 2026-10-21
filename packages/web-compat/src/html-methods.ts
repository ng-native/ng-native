import type { EngineNode } from '@ng-native/fabric';
import { contentOf, fragmentOf, templateOf } from './html.ts';
import { HTML_NAMESPACE, SVG_NAMESPACE } from './html-tree.ts';
import { isFragment } from './document-fragment.ts';
import { sanitize } from './sanitizer.ts';
import { domError } from './dom-error.ts';
import { inDocument } from './in-document.ts';
import { together } from './mutation-observer.ts';
import { engineOf } from './window.ts';

/**
 * HTML's parsing methods: `setHTML`, and `appendHTML`, `prependHTML`, `beforeHTML`, `afterHTML`
 * and `replaceWithHTML`, each with an `Unsafe` twin. The markup is parsed as the content of the
 * element it goes in, through what a `sanitizer` in the options says to take out, and put in
 * place as one fragment. A safe one takes out what runs a script, and puts nothing in a script.
 */

type Dom = EngineNode & {
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  readonly nodeType: number;
  readonly parentNode: Dom | null;
  readonly nextSibling: EngineNode | null;
  insertBefore(node: EngineNode, before: EngineNode | null): unknown;
  removeChild(node: EngineNode): unknown;
  replaceChildren(...nodes: EngineNode[]): void;
};

const isHtml = (node: Dom, name: string): boolean =>
  node.nodeKind === 'element' && node.localName === name && node.namespaceURI === HTML_NAMESPACE;

/** A script's element, HTML's or SVG's, which a safe method puts nothing in. */
const isScript = (node: Dom): boolean =>
  node.nodeKind === 'element' &&
  node.localName === 'script' &&
  (node.namespaceURI === HTML_NAMESPACE || node.namespaceURI === SVG_NAMESPACE);

function refused(where: string): Error {
  return domError(`Markup cannot be put ${where}.`, 'HierarchyRequestError');
}

/** What an element's own markup goes in: a template's content, or the element itself. */
const targetOf = (element: Dom): Dom =>
  (element.tag === 'template' && !isFragment(element)
    ? contentOf(element, engineOf(element))
    : element) as Dom;

/**
 * The element markup put beside a node is parsed as the content of: its parent, or the template
 * whose content it is in. None where it has no parent; beside a node in a document, a plain
 * fragment, an `<html>` or a template's own children, it is refused.
 */
function contextBeside(node: Dom): Dom | null {
  const parent = node.parentNode;
  if (!parent) return null;
  if (parent.nodeType === 9) throw refused('in a document');
  if (isFragment(parent)) {
    const template = templateOf(parent);
    if (!template) throw refused('in a fragment');
    return template as Dom;
  }
  if (isHtml(parent, 'html')) throw refused('in an <html>');
  if (isHtml(parent, 'template')) throw refused("among a template's children");
  return parent;
}

/** Markup parsed as the content of `context` and sanitized as the method says. */
function parsed(markup: unknown, options: unknown, context: Dom, safe: boolean): EngineNode {
  const engine = engineOf(context);
  const fragment = fragmentOf(markup, context, engine);
  sanitize(fragment, options, safe, engine);
  return fragment;
}

type Place = 'append' | 'prepend';

/** `appendHTML` and `prependHTML`: markup put at the end or the start of what an element holds. */
function inside(element: Dom, place: Place, markup: unknown, options: unknown, safe: boolean) {
  if (isHtml(element, 'html')) throw refused('in an <html>');
  if (safe && isScript(element)) return;
  const fragment = parsed(markup, options, element, safe);
  const target = targetOf(element);
  target.insertBefore(fragment, place === 'append' ? null : (inDocument(target)[0] ?? null));
}

type Beside = 'before' | 'after' | 'replaceWith';

/** `beforeHTML`, `afterHTML` and `replaceWithHTML`: markup put beside a node, or in its place. */
function beside(node: Dom, place: Beside, markup: unknown, options: unknown, safe: boolean) {
  const context = contextBeside(node);
  if (!context || (safe && isScript(context))) return;
  const fragment = parsed(markup, options, context, safe);
  const parent = node.parentNode!;
  if (place === 'replaceWith') {
    together(parent, () => {
      parent.insertBefore(fragment, node);
      parent.removeChild(node);
    });
  } else parent.insertBefore(fragment, place === 'before' ? node : node.nextSibling);
}

/** `setHTML`: what an element holds replaced with what the markup is. */
function set(element: Dom, markup: unknown, options: unknown, safe: boolean) {
  if (safe && isScript(element)) return;
  targetOf(element).replaceChildren(parsed(markup, options, element, safe));
}

const method = (value: (this: Dom, markup: unknown, options?: unknown) => void) => ({
  value(this: Dom, ...args: unknown[]) {
    if (args.length < 1) throw new TypeError('1 argument required, but only 0 present.');
    value.call(this, args[0], args[1]);
  },
  writable: true,
  configurable: true,
});

/** Both of a method: the safe one by its name, and the one that keeps scripts with `Unsafe`. */
function twins(
  name: string,
  run: (node: Dom, markup: unknown, options: unknown, safe: boolean) => void,
): PropertyDescriptorMap {
  return {
    [name]: method(function (markup, options) {
      run(this, markup, options, true);
    }),
    [`${name}Unsafe`]: method(function (markup, options) {
      run(this, markup, options, false);
    }),
  };
}

export const htmlMethods: PropertyDescriptorMap = {
  ...twins('setHTML', set),
  ...twins('appendHTML', (node, ...rest) => inside(node, 'append', ...rest)),
  ...twins('prependHTML', (node, ...rest) => inside(node, 'prepend', ...rest)),
  ...twins('beforeHTML', (node, ...rest) => beside(node, 'before', ...rest)),
  ...twins('afterHTML', (node, ...rest) => beside(node, 'after', ...rest)),
  ...twins('replaceWithHTML', (node, ...rest) => beside(node, 'replaceWith', ...rest)),
};
