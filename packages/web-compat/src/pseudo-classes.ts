import type { EngineNode } from '@ng-native/fabric';
import type { Argument, Complex, Nth } from './parse-selector.ts';
import { documentOfRoot, topOf } from './document-roots.ts';
import { directionOf } from './directionality.ts';
import {
  attributeOf,
  elementsUnder,
  hasAttribute,
  isElement,
  isHtml,
  localNameOf,
  namespaceOf,
  parentElement,
  positionOf,
} from './element-tree.ts';
import { pageUrl } from './page-address.ts';
import { XHTML } from './qualified-name.ts';
import { engineOf } from './window.ts';

/**
 * What each pseudo-class tests of an element, as `querySelector` and `matches` ask. A state the
 * app has no reading of (`:hover` with no pointer, `:visited`, a media element playing) matches
 * nothing, as it would in a browser where it is not the case.
 * A form control's state is read off its own properties: `:checked`, `:valid` and the rest.
 */

/** The element the selector is matched for: `:scope`, and the one a `:has()` is asked of. */
export interface MatchContext {
  readonly scope: EngineNode | null;
  readonly anchor: EngineNode | null;
}

export type Test = (node: EngineNode, context: MatchContext) => boolean;

/** Compiles a selector list, as an argument of `:is()` and the rest needs. */
export type Compile = (list: readonly Complex[], relative?: boolean) => Test;

const never: Test = () => false;

/** `an+b` holds for a position, from one: some whole `n` from zero gives it. */
function fits(nth: Nth, at: number): boolean {
  if (nth.a === 0) return at === nth.b;
  const steps = (at - nth.b) / nth.a;
  return Number.isInteger(steps) && steps >= 0;
}

/** `:nth-child()` and its family, and the plain ones that are each one of them. */
function counting(nth: Nth, fromEnd: boolean, ofType: boolean, of?: Test): Test {
  return (node, context) => {
    if (of && !of(node, context)) return false;
    const name = ofType ? localNameOf(node) : '';
    const space = ofType ? namespaceOf(node) : null;
    const counts = of
      ? (sibling: EngineNode) => of(sibling, context)
      : ofType
        ? (sibling: EngineNode) => localNameOf(sibling) === name && namespaceOf(sibling) === space
        : () => true;
    return fits(nth, positionOf(node, fromEnd, counts));
  };
}

const FIRST: Nth = { a: 0, b: 1 };
const only = (ofType: boolean): Test => {
  const first = counting(FIRST, false, ofType);
  const last = counting(FIRST, true, ofType);
  return (node, context) => first(node, context) && last(node, context);
};

/** Elements a `disabled` attribute disables, and the fieldset's own. */
const DISABLEABLE = ['button', 'input', 'select', 'textarea', 'optgroup', 'option', 'fieldset'];

/** Whether a fieldset disables `node`: it is in one that is disabled, outside its first legend. */
function inDisabledFieldset(node: EngineNode): boolean {
  let child = node;
  for (let at = parentElement(node); at; child = at, at = parentElement(at)) {
    if (!isHtml(at, 'fieldset') || !hasAttribute(at, 'disabled')) continue;
    const legend = at.childList.find((each) => isElement(each) && isHtml(each, 'legend'));
    if (child !== legend || !isHtml(child, 'legend')) return true;
  }
  return false;
}

function disabled(node: EngineNode): boolean {
  if (!isHtml(node, ...DISABLEABLE)) return false;
  if (hasAttribute(node, 'disabled')) return true;
  if (isHtml(node, 'option')) {
    const group = parentElement(node);
    return !!group && isHtml(group, 'optgroup') && hasAttribute(group, 'disabled');
  }
  return !isHtml(node, 'optgroup') && inDisabledFieldset(node);
}

const typeOf = (node: EngineNode): string => (attributeOf(node, 'type') ?? 'text').toLowerCase();
/** The kinds of `<input>` that are typed into. */
const TYPED = new Set([
  ...['text', 'search', 'url', 'tel', 'email', 'password', 'date', 'month', 'week', 'time'],
  ...['datetime-local', 'number'],
]);

/** Whether text in an element can be edited: a field that is not read only, or `contenteditable`. */
function editable(node: EngineNode): boolean {
  if (isHtml(node, 'textarea') || (isHtml(node, 'input') && TYPED.has(typeOf(node)))) {
    return !hasAttribute(node, 'readonly') && !disabled(node);
  }
  for (let at: EngineNode | null = node; at; at = parentElement(at)) {
    const value = attributeOf(at, 'contenteditable');
    if (value === null || value.toLowerCase() === 'inherit') continue;
    return ['', 'true', 'plaintext-only'].includes(value.toLowerCase());
  }
  return false;
}

/** An element's own members, as a script reads them. */
const dom = (node: EngineNode): Record<string, unknown> =>
  node as unknown as Record<string, unknown>;

const isCheckable = (node: EngineNode): boolean =>
  isHtml(node, 'input') && ['checkbox', 'radio'].includes(typeOf(node));

