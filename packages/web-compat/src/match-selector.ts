import type { EngineNode } from '@ng-native/fabric';
import {
  parseSelectorList,
  type Combinator,
  type Complex,
  type Compound,
  type Simple,
} from './parse-selector.ts';
import { pseudoClass, type MatchContext, type Test } from './pseudo-classes.ts';
import {
  attributeOf,
  elementsUnder,
  isElement,
  laterElements,
  localNameOf,
  namespaceOf,
  parentElement,
  previousElement,
} from './element-tree.ts';
import { XHTML } from './qualified-name.ts';

/**
 * A selector list made into one test of an element, matched right to left as a browser does:
 * the subject's compound first, which turns almost every element away, then each combinator in
 * turn, trying every ancestor or every earlier sibling a descendant or a `~` could be.
 */

const always: Test = () => true;
const never: Test = () => false;

/**
 * The attributes whose value HTML compares in any case, for an HTML element, where the selector
 * gives no `s` flag (https://html.spec.whatwg.org/#case-sensitivity-of-selectors).
 */
const ANY_CASE: ReadonlySet<string> = new Set([
  ...['accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked'],
  ...['clear', 'codetype', 'color', 'compact', 'declare', 'defer', 'dir', 'direction'],
  ...['disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang', 'language'],
  ...['link', 'media', 'method', 'multiple', 'nohref', 'noresize', 'noshade', 'nowrap'],
  ...['readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling', 'selected', 'shape', 'target'],
  ...['text', 'type', 'valign', 'valuetype', 'vlink'],
]);

const asciiLower = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Whether an attribute's value passes an operator's test, both already in the case compared. */
function valueMatches(actual: string, operator: string, wanted: string): boolean {
  switch (operator) {
    case '=':
      return actual === wanted;
    case '~=':
      return (
        wanted !== '' &&
        !/[ \t\n\r\f]/.test(wanted) &&
        actual.split(/[ \t\n\r\f]+/).includes(wanted)
      );
    case '|=':
      return actual === wanted || actual.startsWith(`${wanted}-`);
    case '^=':
      return wanted !== '' && actual.startsWith(wanted);
    case '$=':
      return wanted !== '' && actual.endsWith(wanted);
    default:
      return wanted !== '' && actual.includes(wanted);
  }
}

interface AttributeNode {
  readonly namespaceURI: string | null;
  readonly localName: string;
  readonly value: string;
}

/**
 * The values of an element's attributes of a name, in the namespace asked for. With none written
 * that is the attribute of no namespace, which is what `getAttribute` reads by its name.
 */
function valuesOf(node: EngineNode, namespace: string | null | undefined, name: string): string[] {
  if (namespace === undefined) {
    const value = attributeOf(node, name);
    return value === null ? [] : [value];
  }
  const list = (node as unknown as { attributes?: ArrayLike<AttributeNode> }).attributes;
  const local = namespaceOf(node) === XHTML ? asciiLower(name) : name;
  const out: string[] = [];
  for (const attribute of Array.from(list ?? [])) {
    if (attribute.localName !== local && attribute.localName !== name) continue;
    if (namespace === '*' || attribute.namespaceURI === namespace) out.push(attribute.value);
  }
  return out;
}

function attributeTest(simple: Extract<Simple, { kind: 'attribute' }>): Test {
  const { namespace, name, operator, value, flag } = simple;
  if (operator === undefined) return (node) => valuesOf(node, namespace, name).length > 0;
  const insensitive = (node: EngineNode) =>
    flag === 'i' ||
    (flag === undefined && ANY_CASE.has(asciiLower(name)) && namespaceOf(node) === XHTML);
  const folded = asciiLower(value!);
  return (node) => {
    const values = valuesOf(node, namespace, name);
    if (!values.length) return false;
    const any = insensitive(node);
    const wanted = any ? folded : value!;
    return values.some((each) => valueMatches(any ? asciiLower(each) : each, operator, wanted));
  };
}

function typeTest(simple: Extract<Simple, { kind: 'type' }>): Test {
  const { namespace, name } = simple;
  const folded = asciiLower(name);
  const nameTest: Test =
    name === '*'
      ? always
      : (node) => {
          const local = localNameOf(node);
          return namespaceOf(node) === XHTML ? local === folded : local === name;
        };
  if (namespace === undefined || namespace === '*') return nameTest;
  return (node, context) => namespaceOf(node) === namespace && nameTest(node, context);
}

