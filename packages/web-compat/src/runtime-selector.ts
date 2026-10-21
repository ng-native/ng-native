import type {
  AttributeTest,
  ComplexSelector,
  HasTest,
  NthTest,
  RelativeSelector,
  StyleRule,
} from '@ng-native/fabric';
import { parseSelectorList, type Complex, type Simple } from './parse-selector.ts';
import { ANY_CASE } from './match-selector.ts';
import { propOf } from './reflect.ts';

/**
 * A selector of a `<style>` made while the app runs, as the rule the engine matches: what
 * `runtime-style.ts` reads one with. Read as `querySelector` reads it, and each part of it
 * given to the engine as the engine's own sheets have it.
 *
 * `:is()`, `:where()` and `:not()` of compounds are what the build compiles them to, and so is
 * `:has()` of one compound for a descendant or a child. One of more than a compound, and a
 * `:has()` that looks after the element (`:has(+ .a)`), is a selector of the engine's matched
 * from the element, as a rule is.
 *
 * ponytail: no namespace, no `:nth-child(... of S)`, and no pseudo-class the engine does not
 * track, `:hover` among them. A selector with any of those is not read, and its rule is passed
 * over.
 */

type Compound = StyleRule['compounds'][number];
type Combinator = StyleRule['combinators'][number];
type Mutable<T> = { -readonly [K in keyof T]?: T[K] };

export type ReadSelector = Pick<StyleRule, 'compounds' | 'combinators' | 'specificity'>;

const COMBINATORS: Readonly<Record<string, Combinator>> = {
  ' ': 'descendant',
  '>': 'child',
  '+': 'next-sibling',
  '~': 'later-sibling',
};

const OPERATORS: Readonly<Record<string, NonNullable<AttributeTest['operator']>>> = {
  '=': 'equal',
  '~=': 'includes',
  '|=': 'dash-match',
  '^=': 'prefix',
  '$=': 'suffix',
  '*=': 'substring',
};

/** Each plain pseudo-class the engine has, as what it adds to a compound. */
const PLAIN: Readonly<Record<string, Mutable<Compound>>> = {
  'first-child': { nth: [{ a: 0, b: 1 }] },
  'last-child': { nth: [{ a: 0, b: 1, fromEnd: true }] },
  'only-child': {
    nth: [
      { a: 0, b: 1 },
      { a: 0, b: 1, fromEnd: true },
    ],
  },
  'first-of-type': { nth: [{ a: 0, b: 1, ofType: true }] },
  'last-of-type': { nth: [{ a: 0, b: 1, fromEnd: true, ofType: true }] },
  'only-of-type': {
    nth: [
      { a: 0, b: 1, ofType: true },
      { a: 0, b: 1, fromEnd: true, ofType: true },
    ],
  },
  root: { root: true },
  empty: { empty: true },
  focus: { pseudo: ['focus'] },
  active: { pseudo: ['active'] },
};

/** The counting pseudo-classes, each as the end it counts from and what it counts among. */
const COUNTED: Readonly<Record<string, Partial<NthTest>>> = {
  'nth-child': {},
  'nth-last-child': { fromEnd: true },
  'nth-of-type': { ofType: true },
  'nth-last-of-type': { fromEnd: true, ofType: true },
};

/** A compound, and what it weighs, `1_000_000` an id, `1000` a class and `1` a type. */
interface Read {
  readonly compound: Compound;
  readonly weight: number;
}

/** What a compound is built up of, as its parts are read. */
interface Building {
  classes: string[];
  ids: string[];
  attributes: AttributeTest[];
  nth: NthTest[];
  not: Compound[];
  other: Mutable<Compound>;
  weight: number;
  /**
   * Read for `CSS.supports`, which a part of a forgiving list that is no selector fails, as it
   * does in a browser. A sheet's rule keeps the rest of the list, which the part matches none of.
   */
  readonly strict: boolean;
}

/** One attribute test, or nothing for one in a namespace, which the engine does not know. */
function attributeOf(simple: Simple & { kind: 'attribute' }): AttributeTest | undefined {
  // Any namespace is the attribute of the name, which is all the engine knows of one.
  const { namespace } = simple;
  if (namespace !== undefined && namespace !== null && namespace !== '*') return undefined;
  // An id is the prop the engine keeps it as.
  const name = propOf(simple.name.toLowerCase());
  if (!simple.operator) return { name };
  const insensitive = foldsCase(simple, name);
  // The flag folds ASCII letters alone, and the engine folds every letter: `ä` is not `Ä`.
  if (insensitive && cased(simple.value!)) return undefined;
  const value = insensitive ? simple.value!.toLowerCase() : simple.value!;
  return {
    name,
    operator: OPERATORS[simple.operator]!,
    value,
    ...(insensitive ? { insensitive: true } : {}),
  };
}

