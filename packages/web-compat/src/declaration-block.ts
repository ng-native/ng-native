import { partsOf } from './css-grammar.ts';
import { serializeIdentifier } from './css-value.ts';
import { ALIASES, ALL_LONGHANDS, LONGHANDS, SHORTHANDS, type Shorthand } from './css-properties.ts';
import {
  CSS_WIDE,
  CUSTOM,
  EXPANDERS,
  SYSTEM_FONTS,
  longhandValue,
  shorthandValue,
  type Values,
} from './shorthand-values.ts';

/**
 * A CSS declaration block (https://drafts.csswg.org/cssom/#css-declaration-blocks): the
 * longhands it declares, in order, each with its value and whether it is `!important`. A
 * shorthand is set as its longhands and read back from them, and is written back as the
 * shorthand where every one of them is declared alike.
 *
 * ponytail: the shorthands of sides, of pairs, and of longhands in any order, and `border`,
 * `border-radius`, `flex`, `font`, `list-style`, `background-position` and `all`. The others
 * are each declared as themselves, `background` and `transition` among them.
 */

export interface Declaration {
  readonly value: string;
  readonly important: boolean;
  /** The shorthand and the text it was given, for a longhand whose value waits on a `var()`. */
  readonly from?: { readonly shorthand: string; readonly text: string };
}

export type Block = Map<string, Declaration>;

/** What a block may declare: every property, or a rule's descriptors. */
export interface Vocabulary {
  /** What a name is, by its canonical name: a longhand's grammar, or a shorthand. */
  readonly known: (name: string) => boolean;
  /** A longhand's grammar, `''` for any value. */
  readonly grammar: (name: string) => string;
  /** Whether a declaration may be `!important`, which a keyframe's may not. */
  readonly important?: boolean;
}

