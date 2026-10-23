/**
 * The generator's later features, written over a case the first features made. Each feature draws
 * from a stream of its own, so turning one on leaves every draw of the first features, and of the
 * other later ones, where it was: a case that matched without a feature and fails with it fails
 * because of what the feature wrote.
 */
import type { Case, CaseNode, Declaration } from './case.ts';
import { PERCENTS, Picker } from './picker.ts';

export const WIDENED = [
  /** `calc()` of a percentage and pixels, or of pixels alone, on sizes and spacing. */
  'calc',
  /** `aspect-ratio`, often with one of the box's width and height taken away. */
  'aspect-ratio',
  /** `order` on the items of flex and grid containers. */
  'order',
  /** `position: fixed` with insets. */
  'fixed',
  /**
   * `position: sticky`, with insets of nothing: a box sticks at rest in a browser against the
   * screen it scrolls in, which the engine has no scroll view for, so only insets no box in the
   * screen reaches are written.
   */
  'sticky',
  /** `direction: rtl` on the root and on some containers. */
  'rtl',
  /** `min()`, `max()` and `clamp()` of pixels, and of pixels and percentages. */
  'min-max',
  /** Gaps in percentages on flex and grid containers. */
  'gap-percent',
  /** `box-sizing` written on more boxes, each with padding or a border for it to matter. */
  'box-sizing',
  /** `visibility: hidden`, and `visible` under it. */
  'visibility',
  /** Flex containers made of grid items and grids made of flex items, each with boxes in it. */
  'nested',
] as const;
export type Widened = (typeof WIDENED)[number];

type Rewrite = (node: CaseNode, parent: CaseNode | undefined, pick: Picker) => CaseNode;

/** Each box rewritten from the root down; a box's children are rewritten under its new self. */
function rewrite(
  node: CaseNode,
  parent: CaseNode | undefined,
  pick: Picker,
  each: Rewrite,
): CaseNode {
  const next = each(node, parent, pick);
  return { ...next, children: next.children.map((child) => rewrite(child, next, pick, each)) };
}

const value = (node: CaseNode, property: string) =>
  [...node.declarations].reverse().find(([p]) => p === property)?.[1];
const displayOf = (node: CaseNode) => value(node, 'display') ?? 'flex';
const layingOut = (node: CaseNode) =>
  ['flex', 'inline-flex', 'grid'].includes(displayOf(node)) && node.children.length > 0;

/** The box with `property` set to `to`, in place of any it had. */
function set(node: CaseNode, property: string, to: string): CaseNode {
  return {
    ...node,
    declarations: [...node.declarations.filter(([p]) => p !== property), [property, to]],
  };
}

function without(node: CaseNode, ...properties: string[]): CaseNode {
  return {
    ...node,
    declarations: node.declarations.filter(([p]) => !properties.includes(p)),
  };
}

function calcOf(pick: Picker): string {
  const px = pick.px(1, 40);
  switch (pick.int(0, 3)) {
    case 0:
      return `calc(${pick.one(PERCENTS)} - ${px})`;
    case 1:
      return `calc(${pick.one(PERCENTS)} + ${px})`;
    case 2:
      return `calc(${px} + ${pick.one(PERCENTS)})`;
    default:
      return `calc(${px} + ${pick.px(1, 80)})`;
  }
}

const CALC_PROPERTIES = [
  'width',
  'width',
  'height',
  'height',
  'min-width',
  'max-width',
  'padding-left',
  'padding-top',
  'margin-left',
  'margin-top',
  'flex-basis',
];

function comparison(pick: Picker): string {
  // Pixels alone fold in the compiler; a percentage needs the room the box is in.
  const arg = () => (pick.chance(0.4) ? pick.one(PERCENTS) : pick.px(0, 160));
  switch (pick.int(0, 2)) {
    case 0:
      return `min(${arg()}, ${arg()})`;
    case 1:
      return `max(${arg()}, ${arg()})`;
    default:
      return `clamp(${pick.px(0, 60)}, ${arg()}, ${pick.px(60, 200)})`;
  }
}

const INSET_SIDES = ['top', 'right', 'bottom', 'left'];

const inset = (pick: Picker) => (pick.chance(0.2) ? pick.one(PERCENTS) : pick.px(0, 40));

function positioned(
  node: CaseNode,
  pick: Picker,
  position: string,
  chance: number,
  length = inset,
): CaseNode {
  let next = set(without(node, ...INSET_SIDES), 'position', position);
  for (const side of INSET_SIDES) {
    if (pick.chance(chance)) next = set(next, side, length(pick));
  }
  return next;
}

function track(pick: Picker): string {
  return pick.one([pick.px(10, 80), `${pick.int(1, 3)}fr`, 'auto', pick.one(PERCENTS)]);
}