/**
 * Whether a test compares in any case: by its flag, or as some of HTML's attributes are where
 * no flag says otherwise and no namespace is asked, one in any namespace being another.
 */
const foldsCase = (simple: Simple & { kind: 'attribute' }, name: string): boolean =>
  simple.flag === 'i' ||
  (simple.flag === undefined && simple.namespace !== '*' && ANY_CASE.has(name));

/** Whether a text has a letter outside ASCII that has a case. */
const cased = (text: string): boolean =>
  [...text].some((char) => char.charCodeAt(0) > 0x7f && char.toLowerCase() !== char.toUpperCase());

/** A pseudo-class's part of a compound, or nothing for one the engine has no reading of. */
function pseudoClass(simple: Simple & { kind: 'pseudo-class' }, into: Building): boolean {
  if (counting(simple, into)) return true;
  const argument = simple.argument;
  if (argument?.kind !== 'selectors') return false;
  if (simple.name === 'not') return notOf(argument.list, into);
  if (simple.name === 'has') return hasOf(argument.list, into);
  if (simple.name !== 'is' && simple.name !== 'where') return false;
  // What a forgiving list could not read matches nothing.
  if (into.strict && argument.parts?.some((part) => typeof part === 'string')) return false;
  return isOf(argument.list, into, simple.name === 'where');
}

/** A plain pseudo-class the engine has, or one that counts, into a compound: or false. */
function counting(simple: Simple & { kind: 'pseudo-class' }, into: Building): boolean {
  const plain = PLAIN[simple.name];
  if (plain && !simple.argument) {
    const { nth, pseudo, ...rest } = plain;
    into.nth.push(...(nth ?? []));
    if (pseudo) into.other.pseudo = [...(into.other.pseudo ?? []), ...pseudo];
    Object.assign(into.other, rest);
    into.weight += 1000;
    return true;
  }
  const counted = COUNTED[simple.name];
  if (!counted || simple.argument?.kind !== 'nth' || simple.argument.nth.of) return false;
  const { a, b } = simple.argument.nth;
  into.nth.push({ a, b, ...counted });
  into.weight += 1000;
  return true;
}

/** A selector inside `:is()`, `:where()`, `:not()` or `:has()`, and what it weighs. */
interface Nested {
  readonly compounds: Compound[];
  readonly combinators: Combinator[];
  readonly weight: number;
}

/**
 * Each selector of a list as the engine has one, its leading combinator first where it is a
 * `:has()` argument: or nothing where one is not read.
 */
function nestedOf(list: readonly Complex[], strict: boolean): Nested[] | undefined {
  const all: Nested[] = [];
  for (const complex of list) {
    const read = complex.compounds.map((compound) => compoundOf(compound, strict));
    if (read.includes(undefined)) return undefined;
    const compounds = read as Read[];
    const joined = complex.combinators.map((each) => COMBINATORS[each]!);
    all.push({
      compounds: compounds.map((one) => one.compound),
      combinators: complex.leading ? [COMBINATORS[complex.leading]!, ...joined] : joined,
      weight: compounds.reduce((sum, one) => sum + one.weight, 0),
    });
  }
  return all;
}

/** As specific as the most specific of a list, taken whole: `:is(.a, #b)` is as `#b`. */
const heaviest = (list: readonly Nested[]): number => Math.max(0, ...list.map((one) => one.weight));

const isUniversal = (compound: Compound): boolean =>
  Object.keys(compound).length === 1 && compound.classes.length === 0;

/**
 * `:is()` and `:where()`: of compounds, each the node may match; `<compound> *` and
 * `<compound> > *`, an ancestor and a parent test, as the build compiles them; and anything
 * else, a selector the node is the last element of. `:where()` weighs nothing.
 */
