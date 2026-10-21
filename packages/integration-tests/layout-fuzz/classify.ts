/**
 * Grouping shrunk cases into classes: what is written in a minimal case, with lengths reduced to
 * their kind (`px`, `%`, `auto`, `fr`), and which of the first differing box's left, top, width
 * and height are off. Two cases shrunk to the same declarations of the same kinds are taken to be
 * one mismatch.
 */
import { boxes, type Case } from './case.ts';
import type { Difference } from './compare.ts';

function kind(value: string): string {
  if (value.startsWith('span')) return value;
  if (/^-\d/.test(value)) return '-px';
  if (/^0(px)?$/.test(value)) return '0';
  if (/^\d+(\.\d+)?px$/.test(value)) return 'px';
  if (/^\d+%$/.test(value)) return '%';
  if (/^\d+$/.test(value)) return value === '0' ? '0' : 'n';
  if (/^\d+fr$/.test(value)) return 'fr';
  // A function of lengths, `calc(% - px)` or `clamp(px, %, px)`, by the kinds of its lengths.
  const fn = /^(calc|min|max|clamp)\((.*)\)$/.exec(value);
  if (fn) return `${fn[1]}(${fn[2]!.replace(/-?[\d.]+(px|%)/g, (_, unit: string) => unit)})`;
  // Track lists and the like: each part by its kind.
  const parts = value.replace(/minmax\([^)]*\)/g, 'minmax').split(/\s+/);
  return parts.length > 1 ? parts.map(kind).join(' ') : parts[0]!;
}

/** What only spaces a box, which a shrunk case often keeps just to make a difference visible. */
const SPACING = /^(margin|padding|border|box-sizing)/;

/**
 * The family a class belongs to: its declarations without the spacing ones, unless spacing is all
 * it has. Classes that differ only in which margin or border made a box visible are one family.
 */
export function family(key: string): string {
  const [declarations, fields] = key.split('  ');
  const parts = declarations!.split('; ');
  const core = parts.filter((part) => !SPACING.test(part) || /: (auto|-px)$/.test(part));
  return `${(core.length ? core : parts).join('; ')}  ${fields}`;
}

export function signature(test: Case, first: Difference): string {
  const declarations = new Set<string>();
  for (const { node } of boxes(test.root)) {
    for (const [property, value] of node.declarations) {
      // Which size a box was given matters less than that it was given one.
      if (['width', 'height'].includes(property) && /px$/.test(value)) continue;
      declarations.add(`${property}: ${kind(value)}`);
    }
    if (node.text !== undefined) declarations.add('text');
  }
  return `${[...declarations].sort().join('; ')}  [${first.fields.join('')}]`;
}
