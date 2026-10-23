import type { Engine, EngineNode } from '@ng-native/fabric';
import { inDocument } from './in-document.ts';
import { contentIfAny, HTML_NAMESPACE, SVG_NAMESPACE } from './html-tree.ts';

/**
 * What the HTML Sanitizer API takes out of parsed markup before it is put in place: what a
 * `sanitizer` given to `setHTML`, `appendHTML` and the rest says to, and, for the safe ones of
 * those, what can run a script whatever it says.
 *
 * ponytail: a configuration is a dictionary, never a `Sanitizer`, and the safe methods with none
 * keep every element that runs nothing, where the API's default keeps a list of known ones.
 */

/** What a library reads of a node here. */
type Dom = EngineNode & {
  readonly localName: string | null;
  readonly namespaceURI: string | null;
  getAttributeNames(): string[];
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
};

/** A name in a configuration, in the namespace its list names by default where it gives none. */
interface Name {
  readonly name: string;
  readonly namespace: string | null;
}

interface ElementRule extends Name {
  readonly attributes?: readonly Name[];
  readonly removeAttributes?: readonly Name[];
}

interface Configuration {
  readonly elements?: readonly ElementRule[];
  readonly removeElements?: readonly Name[];
  readonly replaceWithChildrenElements?: readonly Name[];
  readonly attributes?: readonly Name[];
  readonly removeAttributes?: readonly Name[];
  readonly comments: boolean;
  readonly dataAttributes: boolean;
}

/** What runs a script, which a safe method takes out whatever it is told. */
const UNSAFE: readonly Name[] = [
  ...['script', 'frame', 'iframe', 'object', 'embed'].map((name) => ({
    name,
    namespace: HTML_NAMESPACE,
  })),
  { name: 'script', namespace: SVG_NAMESPACE },
  { name: 'use', namespace: SVG_NAMESPACE },
];

/** Attributes whose `javascript:` URL a safe method takes out. */
const NAVIGATING = new Set(['href', 'xlink:href', 'action', 'formaction']);

function nameOf(entry: unknown, namespace: string | null): Name {
  if (entry && typeof entry === 'object') {
    const given = entry as { name?: unknown; namespace?: unknown };
    const space = given.namespace === undefined ? namespace : given.namespace;
    return { name: String(given.name), namespace: space === '' ? null : (space as string | null) };
  }
  return { name: String(entry), namespace };
}

const namesOf = (list: unknown, namespace: string | null): Name[] | undefined =>
  Array.isArray(list) ? list.map((entry) => nameOf(entry, namespace)) : undefined;

function elementRule(entry: unknown): ElementRule {
  const rule = entry as { attributes?: unknown; removeAttributes?: unknown } | null;
  return {
    ...nameOf(entry, HTML_NAMESPACE),
    attributes: namesOf(rule?.attributes, null),
    removeAttributes: namesOf(rule?.removeAttributes, null),
  };
}

/** A configuration from what a script handed over: a dictionary of lists, any of them left out. */
function configurationOf(given: unknown): Configuration {
  const dictionary = (given && typeof given === 'object' ? given : {}) as Record<string, unknown>;
  const elements = dictionary['elements'];
  const attributes = namesOf(dictionary['attributes'], null);
  return {
    elements: Array.isArray(elements) ? elements.map(elementRule) : undefined,
    removeElements: namesOf(dictionary['removeElements'], HTML_NAMESPACE),
    replaceWithChildrenElements: namesOf(dictionary['replaceWithChildrenElements'], HTML_NAMESPACE),
    attributes,
    removeAttributes: namesOf(dictionary['removeAttributes'], null),
    comments: dictionary['comments'] !== false,
    dataAttributes:
      dictionary['dataAttributes'] === undefined ? !attributes : !!dictionary['dataAttributes'],
  };
}

const named = (names: readonly Name[] | undefined, name: string, namespace: string | null) =>
  names?.some((each) => each.name === name && each.namespace === namespace);

/** An attribute's namespace as a configuration names it: none, but for `xlink:` and `xml:`. */
const attributeNamespace = (name: string): string | null =>
  name.startsWith('xlink:')
    ? 'http://www.w3.org/1999/xlink'
    : name.startsWith('xml:')
      ? 'http://www.w3.org/XML/1998/namespace'
      : null;

