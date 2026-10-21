/**
 * The engine's flow layout, applied to a fixture's styles so Yoga can lay the result out.
 *
 * `planFlow` in `@ng-native/fabric` says what each block container's children are laid out with:
 * collapsed margins, or lines of inline-blocks. This writes that plan back as CSS, and drops the
 * flex properties a block container and its children have no use for, which is what the engine
 * does to a view's props before it commits them.
 */
import { planFlow, type FlowKey, type FlowPlan, type FlowTree } from '@ng-native/fabric';
import type { FixtureNode } from './fixture.ts';

type Style = Record<string, string>;
interface Mutable {
  style: Style;
  classes: readonly string[];
  text: string;
  children: Mutable[];
}

const FLEX_CONTAINER = [
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'row-gap',
  'column-gap',
];
const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A style with `margin`, `padding`, `inset`, `border` and `border-width` spread over their sides. */
function spread(style: Readonly<Style>): Style {
  const out: Style = {};
  for (const [property, value] of Object.entries(style)) {
    if (['margin', 'padding', 'border-width', 'inset'].includes(property)) {
      const [a, b = a, c = a, d = b] = value.split(/\s+/);
      const name = (side: string) =>
        ({ inset: side, 'border-width': `border-${side}-width` })[property] ??
        `${property}-${side}`;
      [a, b, c, d].forEach((side, i) => (out[name(SIDES[i]!)] = side!));
    } else if (property === 'border') {
      const width = value.split(/\s+/).find((word) => /^[\d.]+(px)?$/.test(word));
      if (width) for (const side of SIDES) out[`border-${side}-width`] = width;
    } else {
      out[property] = value;
    }
  }
  return out;
}

function copy(node: FixtureNode): Mutable {
  return { ...node, style: spread(node.style), children: node.children.map(copy) };
}

const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** A fixture's CSS in the terms the plan reads: points as numbers, the rest as written. */
function value(node: Mutable, key: FlowKey): unknown {
  // A float is out of the flow too, and `overflow` on either axis clips.
  if (key === 'position' && (node.style['float'] ?? 'none') !== 'none') return 'absolute';
  if (key === 'overflow') {
    const all = [node.style['overflow'], node.style['overflow-x'], node.style['overflow-y']];
    return all.find((each) => each !== undefined && each !== 'visible');
  }
  const written = node.style[kebab(key)];
  if (written === undefined) return undefined;
  const match = /^(-?[\d.]+)(px)?$/.exec(written);
  return match && (match[2] || Number(match[1]) === 0) ? Number(match[1]) : written;
}

const TREE: FlowTree<Mutable> = {
  children: (node) => node.children.filter((child) => child.style['display'] !== 'none'),
  style: value,
  hasText: (node) => node.text !== '',
};

const inFlow = (node: Mutable) => TREE.style(node, 'position') !== 'absolute';

/** A box in a block container's flow: no flex item properties, and the margins planned for it. */
function lowerItem(child: Mutable, margins: { top: number; bottom: number } | undefined): void {
  for (const property of ['flex-grow', 'flex-shrink', 'flex-basis', 'align-self']) {
    delete child.style[property];
  }
  if (!margins) return;
  child.style['margin-top'] = `${margins.top}px`;
  child.style['margin-bottom'] = `${margins.bottom}px`;
}

/** Write a container's plan on it and its children, then do the same for each child. */
function lower(node: Mutable, inBlock: boolean): void {
  const plan = planFlow(TREE, node, inBlock);
  const flow = TREE.children(node).filter(inFlow);
  if (plan) for (const property of FLEX_CONTAINER) delete node.style[property];
  if (plan?.kind === 'lines') lowerLine(node, flow);
  const block = plan?.kind === 'block';
  if (block) lowerBlock(plan, flow);
  for (const child of node.children) lower(child, block && flow.includes(child));
}

/** A block container's plan on its children: each box's margins, and the margin over a line. */
function lowerBlock(plan: FlowPlan<Mutable>, flow: Mutable[]): void {
  for (const child of flow) lowerItem(child, plan.margins?.get(child));
  for (const [first, line] of plan.lines) aboveLine(first, line);
}

/**
 * A line of one box among blocks: the margin over the line is added to the box's own, as the
 * engine's line box would hold it down. A line of several is left as written.
 */
function aboveLine(first: Mutable, line: { boxes: readonly Mutable[]; top: number }): void {
  const own = TREE.style(first, 'marginTop') ?? 0;
  if (line.boxes.length !== 1 || typeof own !== 'number') return;
  first.style['margin-top'] = `${own + line.top}px`;
}

const VERTICAL_ALIGN: Record<string, string> = { top: 'flex-start', middle: 'center' };
const TEXT_ALIGN: Record<string, string> = { center: 'center', right: 'flex-end', end: 'flex-end' };

/**
 * A block container holding only inline-blocks: its lines are a wrapping flex row, with each box
 * at its own content's width and sitting on the line's bottom, where an empty box's baseline is.
 * The room a browser leaves under the baseline for the font's descenders is not reproduced.
 */
function lowerLine(node: Mutable, boxes: Mutable[]): void {
  node.style['flex-direction'] = 'row';
  node.style['flex-wrap'] = 'wrap';
  node.style['align-items'] = 'flex-end';
  node.style['align-content'] = 'flex-start';
  const justify = TEXT_ALIGN[node.style['text-align'] ?? ''];
  if (justify) node.style['justify-content'] = justify;
  for (const child of boxes) {
    for (const property of ['flex-grow', 'flex-shrink', 'flex-basis']) delete child.style[property];
    const align = VERTICAL_ALIGN[child.style['vertical-align'] ?? ''];
    if (align) child.style['align-self'] = align;
    else delete child.style['align-self'];
  }
}

/** The fixture with every block container laid out as the engine's flow plan says. */
export function lowerBlocks(fixture: FixtureNode): FixtureNode {
  const root = copy(fixture);
  lower(root, false);
  return root;
}
