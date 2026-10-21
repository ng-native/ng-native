/**
 * What a style rewrite cannot settle before layout, settled after one: the engine commits, reads
 * each box back from Fabric in the same task, corrects the styles and commits again, and only
 * the second commit reaches the screen.
 *
 * Here the first layout is Yoga's, the read-back is its computed boxes, and the corrections are
 * written on the fixture's styles for a second layout:
 *
 * - An out-of-flow box with `auto` margins between two insets takes the room left over
 *   (CSS 2.2, 10.3.7 and 10.6.4): both sides share it, one side takes it all.
 * - An out-of-flow box with no insets in a block container sits where it would have been in
 *   flow, under the sibling before it.
 */
import type { Box, FixtureNode } from './fixture.ts';
import { readBack, type Conformance } from './yoga-baseline.ts';

type Style = Record<string, string>;

const AXES = [
  { start: 'left', end: 'right', size: 2, border: ['border-left-width', 'border-right-width'] },
  { start: 'top', end: 'bottom', size: 3, border: ['border-top-width', 'border-bottom-width'] },
] as const;

const pixels = (value: string | undefined) => Number.parseFloat(value ?? '0') || 0;
const isAuto = (value: string | undefined) => value === undefined || value === 'auto';

/** A length or a percentage of `whole`, or nothing for `auto`. */
function resolve(value: string | undefined, whole: number): number | undefined {
  if (isAuto(value)) return undefined;
  return value!.endsWith('%') ? (Number.parseFloat(value!) / 100) * whole : pixels(value);
}

/** The room between two insets, given to the `auto` margins on that axis. */
function shareAutoMargins(style: Style, box: Box, parent: FixtureNode, parentBox: Box): void {
  for (const axis of AXES) {
    const whole =
      parentBox[axis.size] -
      pixels(parent.style[axis.border[0]]) -
      pixels(parent.style[axis.border[1]]);
    const start = resolve(style[axis.start], whole);
    const end = resolve(style[axis.end], whole);
    const before = style[`margin-${axis.start}`];
    const after = style[`margin-${axis.end}`];
    if (before !== 'auto' && after !== 'auto') continue;
    const margins =
      (before === 'auto' ? 0 : pixels(before)) + (after === 'auto' ? 0 : pixels(after));
    const between = start !== undefined && end !== undefined;
    const free = between ? whole - start - end - box[axis.size] - margins : 0;
    const both = before === 'auto' && after === 'auto';
    // Two auto margins centre the box, unless it overflows: then the start edge holds.
    const lead = both ? Math.max(free / 2, 0) : before === 'auto' ? free : pixels(before);
    style[`margin-${axis.start}`] = `${lead}px`;
    style[`margin-${axis.end}`] = '0px';
    if (between) delete style[axis.end];
  }
}

const inFlow = (node: FixtureNode) =>
  node.style['display'] !== 'none' && node.style['position'] !== 'absolute';

/** An out-of-flow box with no vertical inset, put under the in-flow sibling before it. */
function placeInFlow(
  style: Style,
  node: FixtureNode,
  parent: FixtureNode,
  boxes: Map<FixtureNode, Box>,
): void {
  if (!isAuto(style['top']) || !isAuto(style['bottom'])) return;
  if (!['block', 'flow-root', 'inline-block'].includes(parent.style['display'] ?? '')) return;
  const before = parent.children.slice(0, parent.children.indexOf(node)).filter(inFlow).at(-1);
  if (!before) return;
  const box = boxes.get(before)!;
  const under = box[1] + box[3] + pixels(before.style['margin-bottom']);
  style['top'] = `${under - pixels(parent.style['border-top-width'])}px`;
}

function correct(
  node: FixtureNode,
  boxes: Map<FixtureNode, Box>,
  parent?: FixtureNode,
): FixtureNode {
  const style = { ...node.style };
  if (parent && node.style['position'] === 'absolute') {
    shareAutoMargins(style, boxes.get(node)!, parent, boxes.get(parent)!);
    placeInFlow(style, node, parent, boxes);
  }
  return { ...node, style, children: node.children.map((child) => correct(child, boxes, node)) };
}

/** The fixture with its out-of-flow boxes corrected from one layout's boxes. */
export function correctFromLayout(fixture: FixtureNode, conformance: Conformance): FixtureNode {
  return correct(fixture, readBack(fixture, conformance));
}
