import type { Engine, EngineNode } from '@ng-native/fabric';
import {
  isHtml,
  liveCollection,
  liveNodeList,
  type HTMLCollection,
  type NodeList,
} from './live-list.ts';

/**
 * `getElementsByTagName` and `getElementsByClassName`, for an element and for a document, and a
 * document's `getElementsByName`: a live list of the elements under it that match. `under` is
 * every node below where the search starts, in the order of the page.
 */

type Under = () => Iterable<EngineNode>;
type Named = EngineNode & {
  readonly localName: string;
  getAttribute(name: string): string | null;
};

function elementsUnder(under: Under, test: (node: Named) => boolean): EngineNode[] {
  const found: EngineNode[] = [];
  for (const node of under()) {
    if (node.nodeKind === 'element' && test(node as Named)) found.push(node);
  }
  return found;
}

/** By name: any for `*`, and one of HTML's by its name in any case. */
export function byTagName(engine: Engine, under: Under, name: unknown): HTMLCollection {
  const wanted = String(name);
  const lower = wanted.toLowerCase();
  return liveCollection(engine, () =>
    elementsUnder(
      under,
      (node) => wanted === '*' || node.localName === (isHtml(node) ? lower : wanted),
    ),
  );
}

/** By classes: those with every one of them, and none at all for no class. */
export function byClassName(engine: Engine, under: Under, names: unknown): HTMLCollection {
  const wanted = String(names)
    .split(/[\t\n\f\r ]+/)
    .filter(Boolean);
  return liveCollection(engine, () =>
    wanted.length
      ? elementsUnder(under, (node) => wanted.every((one) => !!node.classes?.has(one)))
      : [],
  );
}

/** By the `name` attribute, as it is written, of HTML's elements: a list of nodes, not elements. */
export function byName(engine: Engine, under: Under, name: unknown): NodeList {
  const wanted = String(name);
  return liveNodeList(engine, () =>
    elementsUnder(under, (node) => isHtml(node) && node.getAttribute('name') === wanted),
  );
}
