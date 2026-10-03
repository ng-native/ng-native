import type { EngineNode } from '@ng-native/fabric';
import { propOf } from './attribute.ts';

/** Whether `node` has the attribute a `[name]` or `[name=value]` selector asks for. */
function hasAttribute(node: EngineNode, name: string, value: string | undefined): boolean {
  if (name === 'class') return !!node.classes?.size;
  const prop = node.props[propOf(name)];
  return prop != null && (value === undefined || String(prop) === value);
}

/** One compound selector: `tag.class#id[attr=value]`, no combinators. */
function matchesCompound(node: EngineNode, compound: string): boolean {
  if (node.kind !== 'element') return false;
  const tag = /^[a-z][\w-]*/i.exec(compound)?.[0];
  if (tag && tag.toLowerCase() !== node.name) return false;
  const all = (pattern: RegExp, test: (match: RegExpMatchArray) => boolean) =>
    [...compound.matchAll(pattern)].every(test);
  return (
    all(/\.([\w-]+)/g, ([, name]) => !!node.classes?.has(name!)) &&
    all(/#([\w-]+)/g, ([, id]) => node.props['nativeID'] === id) &&
    all(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g, ([, name, value]) =>
      hasAttribute(node, name!, value),
    )
  );
}

/**
 * Whether `node` matches a selector list of compounds joined by descendant combinators, which is
 * what a library queries with. A child combinator is read as a descendant one.
 *
 * ponytail: no pseudo-classes, sibling combinators or attribute operators but `=`. The engine's
 * own selector matcher is the upgrade once a library needs one.
 */
export function matches(node: EngineNode, selector: string): boolean {
  return selector.split(',').some((one) => {
    const parts = one
      .trim()
      .split(/\s+/)
      .filter((part) => part !== '>');
    if (!matchesCompound(node, parts.at(-1)!)) return false;
    let at = node.parent;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (at && !matchesCompound(at, parts[i]!)) at = at.parent;
      if (!at) return false;
      at = at.parent;
    }
    return true;
  });
}

/** Every node under `node`, in document order. */
export function* descendants(node: EngineNode): Generator<EngineNode> {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}