function simpleTest(simple: Simple): Test {
  switch (simple.kind) {
    case 'type':
      return typeTest(simple);
    case 'id':
      return (node) => {
        const id = node.props['nativeID'];
        return id != null && String(id) === simple.name;
      };
    case 'class':
      return (node) => node.classes?.has(simple.name) === true;
    case 'attribute':
      return attributeTest(simple);
    case 'pseudo-class':
      return pseudoClass(simple.name, simple.argument, compileList);
    default:
      // A pseudo-element is no element of the tree a query walks.
      return never;
  }
}

function compoundTest(compound: Compound): Test {
  const tests = compound.map(simpleTest).filter((test) => test !== always);
  if (tests.length === 1) return tests[0]!;
  return (node, context) => {
    for (const test of tests) if (!test(node, context)) return false;
    return true;
  };
}

/** The element a combinator steps to from `node`, for one with exactly one candidate. */
const STEP: Partial<Record<Combinator, (node: EngineNode) => EngineNode | null>> = {
  '>': parentElement,
  '+': previousElement,
};
const NEXT: Record<'~' | ' ', (node: EngineNode) => EngineNode | null> = {
  '~': previousElement,
  ' ': parentElement,
};

/**
 * A complex selector, its compounds matched right to left. A descendant or a `~` tries each
 * candidate in turn, and keeps trying when the rest of the selector fails from one: the nearest
 * `.b` of `.a > .b .c` may not be the one under an `.a`.
 */
function complexTest(complex: Complex): Test {
  const tests = complex.compounds.map(compoundTest);
  const { combinators, leading } = complex;
  const last = tests.length - 1;
  /** Whether the compounds left of `index` match, `node` having matched the one at `index`. */
  const prefix = (node: EngineNode, index: number, context: MatchContext): boolean => {
    if (index === 0) return leading === undefined || related(node, leading, context.anchor);
    const combinator = combinators[index - 1]!;
    const test = tests[index - 1]!;
    const step = STEP[combinator];
    if (step) {
      const candidate = step(node);
      return !!candidate && test(candidate, context) && prefix(candidate, index - 1, context);
    }
    const next = NEXT[combinator as '~' | ' '];
    for (let at = next(node); at; at = next(at)) {
      if (test(at, context) && prefix(at, index - 1, context)) return true;
    }
    return false;
  };
  const subject = tests[last]!;
  return (node, context) => subject(node, context) && prefix(node, last, context);
}

/** Whether `node` is where a relative selector's leading combinator puts it from `anchor`. */
function related(node: EngineNode, combinator: Combinator, anchor: EngineNode | null): boolean {
  if (!anchor) return false;
  const step = STEP[combinator];
  if (step) return step(node) === anchor;
  const next = NEXT[combinator as '~' | ' '];
  for (let at = next(node); at; at = next(at)) if (at === anchor) return true;
  return false;
}

/** The elements a relative selector's subject may be: beneath the anchor, or after it. */
function* candidates(anchor: EngineNode, leading: Combinator): Generator<EngineNode> {
  if (leading === ' ' || leading === '>') {
    yield* elementsUnder(anchor);
    return;
  }
  for (const sibling of laterElements(anchor)) {
    yield sibling;
    yield* elementsUnder(sibling);
  }
}

/** `:has()`: some element related to the one asked matches one of the relative selectors. */
function hasTest(list: readonly Complex[]): Test {
  const each = list.map((complex) => ({ test: complexTest(complex), leading: complex.leading! }));
  return (node, context) => {
    const inner: MatchContext = { scope: context.scope, anchor: node };
    return each.some(({ test, leading }) => {
      for (const candidate of candidates(node, leading)) if (test(candidate, inner)) return true;
      return false;
    });
  };
}

/** A selector list as one test of an element. */
function compileList(list: readonly Complex[], relative = false): Test {
  if (relative) return hasTest(list);
  const tests = list.map(complexTest);
  if (tests.length === 1) {
    const [only] = tests;
    return (node, context) => isElement(node) && only!(node, context);
  }
  return (node, context) => {
    if (!isElement(node)) return false;
    for (const test of tests) if (test(node, context)) return true;
    return false;
  };
}

/**
 * Selectors read and compiled, by their text. A library asks with the same few over and over,
 * from a focus trap on every key and an overlay on every open. Kept to a bound, and emptied when
 * it is reached, since one made from an id can be asked once and never again.
 */
const compiled = new Map<string, Test>();
const KEPT = 1000;

/** The test a selector string is, or a `SyntaxError` where it is not one. */
export function selectorTest(selector: string): Test {
  let test = compiled.get(selector);
  if (test) return test;
  test = compileList(parseSelectorList(selector));
  if (compiled.size >= KEPT) compiled.clear();
  compiled.set(selector, test);
  return test;
}
