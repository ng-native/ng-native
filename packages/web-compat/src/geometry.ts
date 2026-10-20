import type { Engine, EngineNode } from '@ng-native/fabric';
import { scrollOf } from './scroll-offset.ts';
import { engineOf, windowSize } from './window.ts';
import { documentOf } from './document.ts';
import { DOMRect, DOMRectList } from './dom-rect.ts';

/**
 * Where an element is and how big: `getBoundingClientRect`, the `offset`, `client` and `scroll`
 * members, and scrolling an element. Each is read from where native last laid the element out,
 * with what is pending committed first, as a browser lays a page out before it answers.
 */
type Dom = EngineNode & Record<string, (...args: unknown[]) => unknown>;

const get = (read: (this: Dom) => unknown, write?: (this: Dom, value: unknown) => void) => ({
  get: read,
  set: write,
});
const method = (value: (this: Dom, ...args: never[]) => unknown) => ({ value, writable: true });

/** What a node is styled with for one property: on itself, by a rule, or for its name. */
export const styled = (node: EngineNode, key: string): unknown =>
  // An inline style is under a rule's important declaration, as the engine has it.
  (node.styleCache?.important?.has(key)
    ? undefined
    : (node.props['style'] as Record<string, unknown> | undefined)?.[key]) ??
  node.styleCache?.style[key] ??
  (node.defaultStyle as Record<string, unknown> | undefined)?.[key];

/**
 * Lay the page out as a measurement in a browser does first, with every style written so far:
 * a library resets an overlay's box and measures it in the next statement. Nothing is drawn
 * until the task ends, as in a browser.
 */
export function layOut(engine: Engine): void {
  if (!engine.pending) return;
  engine.commit();
  // And once more as the task ends, for what is written after the answer: an overlay's place
  // is cleared, measured and written again in three statements, and a browser paints the last.
  // Left for the next render, the cleared one is what is drawn until then.
  queueMicrotask(() => engine.commit());
}

/** Whether a node is drawn: in the page, with neither it nor anything it is in `display: none`. */
export function drawn(node: EngineNode): boolean {
  const engine = engineOf(node);
  layOut(engine);
  for (let at: EngineNode | null = node; at; at = at.parent) {
    if (styled(at, 'display') === 'none') return false;
    if (at === engine.root) return true;
  }
  return false;
}

/** The cells a box that is not positioned itself is placed in, as a browser places it. */
const CELLS = new Set(['td', 'th', 'table']);

/**
 * Whether a box with a `position` is placed against `at`: the body, a box that is positioned,
 * or, for one that is not positioned itself, a table cell.
 */
const placesAgainst = (at: EngineNode, position: unknown, body: unknown): boolean =>
  at === body ||
  styled(at, 'position') !== 'static' ||
  (position === 'static' && CELLS.has(at.tag));

/**
 * The box a node is placed in, as `offsetParent` answers: the nearest box above it that is
 * positioned, a table cell where it is not positioned itself, or the body. Nothing for the root
 * or a body, for a box that is fixed to the window, and for one that is not drawn: a library
 * asks whether an element is in sight by it before it measures it.
 *
 * A native view, which has no `position` of its own, is positioned: one is placed against it.
 */
function placedIn(node: EngineNode): EngineNode | null {
  const engine = engineOf(node);
  const body = documentOf(engine)?.body;
  const position = styled(node, 'position');
  const page = node === engine.root || node === body || node.tag === 'body';
  if (page || position === 'fixed' || !drawn(node)) return null;
  for (let at = node.parent; at && at !== engine.root; at = at.parent) {
    if (placesAgainst(at, position, body)) return at;
  }
  // What an app draws is beside the body here, where a browser has the whole page in it.
  return body ?? engine.root;
}

/** How wide an element's border is on one side, where a number says so. */
export function border(node: EngineNode, side: 'Top' | 'Right' | 'Bottom' | 'Left'): number {
  // A table's border is its grid's, inside the box around it and its caption, which has none.
  if (node.tag === 'table') return 0;
  const width = styled(node, `border${side}Width`) ?? styled(node, 'borderWidth');
  return typeof width === 'number' ? width : 0;
}

/** Where native last laid a node out, in the window. Zero for one it has not. */
export function frameOf(node: EngineNode) {
  const engine = engineOf(node);
  // The root is the window: native has no view of its own to measure for it.
  if (node === engine.root) return { x: 0, y: 0, ...windowSize(engine) };
  let frame = { x: 0, y: 0, width: 0, height: 0 };
  layOut(engine);
  // Fabric answers before `measure` returns, so this reads as a DOM measurement does.
  engine.measure(node, (measured) => (frame = measured));
  return frame;
}

/**
 * A node's size as it is laid out, which is what `offsetWidth` and `clientHeight` are: a
 * transform does not change them, where it changes the box an element is drawn in. A library
 * places a panel that scales in under its trigger by the first, and would place it by the
 * nine tenths it is drawn at. Where the host cannot say, the size it is drawn at.
 */
export function sizeOf(node: EngineNode): { width: number; height: number } {
  const drawn = frameOf(node);
  const engine = engineOf(node);
  return (node === engine.root ? undefined : engine.layoutOf(node)) ?? drawn;
}

/** Whether what is in a box is cut off at its edges, which keeps it out of what holds the box. */
const clips = (node: EngineNode): boolean => {
  const overflow = styled(node, 'overflow');
  return node.scrollView === true || (overflow !== undefined && overflow !== 'visible');
};