const SUBSTITUTED = /\b(var|env|attr|if)\(/i;

/** Every property a style rule or an element's style declares. */
export const PROPERTIES: Vocabulary = {
  known: (name) => name.startsWith('--') || LONGHANDS.has(name) || SHORTHANDS.has(name),
  grammar: (name) => LONGHANDS.get(name) ?? '',
};

/** A property's name as a block keys it: a custom property as written, an older name as the newer. */
export function canonicalName(
  name: string,
  vocabulary: Vocabulary = PROPERTIES,
): string | undefined {
  if (name.startsWith('--')) return /^--./su.test(name) ? name : undefined;
  const lower = name.toLowerCase();
  const named = ALIASES.get(lower) ?? lower;
  return vocabulary.known(named) ? named : undefined;
}

/** A shorthand whose longhands a block sets, rather than declaring the shorthand as itself. */
const expanded = (name: string): Shorthand | undefined => {
  const shorthand = SHORTHANDS.get(name);
  return shorthand && shorthand.kind !== 'opaque' ? shorthand : undefined;
};

const longhandsOf = (name: string): readonly string[] =>
  name === 'all' ? ALL_LONGHANDS : (expanded(name)?.longhands ?? [name]);

/**
 * The longhands a declaration sets, each with its value, or nothing where the value is not one
 * the property takes.
 */
export function expand(name: string, written: string, vocabulary = PROPERTIES): Values | undefined {
  const text = written.trim();
  if (!text) return undefined;
  const keyword = expandKeyword(name, text);
  if (keyword !== null) return keyword;
  const shorthand = expanded(name);
  if (!shorthand) {
    const value = longhandValue(name, text, vocabulary.grammar(name));
    return value === undefined ? undefined : { [name]: value };
  }
  return (
    EXPANDERS[shorthand.kind]?.(name, partsOf(text), shorthand) ?? CUSTOM[name]?.(partsOf(text))
  );
}

/**
 * What a custom property, a CSS-wide keyword and a value to substitute set, each of which any
 * property takes as it is: or `null` for a value that is none of them.
 */
function expandKeyword(name: string, text: string): Values | undefined | null {
  if (name.startsWith('--')) return { [name]: text };
  const longhands = longhandsOf(name);
  if (CSS_WIDE.test(text))
    return Object.fromEntries(longhands.map((each) => [each, text.toLowerCase()]));
  if (SUBSTITUTED.test(text))
    return longhands.length === 1 && longhands[0] === name ? { [name]: text } : undefined;
  return name === 'all' ? undefined : null;
}

/** The shorthands of each longhand, those of most longhands first, as a block is written. */
const SHORTHANDS_OF = new Map<string, string[]>();
for (const [name, shorthand] of SHORTHANDS) {
  // A legacy shorthand of one longhand is read, and never written for it.
  if (shorthand.kind === 'opaque' || name === 'all' || shorthand.longhands.length < 2) continue;
  for (const longhand of shorthand.longhands) {
    const list = SHORTHANDS_OF.get(longhand) ?? SHORTHANDS_OF.set(longhand, []).get(longhand)!;
    list.push(name);
  }
}
for (const list of SHORTHANDS_OF.values()) {
  list.sort((a, b) => SHORTHANDS.get(b)!.longhands.length - SHORTHANDS.get(a)!.longhands.length);
}

/** A shorthand's longhands as a block declares them, or nothing where one is not declared. */
function declaredLonghands(block: Block, name: string): Declaration[] | undefined {
  const declared: Declaration[] = [];
  for (const longhand of longhandsOf(name)) {
    const one = block.get(longhand);
    if (!one) return undefined;
    declared.push(one);
  }
  return declared;
}

/** A property's value as a block declares it: a shorthand's from its longhands. */
export function propertyValue(block: Block, name: string): string {
  if (!expanded(name) && name !== 'all') {
    const one = block.get(name);
    return one?.from ? '' : (one?.value ?? '');
  }
  const declared = declaredLonghands(block, name);
  if (!declared || declared.some((each) => each.important !== declared[0]!.important)) return '';
  return name === 'all' ? allValue(declared) : shorthandValue(name, declared);
}

/** `all`: the one CSS-wide keyword every longhand is declared as, or `''`. */
function allValue(declared: readonly Declaration[]): string {
  const [first] = declared;
  return first &&
    CSS_WIDE.test(first.value) &&
    declared.every((each) => each.value === first.value && !each.from)
    ? first.value
    : '';
}

/** Whether a property is declared `!important`: a shorthand where every longhand is. */
export function isImportant(block: Block, name: string): boolean {
  if (!expanded(name) && name !== 'all') return block.get(name)?.important ?? false;
  const declared = declaredLonghands(block, name);
  return !!declared?.length && declared.every((each) => each.important);
}

/** What a declaration sets: its longhands' declarations, or nothing where its value is no value. */
export function declarationsOf(
  name: string,
  value: string,
  important: boolean,
  vocabulary = PROPERTIES,
): [string, Declaration][] | undefined {
  if (important && vocabulary.important === false) return undefined;
  const text = value.trim();
  // A system font is no value of the longhands, which are what it says once a page is styled.
  const system = name === 'font' && SYSTEM_FONTS.test(text);
  if (
    (system || SUBSTITUTED.test(text)) &&
    !name.startsWith('--') &&
    (expanded(name) || name === 'all')
  ) {
    return longhandsOf(name).map((longhand) => [
      longhand,
      { value: '', important, from: { shorthand: name, text } },
    ]);
  }
  const values = expand(name, value, vocabulary);
  if (!values) return undefined;
  return Object.entries(values).map(([longhand, each]) => [longhand, { value: each, important }]);
}

/**
 * Set what a declaration sets in a block, each longhand where it was or at the end, and answer
 * the longhands it set. Nothing is set for a value that is no value.
 */
export function setIn(block: Block, set: readonly [string, Declaration][]): string[] {
  for (const [longhand, declaration] of set) {
    // After one of its group by the other mapping, it goes to the end, to be what applies.
    if (block.has(longhand) && mappedAfter(block, longhand)) block.delete(longhand);
    block.set(longhand, declaration);
  }
  return set.map(([longhand]) => longhand);
}

/**
 * A longhand's logical property group (https://drafts.csswg.org/css-logical/#logical-property-group),
 * and whether it is the logical or the physical one of it: `margin-top` is physical and
 * `margin-block-start` logical, of the one group of margins.
 */
export function groupOf(name: string): { group: string; logical: boolean } | undefined {
  for (const [pattern, group] of GROUPS) {
    const found = pattern.exec(name);
    if (found) return { group: group(found), logical: /block|inline|start|end/.test(found[0]) };
  }
  return undefined;
}

const SIDE = '(top|right|bottom|left|block-start|block-end|inline-start|inline-end)';
const GROUPS: readonly [RegExp, (found: RegExpExecArray) => string][] = [
  [new RegExp(`^(margin|padding|scroll-margin|scroll-padding)-${SIDE}$`), (found) => found[1]!],
  [new RegExp(`^(?:inset-)?${SIDE}$`), () => 'inset'],
  [new RegExp(`^border-${SIDE}-(width|style|color)$`), (found) => `border-${found[2]}`],
  [
    /^border-(top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end)-radius$/,
    () => 'radius',
  ],
  [/^(min-|max-)?(width|height|inline-size|block-size)$/, (found) => `${found[1] ?? ''}size`],
  [/^(overflow|overscroll-behavior)-(x|y|block|inline)$/, (found) => found[1]!],
  [/^contain-intrinsic-(width|height|inline-size|block-size)$/, () => 'contain-intrinsic'],
];

/** Whether a declaration of a longhand's group by the other mapping comes after it. */
export function mappedAfter(block: Block, longhand: string): boolean {
  const own = groupOf(longhand);
  if (!own) return false;
  let after = false;
  for (const name of block.keys()) {
    if (name === longhand) after = true;
    else if (after && isOtherMapping(own, name)) return true;
  }
  return false;
}

const isOtherMapping = (own: { group: string; logical: boolean }, name: string): boolean => {
  const other = groupOf(name);
  return !!other && other.group === own.group && other.logical !== own.logical;
};

/** Take a property's declarations out of a block, and answer the longhands taken out. */
export function removeFrom(block: Block, name: string): string[] {
  const gone = longhandsOf(name).filter((longhand) => block.delete(longhand));
  return gone;
}

/**
 * A block's text read as a browser reads one: each declaration in turn, a later one of a
 * longhand in the place of an earlier, unless only the earlier is `!important`.
 */
export function parseBlock(
  entries: Iterable<readonly [string, { value: string; important: boolean }]>,
  vocabulary = PROPERTIES,
): Block {
  const block: Block = new Map();
  for (const [written, { value, important }] of entries) {
    const name = canonicalName(written, vocabulary);
    const set = name === undefined ? undefined : declarationsOf(name, value, important, vocabulary);
    for (const [longhand, declaration] of set ?? []) {
      const had = block.get(longhand);
      if (had?.important && !declaration.important) continue;
      block.delete(longhand);
      block.set(longhand, declaration);
    }
  }
  return block;
}

/** A block's text, as `cssText` writes it: a shorthand where its longhands allow. */
export function serializeBlock(block: Block): string {
  const out: string[] = [];
  const done = new Set<string>();
  // `all` where every longhand it sets says the same, written where the first of them is.
  const all = block.size >= ALL_LONGHANDS.length && propertyValue(block, 'all') !== '';
  const order = [...block.keys()];
  const shorthandOf = (name: string): string | undefined =>
    all && ALL_SET.has(name)
      ? 'all'
      : SHORTHANDS_OF.get(name)?.find((each) => shorthandFits(block, each, done, order));
  for (const [name, declaration] of block) {
    if (done.has(name)) continue;
    const shorthand = shorthandOf(name);
    for (const longhand of longhandsOf(shorthand ?? name)) done.add(longhand);
    const value = shorthand === undefined ? declaration.value : propertyValue(block, shorthand);
    // A longhand waiting on a shorthand's `var()` is written as that shorthand, or not at all.
    if (shorthand !== undefined || !declaration.from) {
      const named = shorthand ?? (name.startsWith('--') ? serializeIdentifier(name) : name);
      out.push(`${named}: ${value}${declaration.important ? ' !important' : ''};`);
    }
  }
  return out.join(' ');
}

const ALL_SET = new Set(ALL_LONGHANDS);

/** Whether a shorthand can be written for longhands none of which is written yet. */
function shorthandFits(
  block: Block,
  shorthand: string,
  done: ReadonlySet<string>,
  order: readonly string[],
): boolean {
  const longhands = longhandsOf(shorthand);
  if (longhands.some((longhand) => done.has(longhand))) return false;
  if (propertyValue(block, shorthand) === '') return false;
  // Not where another of their logical group is between them, which writing them as one moves.
  const places = longhands.map((longhand) => order.indexOf(longhand));
  const between = order
    .slice(Math.min(...places), Math.max(...places))
    .filter((name) => !longhands.includes(name));
  const groups = new Set(longhands.map((longhand) => groupOf(longhand)?.group));
  return !between.some((name) => groups.has(groupOf(name)?.group ?? '-'));
}
