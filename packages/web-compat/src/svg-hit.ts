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
  return under(landed, inViewBox(root, x, y), root);
}

/** Place each side's spare room as an alignment's part says: `Min`, `Mid` or `Max`. */
const placed = (spare: number, at: string): number =>
  at === 'Min' ? 0 : at === 'Max' ? spare : spare / 2;

/** A drawing's view box, where it has one with a size. */
function viewBoxOf(attrs: Readonly<Record<string, string>>) {
  const [x = 0, y = 0, width = 0, height = 0] = (attrs['viewBox'] ?? '')
    .split(/[\s,]+/)
    .map(Number);
  return width && height ? { x, y, width, height } : undefined;
}

/** How a drawing fits its view box: `xMidYMid meet` where it says nothing. */
function aspectOf(attrs: Readonly<Record<string, string>>): [align: string, fit: string] {
  const [align = 'xMidYMid', fit = 'meet'] = (attrs['preserveAspectRatio'] ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return [align, fit];
}

/**
 * A point of the window in a drawing's view box. A view box of another shape than the drawing is
 * drawn at one scale and placed as its `preserveAspectRatio` says, as native and a browser draw
 * it; `none` scales each side on its own.
 */
function inViewBox(root: EngineNode, x: number, y: number): { x: number; y: number } {
  const frame = frameOf(root);
  const attrs = shapeAttributes(root);
  const box = viewBoxOf(attrs);
  if (!box || !frame.width || !frame.height) return { x: x - frame.x, y: y - frame.y };
  const [scaleX, scaleY] = [frame.width / box.width, frame.height / box.height];
  const [align, fit] = aspectOf(attrs);
  if (align === 'none')
    return { x: (x - frame.x) / scaleX + box.x, y: (y - frame.y) / scaleY + box.y };
  const scale = (fit === 'slice' ? Math.max : Math.min)(scaleX, scaleY);
  const offsetX = placed(frame.width - box.width * scale, align.slice(1, 4));
  const offsetY = placed(frame.height - box.height * scale, align.slice(5, 8));
  return { x: (x - frame.x - offsetX) / scale + box.x, y: (y - frame.y - offsetY) / scale + box.y };
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
