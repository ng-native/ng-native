/**
 * Block layout, as what a flex column has to be told to lay boxes out the same way.
 *
 * Yoga has no block layout, and a block container's in-flow children already sit where a flex
 * column puts them: one under the other, each as wide as the container. What differs is settled
 * from the tree and its styles, before layout, and comes back as a plan for the container:
 *
 * - Adjoining vertical margins collapse (CSS 2.2, 8.3.1): between siblings, between a box and its
 *   first and last child, and through an empty box. Yoga adds margins, so each collapsed margin
 *   is given to one box and the others get none.
 * - A block container holding only inline-blocks lays them out in lines: a wrapping row. Among
 *   blocks, each run of them is a line box of its own, one box alone included, which the engine
 *   commits a view for: the line is at least as tall as its strut, which a box alone has too.
 *
 * Only margins in points collapse. A percentage margin is of the containing block's width, which
 * nothing knows before layout, so a container holding one keeps every margin as written.
 *
 * This reads a tree it does not own, through `FlowTree`, so the engine's nodes and a test's
 * fixtures are planned by the same code.
 */

/** The styles the plan is made from, as React Native names them. */
export type FlowKey =
  | 'display'
  | 'position'
  | 'marginTop'
  | 'marginBottom'
  | 'paddingTop'
  | 'paddingBottom'
  | 'borderTopWidth'
  | 'borderBottomWidth'
  | 'height'
  | 'minHeight'
  | 'overflow'
  | 'aspectRatio';

export interface FlowTree<T> {
  /** The boxes a node holds, in order, without any that is `display: none`. */
  children(node: T): readonly T[];
  /** A style of the node: a number of points, a keyword, a percentage, or nothing. */
  style(node: T, key: FlowKey): unknown;
  /** Whether the node holds text of its own, which keeps its edges apart. */
  hasText(node: T): boolean;
  /** Whether the node is a run of text, which has no style and sits in a line as a word does. */
  isText?(node: T): boolean;
}

export interface FlowPlan<T> {
  /** A column of blocks, or lines of inline-blocks. */
  kind: 'block' | 'lines';
  /** The margins each in-flow child is laid out with, or nothing where they stay as written. */
  margins: Map<T, { top: number; bottom: number }> | null;
  /**
   * The in-flow children that sit in a line among blocks: an inline-block, inline-flex or
   * inline-grid box. Each is as wide as its content, and its margins do not collapse.
   */
  inline: ReadonlySet<T>;
  /**
   * Each run of those with nothing but each other between them, by its first box, one box alone
   * a run too: they share a line box, which sits under the margin the blocks before it collapse
   * to.
   */
  lines: ReadonlyMap<T, FlowLine<T>>;
}

export interface FlowLine<T> {
  boxes: readonly T[];
  /** The margin over the line box. Its boxes keep their own margins inside it. */
  top: number;
}

/** A set of adjoining margins: the largest positive and the most negative, which add. */
interface Margins {
  positive: number;
  negative: number;
}
const NONE: Margins = { positive: 0, negative: 0 };
const join = (a: Margins, b: Margins): Margins => ({
  positive: Math.max(a.positive, b.positive),
  negative: Math.min(a.negative, b.negative),
});
const sum = (margins: Margins): number => margins.positive + margins.negative;
const only = (value: number): Margins =>
  value >= 0 ? { positive: value, negative: 0 } : { positive: 0, negative: value };

/** What a box's margins come to once its children's have collapsed into them. */
interface Collapsed {
  top: Margins;
  bottom: Margins;
  /** An empty box: its top and bottom margins adjoin, and collapse as one. */
  through: boolean;
}

const BLOCK_CONTAINERS = new Set(['block', 'flow-root', 'inline-block']);
const INLINE_LEVEL = new Set(['inline-block', 'inline-flex', 'inline-grid']);
const inlineLevel = <T>(tree: FlowTree<T>, node: T) =>
  INLINE_LEVEL.has(tree.style(node, 'display') as string);

/** Whether a `display` lays its children out as blocks. */
export const isBlockContainer = (display: unknown): boolean =>
  BLOCK_CONTAINERS.has(display as string);

/** A margin in points: `auto` is none on this axis, and a percentage is not known yet. */
function points(value: unknown): number | undefined {
  if (value === undefined || value === null || value === 'auto') return 0;
  return typeof value === 'number' ? value : undefined;
}
const isZero = (value: unknown) => points(value) === 0;

function inFlow<T>(tree: FlowTree<T>, node: T): boolean {
  return tree.style(node, 'position') !== 'absolute';
}

function ownMargins<T>(tree: FlowTree<T>, node: T): Collapsed {
  return {
    top: only(points(tree.style(node, 'marginTop')) ?? 0),
    bottom: only(points(tree.style(node, 'marginBottom')) ?? 0),
    through: false,
  };
}

/**
 * Which of a block container's edges its children's margins pass through: one with no padding
 * or border, on a box that does not start a formatting context of its own.
 */