/** Whether an element is subject to constraint validation, and what its validity says. */
function validity(node: EngineNode): boolean | undefined {
  if (isHtml(node, 'form', 'fieldset')) {
    for (const each of elementsUnder(node)) if (validity(each) === false) return false;
    return true;
  }
  if (dom(node)['willValidate'] !== true) return undefined;
  return (dom(node)['validity'] as { valid?: boolean }).valid !== false;
}

/** The input types that have a range, which `min` and `max` give one. */
const RANGED = new Set(['number', 'range', 'date', 'month', 'week', 'time', 'datetime-local']);

/** Whether a field with a `min` or a `max` is within it, or nothing for one with neither. */
function inRange(node: EngineNode): boolean | undefined {
  if (!isHtml(node, 'input') || !RANGED.has(typeOf(node))) return undefined;
  if (!hasAttribute(node, 'min') && !hasAttribute(node, 'max') && typeOf(node) !== 'range') {
    return undefined;
  }
  if (dom(node)['willValidate'] !== true) return undefined;
  const state = dom(node)['validity'] as { rangeUnderflow?: boolean; rangeOverflow?: boolean };
  return !state.rangeUnderflow && !state.rangeOverflow;
}

/** A button that submits its form: one of no type is one. */
const submits = (node: EngineNode): boolean =>
  (isHtml(node, 'button') && !['reset', 'button'].includes(typeOf(node))) ||
  (isHtml(node, 'input') && ['submit', 'image'].includes(typeOf(node)));

/** `:default`: a box checked to begin with, an option selected so, a form's first submit button. */
function byDefault(node: EngineNode): boolean {
  if (isCheckable(node)) return hasAttribute(node, 'checked');
  if (isHtml(node, 'option')) return hasAttribute(node, 'selected');
  if (!submits(node)) return false;
  const form = dom(node)['form'] as EngineNode | null | undefined;
  if (!form) return false;
  const elements = dom(form)['elements'] as Iterable<EngineNode>;
  for (const each of elements) if (submits(each)) return each === node;
  return false;
}

/** The element `document.activeElement` is, or nothing. */
const focusedIn = (node: EngineNode): EngineNode | null => engineOf(node).focused;

/** Whether the element is the top of its document: the page's `<html>`, or a made document's. */
function isRoot(node: EngineNode): boolean {
  if (node.parent) return false;
  return engineOf(node).root === node || documentOfRoot(node) !== undefined;
}

/** `:empty`: no element and no text with anything in it; a comment does not count. */
const empty: Test = (node) =>
  !node.childList.some((child) =>
    child.nodeKind === 'text'
      ? child.nodeText.length > 0
      : child.nodeKind === 'element' && !child.tag.startsWith('::'),
  );

/** The language an element is in: its own `lang`, or the nearest above it. */
function languageOf(node: EngineNode): string | undefined {
  for (let at: EngineNode | null = node; at; at = at.parent) {
    if (at.nodeKind !== 'element') continue;
    const lang = attributeOf(at, 'lang') ?? attributeOf(at, 'xml:lang');
    if (lang !== null) return lang;
  }
  return undefined;
}