function isOf(list: readonly Complex[], into: Building, where: boolean): boolean {
  const read = nestedOf(list, into.strict);
  if (!read) return false;
  if (!where) into.weight += heaviest(read);
  const above = aboveOf(read);
  if (above) {
    const key = above.child ? 'parents' : 'ancestors';
    into.other[key] = [...(into.other[key] ?? []), above.compound];
  } else if (read.every((one) => one.compounds.length === 1)) {
    into.other.is = [...(into.other.is ?? []), read.map((one) => one.compounds[0]!)];
  } else {
    into.other.isComplex = [...(into.other.isComplex ?? []), read.map(complexOfNested)];
    // `isComplex` is read only where `is` is set, as the compiler's output has it.
    into.other.is ??= [];
  }
  return true;
}

/** `<compound> *` or `<compound> > *` alone in a list, as the compound the node is under. */
function aboveOf(read: readonly Nested[]): { compound: Compound; child: boolean } | undefined {
  const [only] = read;
  if (read.length !== 1 || only!.compounds.length !== 2) return undefined;
  const [compound, last] = only!.compounds as [Compound, Compound];
  const joined = only!.combinators[0];
  if (!isUniversal(last) || (joined !== 'descendant' && joined !== 'child')) return undefined;
  return { compound, child: joined === 'child' };
}

const complexOfNested = ({ compounds, combinators }: Nested): ComplexSelector => ({
  compounds,
  combinators,
});

/** `:not()`: of compounds as the build compiles it, and of more as selectors none may end at. */
function notOf(list: readonly Complex[], into: Building): boolean {
  const read = nestedOf(list, into.strict);
  if (!read?.length) return false;
  for (const one of read) {
    if (one.compounds.length === 1) into.not.push(one.compounds[0]!);
    else into.other.notComplex = [...(into.other.notComplex ?? []), complexOfNested(one)];
  }
  into.weight += heaviest(read);
  return true;
}

/**
 * `:has()`: of compounds all for a descendant, or all for a child, as the build compiles it, and
 * otherwise each a selector from the node, `:has(+ .a)`, `:has(.a > .b)`.
 */
function hasOf(list: readonly Complex[], into: Building): boolean {
  const read = nestedOf(list, into.strict);
  if (!read?.length) return false;
  into.weight += heaviest(read);
  const leading = new Set(read.map((one) => one.combinators[0]));
  const single = read.every((one) => one.compounds.length === 1);
  const any = read.map((one) => one.compounds[0]!);
  let test: HasTest;
  if (single && leading.size === 1 && leading.has('descendant')) test = { any };
  else if (single && leading.size === 1 && leading.has('child')) test = { child: true, any };
  else test = { any: [], relative: read.map(complexOfNested) as RelativeSelector[] };
  into.other.has = [...(into.other.has ?? []), test];
  return true;
}

/** One simple selector into a compound, or false for one the engine has no reading of. */
function addSimple(simple: Simple, into: Building): boolean {
  switch (simple.kind) {
    case 'type':
      if (simple.namespace !== undefined && simple.namespace !== '*') return false;
      if (simple.name !== '*') {
        into.other.type = simple.name.toLowerCase();
        into.weight += 1;
      }
      return true;
    case 'id':
      into.ids.push(simple.name);
      into.weight += 1_000_000;
      return true;
    case 'class':
      into.classes.push(simple.name);
      into.weight += 1000;
      return true;
    case 'attribute': {
      const test = attributeOf(simple);
      if (test) into.attributes.push(test);
      into.weight += 1000;
      return !!test;
    }
    case 'pseudo-class':
      return pseudoClass(simple, into);
    default:
      return false;
  }
}

/** A compound as the engine has one, or nothing for one it has no reading of. */
function compoundOf(simples: readonly Simple[], strict = false): Read | undefined {
  const into: Building = {
    classes: [],
    ids: [],
    attributes: [],
    nth: [],
    not: [],
    other: {},
    weight: 0,
    strict,
  };
  if (!simples.every((simple) => addSimple(simple, into))) return undefined;
  // Two ids are one element's only where they are the same.
  if (new Set(into.ids).size > 1) return undefined;
  const compound: Mutable<Compound> = { classes: into.classes, ...into.other };
  if (into.ids[0] !== undefined) compound.id = into.ids[0];
  if (into.attributes.length) compound.attributes = into.attributes;
  if (into.nth.length) compound.nth = into.nth;
  // `notComplex` is read only where `not` is set.
  if (into.not.length || compound.notComplex) compound.not = into.not;
  return { compound: compound as Compound, weight: into.weight };
}

