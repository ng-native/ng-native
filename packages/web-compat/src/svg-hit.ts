import type { EngineNode } from '@ng-native/fabric';
import { frameOf } from './geometry.ts';
import { boxOf, moved, type Box } from './svg-box.ts';
import { shapeAttributes } from './svg.ts';
import { listensForTouch } from './svg-touch.ts';

/**
 * The shape of a drawing a finger is on, where native found none: native finds a text by the
 * ink of its letters, and a browser by their boxes, so a tap on a legend item between two
 * letters is the item's in a browser and the drawing's on native. Looked for among what is
 * under `landed`, by the boxes the shapes are drawn in, the last drawn first. `x` and `y` are
 * where the finger is in the window.
 */
export function shapeUnder(landed: EngineNode, x: number, y: number): EngineNode | undefined {
  let root: EngineNode | null = landed;
  while (root && root.tag !== 'svg') root = root.parent;
  if (!root) return undefined;
  const frame = frameOf(root);
  const [vbX = 0, vbY = 0, vbWidth, vbHeight] = (shapeAttributes(root)['viewBox'] ?? '')
    .split(/[\s,]+/)
    .map(Number);
  const scaleX = vbWidth && frame.width ? frame.width / vbWidth : 1;
  const scaleY = vbHeight && frame.height ? frame.height / vbHeight : 1;
  const point = { x: (x - frame.x) / scaleX + vbX, y: (y - frame.y) / scaleY + vbY };
  return under(landed, point, root);
}

/**
 * The last drawn text, rectangle, circle or ellipse under the point in a shape that listens, or
 * in one inside a shape that listens: the shape a browser takes a touch to be on, whose listeners
 * and those of what it is in hear of it. A path is left to native, which finds one by what it
 * draws: a box is no measure of a line.
 */
function under(
  node: EngineNode,
  point: { x: number; y: number },
  root: EngineNode,
  heard = false,
): EngineNode | undefined {
  const attrs = shapeAttributes(node);
  if (attrs['visibility'] === 'hidden' || attrs['display'] === 'none') return undefined;
  const hears = heard || (node !== root && listensForTouch(node));
  for (let i = node.childList.length - 1; i >= 0; i--) {
    const child = node.childList[i]!;
    if (child.nodeKind !== 'element') continue;
    const found = under(child, point, root, hears);
    if (found) return found;
  }
  const boxed = BOXED.has(node.tag) && hears;
  return boxed && contains(inRoot(node, root), point) ? node : undefined;
}

/** The shapes found by their boxes, which are what they draw or near enough. */
const BOXED = new Set(['svg:text', 'rect', 'circle', 'ellipse']);

/** A shape's box in the drawing's own space, through each transform over it. */
function inRoot(node: EngineNode, root: EngineNode): Box {
  let box = moved(boxOf(node), shapeAttributes(node)['transform']);
  for (let up = node.parent; up && up !== root; up = up.parent) {
    box = moved(box, shapeAttributes(up)['transform']);
  }
  return box;
}

const contains = (box: Box, { x, y }: { x: number; y: number }): boolean =>
  box.width > 0 && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
