import type { Engine, EngineNode } from '@ng-native/fabric';
import { frameOf, styled } from './geometry.ts';
import { windowSize } from './window.ts';

/** What a node says of touches: in its style, by a rule, or on itself. */
const touchable = (node: EngineNode): unknown =>
  styled(node, 'pointerEvents') ?? node.props['pointerEvents'];

const inside = (node: EngineNode, x: number, y: number): boolean => {
  const box = frameOf(node);
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
};

/**
 * Each element drawn at a point of the window under `node`, the one drawn over the rest first:
 * the deepest there, and the last of those beside each other. Into `found`, and as far as the
 * first where `first` says so. A node that takes no touches is passed over with what it holds;
 * one that takes none itself, but lets what it holds take them, is passed over alone; one that
 * takes them only itself is looked at without what it holds; and one that is not drawn is passed
 * over with what it holds.
 *
 * ponytail: every element on the way is measured, which is a call to native each. A z-index
 * is read only for the body, which is looked in first.
 */
function collect(node: EngineNode, x: number, y: number, found: EngineNode[], first: boolean) {
  const takes = touchable(node);
  if (node.nodeKind !== 'element' || takes === 'none' || styled(node, 'display') === 'none') return;
  // One that takes touches itself, and none of what it holds, is looked at alone.
  for (let index = takes === 'box-only' ? -1 : node.childList.length - 1; index >= 0; index--) {
    collect(node.childList[index]!, x, y, found, first);
    if (first && found.length) return;
  }
  if (takes !== 'box-none' && node.parent && !found.includes(node) && inside(node, x, y)) {
    found.push(node);
  }
}

/** A point as a browser takes one: two numbers, each finite, or a `TypeError`. */
function pointOf(args: readonly unknown[]): [number, number] {
  if (args.length < 2) {
    throw new TypeError(`2 arguments required, but only ${args.length} present.`);
  }
  const x = Number(args[0]);
  const y = Number(args[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError('The provided double value is non-finite.');
  }
  return [x, y];
}

/** Whether a point is in the window, where the app has been told how big the window is. */
const inWindow = (engine: Engine, x: number, y: number): boolean => {
  const { width, height } = windowSize(engine);
  return x >= 0 && y >= 0 && (!width || x < width) && (!height || y < height);
};

/**
 * `document.elementFromPoint`, which a library asks to know what a finger has moved onto: the
 * element drawn over the rest there, the page where nothing is, and nothing outside the window.
 */
export function elementFromPoint(
  engine: Engine,
  body: EngineNode,
  args: readonly unknown[],
): EngineNode | null {
  const [x, y] = pointOf(args);
  if (!inWindow(engine, x, y)) return null;
  const found: EngineNode[] = [];
  collect(body, x, y, found, true);
  if (!found.length) collect(engine.root, x, y, found, true);
  return found[0] ?? engine.root;
}

/** `document.elementsFromPoint`: every element drawn at a point, the topmost first, the page last. */
export function elementsFromPoint(
  engine: Engine,
  body: EngineNode,
  args: readonly unknown[],
): EngineNode[] {
  const [x, y] = pointOf(args);
  if (!inWindow(engine, x, y)) return [];
  const found: EngineNode[] = [];
  collect(body, x, y, found, false);
  collect(engine.root, x, y, found, false);
  // Under all of it, the body and the page, as a browser lists them: the body is drawn as
  // tall as the window here, where a browser's is as tall as what is in it.
  if (!found.includes(body)) found.push(body);
  return [...found, engine.root];
}
