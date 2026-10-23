import type { EngineNode } from '@ng-native/fabric';
import {
  BLOCK,
  CSSStyleProperties,
  replaceDeclarations,
  type Hooks,
} from './css-style-declaration.ts';
import { SHORTHANDS, ALL_LONGHANDS } from './css-properties.ts';
import { inlineStyle } from './inline-style.ts';
import { settingStyle } from './mutation-observer.ts';
import { noteWritten } from './node-members.ts';
import { styleShape } from './svg-box.ts';
import { engineOf } from './window.ts';

/**
 * `element.style`: the element's inline declarations, which a `style` attribute or a script
 * declared. Each is kept as the CSSOM writes it back, and is set on the view as what it reads (see
 * `inline-style.ts`), so a write is CSS, as a bound style is. The `style` attribute is the
 * block's text once a script has changed it.
 *
 * A template's style binding sets the view's style past this block: where the view's prop is no
 * longer what a declaration set it to, the view's is what is read.
 */

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** A bare number or a length in pixels, as the number a view reads. */
const plain = (value: unknown): unknown =>
  typeof value === 'string' && /^-?[\d.]+(px)?$/.test(value) ? parseFloat(value) : value;

const currentStyle = (node: EngineNode): Record<string, unknown> =>
  (node.props['style'] as Record<string, unknown> | undefined) ?? {};

/** Set a property of the view's style as CSS, or take it away for `null`. */
function apply(node: EngineNode, property: string, written: unknown): void {
  const engine = engineOf(node);
  const value = written === '' || written == null ? null : written;
  if (property.startsWith('--')) return engine.setCustomProperty(node, property, value);
  const key = camel(property);
  // A shape's paint and font are its own, set as the attribute of the name: see `svg-box.ts`.
  if (styleShape(node, key, value, engine)) return;
  const as = inlineStyle(node, key, value);
  const next = { ...currentStyle(node) };
  for (const [name, set] of Object.entries(as ?? { [key]: value })) {
    if (set == null) delete next[name];
    else next[name] = plain(set);
  }
  engine.setProp(node, 'style', next);
}

/**
 * What each element's declarations were given to the engine as: each name the view was set by,
 * and what that left the view's prop of the name at, to tell that a binding changed it after.
 */
const given = new WeakMap<EngineNode, Map<string, unknown>>();
const givenOf = (node: EngineNode): Map<string, unknown> =>
  given.get(node) ?? given.set(node, new Map()).get(node)!;

/** The longhands a shorthand sets, which are read by it too. */
const longhandsOf = (name: string): readonly string[] =>
  name === 'all' ? ALL_LONGHANDS : (SHORTHANDS.get(name)?.longhands ?? []);

/** Give the engine a declaration, and keep what it left the view's props at. */
function give(node: EngineNode, name: string, value: string | null): void {
  apply(node, name, value);
  const set = givenOf(node);
  const now = currentStyle(node);
  for (const each of [name, ...longhandsOf(name)]) {
    if (value === null) set.delete(each);
    else set.set(each, now[camel(each)]);
  }
}

/**
 * What a property reads: its declaration, unless the view's prop has changed since, and then
 * the view's, as it is: `getComputedStyle` reads a number of points from here.
 */
function read(node: EngineNode, name: string, declared: string): string {
  const now = currentStyle(node)[camel(name)];
  const set = given.get(node);
  // What a declaration left the view at is the declaration's, read from the block.
  if (set?.has(name) ? Object.is(set.get(name), now) : declared !== '') return declared;
  return now == null ? '' : String(now);
}

function hooksOf(node: EngineNode): Hooks {
  return {
    parentRule: null,
    // A script's change: the attribute is the block's text after it, and an observer is told.
    change: (run) =>
      settingStyle(node, () => {
        run();
        noteWritten(node, 'style', styleOf(node).cssText);
      }),
    declared(name, value, gone) {
      give(node, name, value);
      for (const longhand of gone) if (longhand !== name) give(node, longhand, null);
    },
    replaced(entries) {
      for (const name of [...(given.get(node)?.keys() ?? [])]) give(node, name, null);
      for (const [name, value] of entries) give(node, name, value);
    },
    read: (name, declared) => read(node, name, declared),
  };
}

/** Each element's `style`, the same object each time it is read. */
const styles = new WeakMap<EngineNode, CSSStyleProperties>();

/** `element.style`, whose properties are also read and written by their camel-cased names. */
export function styleOf(node: EngineNode): CSSStyleProperties {
  let style = styles.get(node);
  if (!style) styles.set(node, (style = new CSSStyleProperties('', hooksOf(node))));
  return style;
}

/** The `style` attribute set or taken away: the block is what it says. */
export const setStyleAttribute = (node: EngineNode, text: string | null): void =>
  replaceDeclarations(styleOf(node), text ?? '');

/** A copy has the declarations too, as `cloneNode` copies the attribute. */
export function copyDeclarations(from: EngineNode, to: EngineNode): void {
  const style = styles.get(from);
  if (!style) return;
  styleOf(to)[BLOCK] = new Map(style[BLOCK]);
  const set = given.get(from);
  if (set) given.set(to, new Map(set));
}