function openEdges<T>(tree: FlowTree<T>, node: T, inBlock: boolean) {
  const style = (key: FlowKey) => tree.style(node, key);
  const open = inBlock && style('display') === 'block' && !startsContext(tree, node);
  const clear = (padding: FlowKey, border: FlowKey) =>
    isZero(style(padding)) && isZero(style(border));
  const height = style('height');
  return {
    top: open && clear('paddingTop', 'borderTopWidth'),
    bottom:
      open &&
      (height == null || height === 'auto') &&
      isZero(style('minHeight')) &&
      clear('paddingBottom', 'borderBottomWidth'),
    emptyHeight: isZero(height),
  };
}

/** A box that clips, or keeps a proportion, lays its content out apart from what is around it. */
function startsContext<T>(tree: FlowTree<T>, node: T): boolean {
  return (
    (tree.style(node, 'overflow') ?? 'visible') !== 'visible' ||
    tree.style(node, 'aspectRatio') != null
  );
}

/** The runs of inline-level boxes among a container's in-flow children, one box a run too. */
function runsOf<T>(tree: FlowTree<T>, flow: readonly T[]): Map<T, T[]> {
  const runs = new Map<T, T[]>();
  let run: T[] = [];
  for (const child of [...flow, undefined]) {
    if (child !== undefined && inlineLevel(tree, child)) {
      run.push(child);
      continue;
    }
    if (run.length) runs.set(run[0]!, run);
    run = [];
  }
  return runs;
}

/** The margins between a container's in-flow children, and what is left at its edges. */
function collapseChildren<T>(tree: FlowTree<T>, flow: readonly T[], openTop: boolean) {
  const margins = new Map<T, { top: number; bottom: number }>();
  const runs = runsOf(tree, flow);
  const lines = new Map<T, FlowLine<T>>();
  let atTop = openTop;
  let top = NONE;
  let pending = NONE;
  let emitted = 0;
  let last: T | undefined;
  let lineLast = false;
  for (const child of flow) {
    if (inlineLevel(tree, child)) {
      // The boxes after the first of a line are in it already.
      if (!runs.has(child)) continue;
      // A line: the margins before it end here, and its boxes keep their own inside it.
      if (atTop) top = pending;
      lines.set(child, { boxes: runs.get(child)!, top: sum(pending) - emitted });
      [atTop, pending, emitted, last, lineLast] = [false, NONE, 0, child, true];
      continue;
    }
    lineLast = false;
    const shown = analyse(tree, child, true).own;
    pending = join(pending, shown.top);
    margins.set(child, { top: atTop ? 0 : sum(pending) - emitted, bottom: 0 });
    if (!atTop) emitted = sum(pending);
    if (shown.through) {
      pending = join(pending, shown.bottom);
      continue;
    }
    if (atTop) top = pending;
    atTop = false;
    pending = shown.bottom;
    emitted = 0;
    last = child;
  }
  // A line at the end keeps its own bottom margin: nothing after it is left to add.
  const edges = { atTop, top, pending, emitted, last: lineLast ? undefined : last, lineLast };
  return { margins, lines, ...edges };
}

/** A block container's plan, and its own margins with its children's collapsed into them. */
function collapseBlock<T>(tree: FlowTree<T>, node: T, flow: readonly T[], inBlock: boolean) {
  const own = ownMargins(tree, node);
  const open = openEdges(tree, node, inBlock);
  const { margins, lines, atTop, top, pending, emitted, last, lineLast } = collapseChildren(
    tree,
    flow,
    open.top,
  );
  own.top = join(own.top, top);
  if (lineLast) {
    // Nothing collapses through a line: the container's own bottom margin stands.
  } else if (atTop && (open.top || !last)) {
    // Nothing in it holds its top edge away from what follows.
    own.top = join(own.top, pending);
    own.through = open.top && open.bottom && !tree.hasText(node) && open.emptyHeight;
  } else if (open.bottom) {
    own.bottom = join(own.bottom, pending);
  } else if (last) {
    // ponytail: where the last thing with a bottom edge is a line of several boxes, with an
    // empty block after it, that block's margin is dropped: a line has no margin of its own to
    // carry it. Give a line a bottom if a gap is seen missing under one.
    const edge = margins.get(last);
    if (edge) edge.bottom = sum(pending) - emitted;
  }
  const inline = new Set(flow.filter((child) => inlineLevel(tree, child)));
  return { own, plan: { kind: 'block', margins, inline, lines } as FlowPlan<T> };
}