/** Extended filtering, RFC 4647 section 3.3.2: `de-*-DE` matches `de-Latn-DE`. */
function languageMatches(tag: string, range: string): boolean {
  if (range === '') return tag === '';
  const tags = tag.toLowerCase().split('-');
  const ranges = range.toLowerCase().split('-');
  if (ranges[0] !== '*' && ranges[0] !== tags[0]) return false;
  if (tag === '') return false;
  let t = 1;
  for (let r = 1; r < ranges.length; r++) {
    if (ranges[r] === '*') continue;
    while (t < tags.length && tags[t] !== ranges[r]) {
      if (tags[t]!.length === 1) return false;
      t++;
    }
    if (t >= tags.length) return false;
    t++;
  }
  return true;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const isHeading = (node: EngineNode): boolean => isHtml(node, ...HEADINGS);

const linked: Test = (node) => isHtml(node, 'a', 'area') && hasAttribute(node, 'href');

/**
 * `:target`: the element in the page whose id the fragment of the page's address names, as the
 * router's route has it. An element out of the page, or of a document a script made, is none.
 *
 * ponytail: by its id alone, so each of two elements with the same id is one, and an `<a name>`
 * is not.
 */
const targeted: Test = (node) => {
  const engine = engineOf(node);
  const url = pageUrl(engine);
  const at = url.indexOf('#');
  if (at === -1 || at === url.length - 1 || topOf(node) !== engine.root) return false;
  let id = url.slice(at + 1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // A fragment that is not percent-encoded is its own id.
  }
  return attributeOf(node, 'id') === id;
};

/** `:focus-within`: the focused element is this one or is inside it. */
const focusWithin: Test = (node) => {
  for (let at = focusedIn(node); at; at = at.parent) if (at === node) return true;
  return false;
};

/** `:defined`: an element HTML defines, or a custom element registered. */
const defined: Test = (node) => {
  const name = localNameOf(node);
  if (namespaceOf(node) !== XHTML || !name.includes('-')) return true;
  const registry = (globalThis as { customElements?: { get(name: string): unknown } })
    .customElements;
  return registry?.get(name) !== undefined;
};

/** The pseudo-classes that take no argument. */
const PLAIN: Readonly<Record<string, Test>> = {
  root: isRoot,
  scope: (node, context) => node === context.scope,
  empty,
  'first-child': counting(FIRST, false, false),
  'last-child': counting(FIRST, true, false),
  'only-child': only(false),
  'first-of-type': counting(FIRST, false, true),
  'last-of-type': counting(FIRST, true, true),
  'only-of-type': only(true),
  focus: (node) => focusedIn(node) === node,
  // ponytail: no reading of whether a focus came from a keyboard, so every focus is visible.
  'focus-visible': (node) => focusedIn(node) === node,
  'focus-within': focusWithin,
  active: (node) => node.active === true,
  target: targeted,
  link: linked,
  'any-link': linked,
  '-webkit-any-link': linked,
  enabled: (node) => isHtml(node, ...DISABLEABLE) && !disabled(node),
  disabled,
  required: (node) => isHtml(node, 'input', 'select', 'textarea') && hasAttribute(node, 'required'),
  optional: (node) =>
    isHtml(node, 'input', 'select', 'textarea') && !hasAttribute(node, 'required'),
  checked: (node) =>
    (isCheckable(node) && dom(node)['checked'] === true) ||
    (isHtml(node, 'option') && dom(node)['selected'] === true),
  indeterminate: (node) =>
    (isHtml(node, 'input') && typeOf(node) === 'checkbox' && dom(node)['indeterminate'] === true) ||
    (isHtml(node, 'progress') && !hasAttribute(node, 'value')),
  default: byDefault,
  'placeholder-shown': (node) =>
    (isHtml(node, 'textarea') || (isHtml(node, 'input') && TYPED.has(typeOf(node)))) &&
    hasAttribute(node, 'placeholder') &&
    dom(node)['value'] === '',
  valid: (node) => validity(node) === true,
  invalid: (node) => validity(node) === false,
  'in-range': (node) => inRange(node) === true,
  'out-of-range': (node) => inRange(node) === false,
  'read-write': editable,
  'read-only': (node) => !editable(node),
  defined,
  heading: isHeading,
  open: (node) => isHtml(node, 'details', 'dialog') && hasAttribute(node, 'open'),
};

/** The functional pseudo-classes, each made from its argument. */
const FUNCTIONAL: Readonly<Record<string, (argument: Argument, compile: Compile) => Test>> = {
  is: (argument, compile) => compile(selectorsOf(argument)),
  where: (argument, compile) => compile(selectorsOf(argument)),
  not: (argument, compile) => {
    const test = compile(selectorsOf(argument));
    return (node, context) => !test(node, context);
  },
  has: (argument, compile) => compile(selectorsOf(argument), true),
  'nth-child': (argument, compile) => nthOf(argument, false, compile),
  'nth-last-child': (argument, compile) => nthOf(argument, true, compile),
  'nth-of-type': (argument) => counting(nthArgument(argument), false, true),
  'nth-last-of-type': (argument) => counting(nthArgument(argument), true, true),
  lang: (argument) => {
    const ranges = wordsOf(argument);
    return (node) => {
      const tag = languageOf(node);
      return tag !== undefined && ranges.some((range) => languageMatches(tag, range));
    };
  },
  dir: (argument) => {
    const [wanted] = wordsOf(argument).map((word) => word.toLowerCase());
    return wanted === 'ltr' || wanted === 'rtl' ? (node) => directionOf(node) === wanted : never;
  },
  heading: (argument) => {
    const levels = argument.kind === 'numbers' ? argument.numbers : [];
    return (node) => isHeading(node) && levels.includes(Number(localNameOf(node)[1]));
  },
};

const selectorsOf = (argument: Argument): readonly Complex[] =>
  argument.kind === 'selectors' ? argument.list : [];
const wordsOf = (argument: Argument): readonly string[] =>
  argument.kind === 'words' ? argument.words : [];
const nthArgument = (argument: Argument): Nth =>
  argument.kind === 'nth' ? argument.nth : { a: 0, b: 0 };

function nthOf(argument: Argument, fromEnd: boolean, compile: Compile): Test {
  const nth = nthArgument(argument);
  return counting(nth, fromEnd, false, nth.of ? compile(nth.of) : undefined);
}

/** The test a pseudo-class is, with its argument where it has one. Unknown ones match nothing. */
export function pseudoClass(name: string, argument: Argument | undefined, compile: Compile): Test {
  if (argument)
    return (Object.hasOwn(FUNCTIONAL, name) && FUNCTIONAL[name]?.(argument, compile)) || never;
  return (Object.hasOwn(PLAIN, name) && PLAIN[name]) || never;
}