/** The boxes a rule can generate, `::before` and `::after`, each a child the engine draws. */
const GENERATED = new Set(['before', 'after']);

/**
 * A selector's compounds, a `::before` or `::after` at its end as the generated box it is: a
 * child of the element, as the engine has one. Nothing for any other pseudo-element.
 */
function boxesOf(
  complex: Complex,
): { compounds: (readonly Simple[])[]; generated?: string } | undefined {
  const compounds = [...complex.compounds];
  const last = compounds.at(-1)!;
  const element = last.findIndex((simple) => simple.kind === 'pseudo-element');
  if (element < 0) return { compounds };
  const simple = last[element]!;
  if (
    element !== last.length - 1 ||
    simple.kind !== 'pseudo-element' ||
    !GENERATED.has(simple.name)
  ) {
    return undefined;
  }
  compounds[compounds.length - 1] = last.slice(0, element);
  return { compounds, generated: `::${simple.name}` };
}

function complexOf(complex: Complex, strict: boolean): ReadSelector | undefined {
  const boxes = complex.leading ? undefined : boxesOf(complex);
  const read = boxes?.compounds.map((compound) => compoundOf(compound, strict));
  if (!read || read.includes(undefined)) return undefined;
  const all = read as Read[];
  const combinators = complex.combinators.map((each) => COMBINATORS[each]!);
  // The box weighs as a type does.
  if (boxes!.generated) all.push({ compound: { classes: [], type: boxes!.generated }, weight: 1 });
  if (boxes!.generated) combinators.push('child');
  return {
    compounds: all.map((each) => each.compound),
    combinators,
    specificity: all.reduce((sum, each) => sum + each.weight, 0),
  };
}

/**
 * A selector list as the rules the engine matches, one a selector, each nothing where it is
 * not read: or nothing at all where the list is no selector, as a browser drops its rule.
 */
export function readSelectors(
  text: string,
  strict = false,
): (ReadSelector | undefined)[] | undefined {
  try {
    return parseSelectorList(text).map((complex) => complexOf(complex, strict));
  } catch {
    return undefined;
  }
}

/**
 * A selector list's rules, or nothing where it is no selector or has one that is not read: what
 * `CSS.supports` asks, which a part of an `:is()` that is no selector fails too.
 */
export function readSelectorList(text: string): ReadSelector[] | undefined {
  const read = readSelectors(text, true);
  return read && !read.includes(undefined) ? (read as ReadSelector[]) : undefined;
}

/** The compounds nested in one: in its `:is()`, `:not()` and `:has()`, and those it is in. */
const innerCompounds = (compound: Compound): Compound[] => [
  ...(compound.not ?? []),
  ...(compound.is ?? []).flat(),
  ...(compound.ancestors ?? []),
  ...(compound.parents ?? []),
  ...innerSelectors(compound).flatMap((selector) => selector.compounds),
  ...(compound.has ?? []).flatMap((test) => [
    ...test.any,
    ...(test.relative ?? []).flatMap((relative) => relative.compounds),
  ]),
];

/** The selectors of more than a compound in a compound's `:is()` and `:not()`. */
const innerSelectors = (compound: Compound): ComplexSelector[] => [
  ...(compound.isComplex ?? []).flat(),
  ...(compound.notComplex ?? []),
];

const isSibling = (each: Combinator): boolean =>
  each === 'next-sibling' || each === 'later-sibling';

/**
 * Whether a compound, or one nested in it, asks about the node's place among its siblings, or
 * about an element before it, `:is(.a + .b)`.
 */
const asksAboutPosition = (compound: Compound): boolean =>
  compound.nth !== undefined ||
  compound.empty !== undefined ||
  innerSelectors(compound).some((selector) => selector.combinators.some(isSibling)) ||
  innerCompounds(compound).some(asksAboutPosition);

/** Whether a rule asks about siblings, which the engine is told of a sheet to watch for. */
export const asksAboutSiblings = (rule: ReadSelector): boolean =>
  rule.combinators.some(isSibling) || rule.compounds.some(asksAboutPosition);

const usesHas = (compound: Compound): boolean =>
  compound.has !== undefined || innerCompounds(compound).some(usesHas);

/** Whether a rule uses `:has()`, which the engine is told of a sheet to match ancestors again. */
export const asksAboutHas = (rule: ReadSelector): boolean => rule.compounds.some(usesHas);
