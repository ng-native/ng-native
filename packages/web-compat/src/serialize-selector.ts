import { serializeIdentifier, serializeString } from './css-value.ts';
import type { Argument, Complex, Compound, Nth, Simple } from './parse-selector.ts';

/**
 * A selector as the CSSOM writes it back (https://drafts.csswg.org/cssom/#serializing-selectors):
 * `selectorText`. `div>p` is `div > p`, `[a=b]` is `[a="b"]`, `:nth-child(1n+0)` is
 * `:nth-child(n)`, and a universal selector that says nothing is left out.
 * A namespace is written by the prefix the sheet's `@namespace` gave it, and the default
 * namespace by none.
 */

/** A sheet's namespaces as a selector is written by: each prefix by namespace, and the default. */
interface Prefixes {
  readonly byNamespace: ReadonlyMap<string, string>;
  readonly default: string | undefined;
}

/**
 * The prefix a name is written with: none for the default namespace, or for any where there is
 * no default, which is what no prefix says then.
 */
function prefix(namespace: string | null | undefined, prefixes: Prefixes): string {
  if (namespace === undefined || namespace === prefixes.default) return '';
  if (namespace === null) return '|';
  if (namespace === '*') return prefixes.default === undefined ? '' : '*|';
  const name = prefixes.byNamespace.get(namespace);
  return name ? `${serializeIdentifier(name)}|` : '';
}

/** `an+b` as its shortest form: `n`, `-n+3`, `2n`, `5`. */
function serializeAnB({ a, b }: Nth): string {
  if (a === 0) return String(b);
  const n = a === 1 ? 'n' : a === -1 ? '-n' : `${a}n`;
  return b === 0 ? n : `${n}${b > 0 ? '+' : ''}${b}`;
}

function serializeArgument(argument: Argument, prefixes: Prefixes): string {
  switch (argument.kind) {
    case 'selectors':
      return (argument.parts ?? argument.list)
        .map((part) => (typeof part === 'string' ? part : serializeComplex(part, prefixes)))
        .join(', ');
    case 'nth': {
      const { of } = argument.nth;
      return serializeAnB(argument.nth) + (of ? ` of ${listOf(of, prefixes)}` : '');
    }
    case 'words':
      return argument.written;
    default:
      return argument.numbers.join(', ');
  }
}

type Kind<K extends Simple['kind']> = Extract<Simple, { kind: K }>;

/** An attribute selector, its value a string and its flag after a space. */
function serializeAttribute(simple: Kind<'attribute'>, prefixes: Prefixes): string {
  // No namespace is an attribute's own: the default is no element's.
  const namespace =
    simple.namespace === '*'
      ? '*|'
      : simple.namespace
        ? `${serializeIdentifier(prefixes.byNamespace.get(simple.namespace) ?? '')}|`
        : '';
  const name = namespace + serializeIdentifier(simple.name);
  if (!simple.operator) return `[${name}]`;
  const flag = simple.flag ? ` ${simple.flag}` : '';
  return `[${name}${simple.operator}${serializeString(simple.value ?? '')}${flag}]`;
}

function serializeType(simple: Kind<'type'>, alone: boolean, prefixes: Prefixes): string {
  const written = prefix(simple.namespace, prefixes);
  if (simple.name !== '*') return written + serializeIdentifier(simple.name);
  // Any element says nothing beside another selector.
  return written || alone ? `${written}*` : '';
}

function serializeSimple(simple: Simple, alone: boolean, prefixes: Prefixes): string {
  switch (simple.kind) {
    case 'type':
      return serializeType(simple, alone, prefixes);
    case 'id':
      return `#${serializeIdentifier(simple.name)}`;
    case 'class':
      return `.${serializeIdentifier(simple.name)}`;
    case 'attribute':
      return serializeAttribute(simple, prefixes);
    case 'pseudo-class':
      return simple.argument
        ? `:${simple.name}(${serializeArgument(simple.argument, prefixes)})`
        : `:${simple.name}`;
    case 'pseudo-element':
      return simple.argument === undefined
        ? `::${serializeIdentifier(simple.name)}`
        : `::${serializeIdentifier(simple.name)}(${simple.argument})`;
  }
}

function serializeCompound(compound: Compound, prefixes: Prefixes): string {
  return compound
    .map((simple) => serializeSimple(simple, compound.length === 1, prefixes))
    .join('');
}

function serializeComplex(complex: Complex, prefixes: Prefixes): string {
  let out = complex.leading && complex.leading !== ' ' ? `${complex.leading} ` : '';
  for (const [at, compound] of complex.compounds.entries()) {
    if (at > 0) {
      const combinator = complex.combinators[at - 1]!;
      out += combinator === ' ' ? ' ' : ` ${combinator} `;
    }
    out += serializeCompound(compound, prefixes);
  }
  return out;
}

const listOf = (list: readonly Complex[], prefixes: Prefixes): string =>
  list.map((complex) => serializeComplex(complex, prefixes)).join(', ');

/**
 * A selector list written back, its selectors joined by a comma and a space, by the namespaces
 * of the sheet it is in.
 */
export function serializeSelectorList(
  list: readonly Complex[],
  namespaces?: ReadonlyMap<string, string>,
): string {
  const byNamespace = new Map<string, string>();
  for (const [name, uri] of namespaces ?? []) if (name) byNamespace.set(uri, name);
  return listOf(list, { byNamespace, default: namespaces?.get('') });
}
