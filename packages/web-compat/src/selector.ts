import type { EngineNode } from '@ng-native/fabric';
import { elementsUnder } from './element-tree.ts';
import { selectorTest } from './match-selector.ts';

/**
 * `matches`, `closest`, `querySelector` and `querySelectorAll`, over a selector read as Selectors
 * Level 4 has it: see `parse-selector.ts` and `match-selector.ts`. One that cannot be read throws
 * a `SyntaxError`, before any element is looked at.
 *
 * Not the engine's own matcher, which styles: that one is given the selectors of its sheets, has
 * no pseudo-class it does not track, and reads props where a script reads attributes. A query is
 * asked of the DOM a library sees.
 */

/** Whether `node` matches a selector, `:scope` being `scope`: the element itself, by default. */
export function matches(node: EngineNode, selector: unknown, scope: EngineNode = node): boolean {
  return selectorTest(String(selector))(node, { scope, anchor: null });
}

/** The nearest of `node` and the elements above it to match a selector, or nothing. */
export function closest(node: EngineNode, selector: unknown): EngineNode | null {
  const test = selectorTest(String(selector));
  const context = { scope: node, anchor: null };
  for (let at: EngineNode | null = node; at; at = at.parent) if (test(at, context)) return at;
  return null;
}

/**
 * The elements of `nodes` that match a selector, `:scope` being `scope`: the first only, where
 * `first` is asked. The selector is read before any is looked at, so one that cannot be read
 * throws where there are none.
 */
export function query(
  nodes: Iterable<EngineNode>,
  selector: unknown,
  scope: EngineNode | null,
  first: boolean,
): EngineNode[] {
  const test = selectorTest(String(selector));
  const context = { scope, anchor: null };
  const found: EngineNode[] = [];
  for (const node of nodes) {
    if (!test(node, context)) continue;
    found.push(node);
    if (first) break;
  }
  return found;
}

/** The elements under `node` that match a selector, in document order. */
export const queryUnder = (node: EngineNode, selector: unknown, first: boolean): EngineNode[] =>
  query(elementsUnder(node), selector, node, first);