/** What a node shows its siblings, and how it lays its own children out if it is a block. */
function analyse<T>(
  tree: FlowTree<T>,
  node: T,
  inBlock: boolean,
): { own: Collapsed; plan: FlowPlan<T> | null } {
  if (!isBlockContainer(tree.style(node, 'display'))) {
    return { own: ownMargins(tree, node), plan: null };
  }
  const flow = tree.children(node).filter((child) => inFlow(tree, child));
  const none: ReadonlySet<T> = new Set();
  // Text beside inline-level boxes is on their line, as words are: with no block among them,
  // the container is lines of both. Text alone, or among blocks, is a block of its own.
  const inLine = (child: T) => inlineLevel(tree, child) || tree.isText?.(child) === true;
  if (flow.some((child) => inlineLevel(tree, child)) && flow.every(inLine)) {
    const plan: FlowPlan<T> = { kind: 'lines', margins: null, inline: none, lines: new Map() };
    return { own: ownMargins(tree, node), plan };
  }
  const known = (child: T, key: FlowKey) => points(tree.style(child, key)) !== undefined;
  if (!flow.every((child) => known(child, 'marginTop') && known(child, 'marginBottom'))) {
    const inline = new Set(flow.filter((child) => inlineLevel(tree, child)));
    // Margins stay as written, so a line box has none over it.
    const lines = new Map(
      [...runsOf(tree, flow)].map(([first, boxes]) => [first, { boxes, top: 0 }]),
    );
    return { own: ownMargins(tree, node), plan: { kind: 'block', margins: null, inline, lines } };
  }
  return collapseBlock(tree, node, flow, inBlock);
}

/** The margin keys across a box's width, and down its height, in any form React Native reads. */
const ACROSS = ['marginLeft', 'marginRight', 'marginStart', 'marginEnd', 'marginHorizontal'];
const DOWN = ['marginTop', 'marginBottom', 'marginVertical'];

/** Where a `justify-self` puts a block in its container, as a flex column's item is aligned. */
const JUSTIFIED: Readonly<Record<string, string>> = {
  start: 'flex-start',
  'flex-start': 'flex-start',
  'self-start': 'flex-start',
  left: 'flex-start',
  center: 'center',
  end: 'flex-end',
  'flex-end': 'flex-end',
  'self-end': 'flex-end',
  right: 'flex-end',
};

const isSet = (value: unknown) => value != null && value !== 'auto';
const autoToZero = (props: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) if (props[key] === 'auto') props[key] = 0;
};

/**
 * A block with no width and a `max-width`, centred or pushed by its `auto` margins: it fills its
 * container up to the cap (CSS 2.2, 10.4), where Yoga keeps a box with an `auto` margin at the
 * width of its content. So it is given the whole width, which the cap holds it under, and keeps
 * its `auto` margins. Whether it has a cap is the answer.
 *
 * ponytail: the whole width is the container's, where a browser takes the block's margins of a
 * length off it first, so a block in a container narrower than its cap and those margins is as
 * wide as the container. Of a content box it is the width inside the padding, and that would
 * overflow by the padding there, so a content box with padding or a border across it is left at
 * the width of its content. Give it a width read back from layout if one is seen.
 */
function fillUnderCap(props: Record<string, unknown>): boolean {
  if (props['maxWidth'] == null || props['maxWidth'] === 'none') return false;
  const across = [...ACROSS, 'margin'].map((key) => props[key]);
  if (!across.includes('auto')) return false;
  if (props['boxSizing'] !== 'content-box' || !EDGES_ACROSS.some((key) => props[key])) {
    props['width'] = '100%';
  }
  return true;
}
const EDGES_ACROSS = [
  ...['paddingLeft', 'paddingRight', 'paddingStart', 'paddingEnd', 'paddingHorizontal'],
  ...['padding', 'borderLeftWidth', 'borderRightWidth', 'borderStartWidth', 'borderEndWidth'],
  'borderWidth',
];

/**
 * A box in a block's flow, as a flex column's item: its `auto` margins and its `justify-self`,
 * on the props React Native is given. Yoga gives an `auto` margin the room left over, on either
 * axis, which stops the box stretching.
 *
 * A block's `auto` margins down its height are none, and across its width they are none where
 * the width is `auto` too, since the block fills its container (CSS 2.2, 10.3.3): they centre or
 * push a block whose width is set, `fit-content` (`fitted`) or held under a `max-width`. A
 * `justify-self` puts a block where it says, at the width of its content where it has none of
 * its own, and leaves it to any `auto` margin it has. An inline-block's `auto` margins are none
 * (10.3.9), and `justify-self` is nothing to it.
 */
export function placeInFlow(
  props: Record<string, unknown>,
  inLine: boolean,
  fitted: boolean,
): void {
  autoToZero(props, DOWN);
  const justify = inLine
    ? undefined
    : JUSTIFIED[String(props['justifySelf']).replace(/^safe /, '')];
  if (justify) props['alignSelf'] = justify;
  const sized = !inLine && (fitted || justify !== undefined || isSet(props['width']));
  if (sized || (!inLine && fillUnderCap(props))) {
    // Down its height only: one written for every side is still there across its width.
    if (props['margin'] === 'auto') {
      props['marginHorizontal'] ??= 'auto';
      props['margin'] = 0;
    }
    return;
  }
  autoToZero(props, [...ACROSS, 'margin']);
}

/**
 * How a block container lays its children out, or nothing for any other box. `inBlock` is
 * whether the container is itself an in-flow child of a block container, which is what lets its
 * children's margins pass through its edges.
 */
export function planFlow<T>(tree: FlowTree<T>, container: T, inBlock: boolean): FlowPlan<T> | null {
  return analyse(tree, container, inBlock).plan;
}