function leaf(pick: Picker): CaseNode {
  const declarations: Declaration[] = [];
  if (pick.chance(0.8))
    declarations.push(['width', pick.chance(0.25) ? pick.one(PERCENTS) : pick.px(0, 100)]);
  if (pick.chance(0.8))
    declarations.push(['height', pick.chance(0.25) ? pick.one(PERCENTS) : pick.px(0, 80)]);
  return { declarations, children: [] };
}

/** The boxes `nested` put in a box, which are not made containers in turn. */
const made = new WeakSet<CaseNode>();

/** A box with nothing in it made a container of the other kind, with boxes in it. */
function nested(node: CaseNode, parent: CaseNode | undefined, pick: Picker): CaseNode {
  if (!parent || made.has(node) || node.children.length || node.text !== undefined) return node;
  const inGrid = displayOf(parent) === 'grid';
  if (!pick.chance(inGrid ? 0.6 : 0.25)) return node;
  const children = Array.from({ length: pick.int(1, 3) }, () => leaf(pick));
  for (const child of children) made.add(child);
  let next = inGrid ? flexOf(node, pick) : gridOf(node, pick);
  if (pick.chance(0.5)) next = without(next, pick.one(['width', 'height']));
  return { ...next, children };
}

function flexOf(node: CaseNode, pick: Picker): CaseNode {
  const next = set(node, 'display', 'flex');
  return pick.chance(0.5) ? set(next, 'flex-direction', 'row') : next;
}

function gridOf(node: CaseNode, pick: Picker): CaseNode {
  const columns = Array.from({ length: pick.int(1, 3) }, () => track(pick)).join(' ');
  return set(set(node, 'display', 'grid'), 'grid-template-columns', columns);
}

const SPACED = /^(padding|border)/;

const WRITERS: Record<Widened, Rewrite> = {
  calc: (node, _, pick) =>
    pick.chance(0.4) ? set(node, pick.one(CALC_PROPERTIES), calcOf(pick)) : node,
  'aspect-ratio': (node, _, pick) => {
    if (!pick.chance(0.3)) return node;
    const next = set(node, 'aspect-ratio', pick.one(['1', '2', '0.5', '1 / 2', '16 / 9', '3 / 2']));
    return pick.chance(0.6) ? without(next, pick.one(['width', 'height'])) : next;
  },
  order: (node, parent, pick) =>
    parent && layingOut(parent) && pick.chance(0.35)
      ? set(node, 'order', String(pick.int(-1, 3)))
      : node,
  fixed: (node, parent, pick) =>
    parent && pick.chance(0.1) ? positioned(node, pick, 'fixed', 0.35) : node,
  sticky: (node, parent, pick) =>
    parent && pick.chance(0.12) ? positioned(node, pick, 'sticky', 0.25, () => '0px') : node,
  rtl: (node, parent, pick) => {
    if (!parent) return pick.chance(0.6) ? set(node, 'direction', 'rtl') : node;
    if (!node.children.length || !pick.chance(0.15)) return node;
    return set(node, 'direction', pick.one(['rtl', 'ltr']));
  },
  'min-max': (node, _, pick) =>
    pick.chance(0.3) ? set(node, pick.one(CALC_PROPERTIES), comparison(pick)) : node,
  'gap-percent': (node, _, pick) =>
    layingOut(node) && pick.chance(0.5)
      ? set(node, pick.one(['gap', 'row-gap', 'column-gap']), pick.one(['5%', '10%', '25%']))
      : node,
  'box-sizing': (node, _, pick) => {
    if (!pick.chance(0.4)) return node;
    let next = set(node, 'box-sizing', pick.one(['content-box', 'border-box']));
    if (!next.declarations.some(([p]) => SPACED.test(p)) && pick.chance(0.7))
      next = set(next, pick.chance(0.5) ? 'padding' : 'border-width', pick.px(1, 12));
    return next;
  },
  visibility: (node, parent, pick) => {
    const hidden = parent && value(parent, 'visibility') === 'hidden';
    if (hidden) return pick.chance(0.3) ? set(node, 'visibility', 'visible') : node;
    return pick.chance(0.12) ? set(node, 'visibility', 'hidden') : node;
  },
  nested,
};

/** The later features `features` names, written over a case of the first ones. */
export function widen(test: Case, features: ReadonlySet<string>): Case {
  let root = test.root;
  WIDENED.forEach((feature, index) => {
    if (!features.has(feature)) return;
    const pick = new Picker((test.seed * 7919 + (index + 1) * 104729) >>> 0, true);
    root = rewrite(root, undefined, pick, WRITERS[feature]);
  });
  return { seed: test.seed, root };
}