const localOf = (name: string): string => (attributeNamespace(name) ? name.split(':')[1]! : name);

function keepsAttribute(
  name: string,
  rule: ElementRule | undefined,
  configuration: Configuration,
): boolean {
  const local = localOf(name);
  const namespace = attributeNamespace(name);
  if (named(configuration.removeAttributes, local, namespace)) return false;
  if (named(rule?.removeAttributes, local, namespace)) return false;
  if (named(rule?.attributes, local, namespace)) return true;
  if (configuration.attributes) {
    if (named(configuration.attributes, local, namespace)) return true;
    return configuration.dataAttributes && namespace === null && /^data-./.test(local);
  }
  return true;
}

/** Whether an attribute runs a script: an event handler, or a URL of the `javascript:` scheme. */
function runsScript(name: string, value: string | null): boolean {
  if (/^on/i.test(name)) return true;
  // The URL parser drops the spaces, tabs and line feeds a scheme is hidden by.
  const scheme = (value ?? '')
    .replace(/[\t\n\r]/g, '')
    .trimStart()
    .toLowerCase();
  return NAVIGATING.has(name) && scheme.startsWith('javascript:');
}

function sanitizeAttributes(
  element: Dom,
  rule: ElementRule | undefined,
  configuration: Configuration,
  safe: boolean,
): void {
  for (const name of element.getAttributeNames()) {
    const unsafe = safe && runsScript(name, element.getAttribute(name));
    if (unsafe || !keepsAttribute(name, rule, configuration)) element.removeAttribute(name);
  }
}

/** What the configuration does with an element: keeps it, takes it out, or keeps what it holds. */
function fateOf(
  element: Dom,
  configuration: Configuration,
  safe: boolean,
): 'keep' | 'remove' | 'unwrap' {
  const name = element.localName ?? element.tag;
  const namespace = element.namespaceURI;
  if (safe && named(UNSAFE, name, namespace)) return 'remove';
  if (named(configuration.removeElements, name, namespace)) return 'remove';
  if (named(configuration.replaceWithChildrenElements, name, namespace)) return 'unwrap';
  const listed = named(configuration.elements, name, namespace);
  return configuration.elements === undefined || listed ? 'keep' : 'remove';
}

/** What each child of `parent` comes to: kept, taken out, or put in its place by what it holds. */
function sanitizeChildren(
  parent: EngineNode,
  configuration: Configuration,
  safe: boolean,
  engine: Engine,
): void {
  for (const child of inDocument(parent)) {
    if (child.nodeKind === 'anchor' && !configuration.comments) engine.removeChild(parent, child);
    if (child.nodeKind === 'element')
      sanitizeElement(parent, child as Dom, configuration, safe, engine);
  }
}

function sanitizeElement(
  parent: EngineNode,
  element: Dom,
  configuration: Configuration,
  safe: boolean,
  engine: Engine,
): void {
  const fate = fateOf(element, configuration, safe);
  if (fate === 'remove') {
    engine.removeChild(parent, element);
    return;
  }
  sanitizeChildren(element, configuration, safe, engine);
  const content = element.tag === 'template' ? contentIfAny(element) : undefined;
  if (content) sanitizeChildren(content, configuration, safe, engine);
  if (fate === 'keep') {
    const rule = configuration.elements?.find(
      (each) =>
        each.name === (element.localName ?? element.tag) && each.namespace === element.namespaceURI,
    );
    sanitizeAttributes(element, rule, configuration, safe);
    return;
  }
  for (const each of inDocument(element)) {
    engine.removeChild(element, each);
    engine.insertBefore(parent, each, element);
  }
  engine.removeChild(parent, element);
}

/**
 * Take out of a fragment of parsed markup what the `sanitizer` of a method's options says to, and
 * where the method is a safe one, what runs a script. An unsafe method given none keeps it all.
 */
export function sanitize(fragment: EngineNode, options: unknown, safe: boolean, engine: Engine) {
  const given = (options as { sanitizer?: unknown } | null | undefined)?.sanitizer;
  if (!safe && given === undefined) return;
  sanitizeChildren(fragment, configurationOf(given), safe, engine);
}