/** How far right and down the boxes inside a node reach, in the window: none clipped is left out. */
function reach(node: EngineNode, far: { right: number; bottom: number }): void {
  for (const child of node.childList) {
    if (child.nodeKind !== 'element' || styled(child, 'display') === 'none') continue;
    const frame = frameOf(child);
    far.right = Math.max(far.right, frame.x + frame.width);
    far.bottom = Math.max(far.bottom, frame.y + frame.height);
    if (!clips(child)) reach(child, far);
  }
}

/**
 * The extent of what a node holds, which `scrollWidth` and `scrollHeight` are: from its padding
 * edge, as far as its padding box or the furthest box inside it, whichever is further. What
 * reaches before the padding edge is not scrolled to, and so is not counted. Native measures what
 * a scroll view holds where it is drawn, so as far as it is scrolled is added back.
 */
export function contentOf(node: EngineNode) {
  const own = frameOf(node);
  const at = node.scrollView ? scrollOf(node) : { x: 0, y: 0 };
  const left = own.x + border(node, 'Left');
  const top = own.y + border(node, 'Top');
  const far = {
    right: own.x + own.width - border(node, 'Right'),
    bottom: own.y + own.height - border(node, 'Bottom'),
  };
  reach(node, far);
  return {
    width: Math.max(0, far.right - left + at.x),
    height: Math.max(0, far.bottom - top + at.y),
  };
}

/** The box a node is drawn in, as `getBoundingClientRect` answers: none where it is not drawn. */
export function rectOf(node: EngineNode): DOMRect {
  if (!drawn(node)) return new DOMRect();
  const { x, y, width, height } = frameOf(node);
  return new DOMRect(x, y, width, height);
}

/** An element's size inside its border, which is what `clientWidth` and `clientHeight` are. */
export function clientSize(node: EngineNode): { width: number; height: number } {
  if (!drawn(node)) return { width: 0, height: 0 };
  const engine = engineOf(node);
  // The root's is the window's, as far as it is not under a scrollbar: none is, here.
  if (node === engine.root) return windowSize(engine);
  const { width, height } = sizeOf(node);
  return {
    width: Math.max(0, width - border(node, 'Left') - border(node, 'Right')),
    height: Math.max(0, height - border(node, 'Top') - border(node, 'Bottom')),
  };
}

/**
 * How far an element is from the padding edge of the box it is placed in, or from the window, as
 * it is laid out: what each box it is in up to that one has been scrolled by is put back.
 */
function offsetOf(node: EngineNode): { x: number; y: number } {
  const engine = engineOf(node);
  if (!drawn(node) || node === documentOf(engine)?.body) return { x: 0, y: 0 };
  const own = frameOf(node);
  const within = placedIn(node);
  if (!within) return own;
  const from = frameOf(within);
  const offset = {
    x: own.x - from.x - border(within, 'Left'),
    y: own.y - from.y - border(within, 'Top'),
  };
  for (let at = node.parent; at; at = at.parent) {
    if (at.scrollView) {
      const scrolled = scrollOf(at);
      offset.x += scrolled.x;
      offset.y += scrolled.y;
    }
    if (at === within) break;
  }
  return offset;
}

/**
 * How tall a `<textarea>`'s text is, with its padding: what `scrollHeight` is for one, which a
 * library reads to grow the field with what is typed. Native says a field's height and not its
 * text's, so the field is measured once as tall as its text, with no `rows` and no height of its
 * own to hold it, and put back. Nothing is drawn between: the commit after is the one painted.
 */
function textHeight(node: EngineNode): number {
  const engine = engineOf(node);
  const { rows, style } = node.props;
  engine.setProp(node, 'rows', undefined);
  const free = { height: 'auto', minHeight: undefined, maxHeight: undefined };
  engine.setProp(node, 'style', { ...(style as object | undefined), ...free });
  const { height } = frameOf(node);
  engine.setProp(node, 'rows', rows);
  engine.setProp(node, 'style', style);
  return Math.max(height, frameOf(node).height);
}

/**
 * A size or offset as a getter reads it: a whole pixel, as the CSSOM's are. A 1080-pixel Android
 * screen at 2.625 is 411.43 points across, which a browser reads as 411.
 */
const sized = (read: (node: EngineNode) => number) =>
  get(function () {
    return drawn(this) ? Math.round(read(this)) : 0;
  });

export const geometryMembers: PropertyDescriptorMap = {
  getBoundingClientRect: method(function () {
    return rectOf(this);
  }),
  // One box, where an element is drawn.
  // ponytail: an inline element over two lines is in two boxes in a browser, and in the one
  // around both here. Native says where each line of a paragraph is; read them if a library
  // that places something by a line of text is found.
  getClientRects: method(function () {
    return new DOMRectList(drawn(this) ? [rectOf(this)] : []);
  }),
  // What it is placed in: nothing where it is not drawn, which is how a library asks whether
  // an element is in sight before it measures it.
  offsetParent: get(function () {
    return placedIn(this);
  }),
  offsetTop: sized((node) => offsetOf(node).y),
  offsetLeft: sized((node) => offsetOf(node).x),
  offsetWidth: sized((node) => sizeOf(node).width),
  offsetHeight: sized((node) => sizeOf(node).height),
  clientWidth: get(function () {
    return Math.round(clientSize(this).width);
  }),
  clientHeight: get(function () {
    return Math.round(clientSize(this).height);
  }),
  // The width of the border, which is where what it holds starts.
  clientTop: sized((node) => border(node, 'Top')),
  clientLeft: sized((node) => border(node, 'Left')),
  scrollWidth: sized((node) => contentOf(node).width),
  scrollHeight: sized((node) =>
    node.tag === 'textarea' ? textHeight(node) : contentOf(node).height,
  ),
};
