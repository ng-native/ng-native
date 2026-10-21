/**
 * Random small trees of boxes, from a seed: the same seed and features give the same case.
 *
 * Each feature widens what is written. A run starts from `flex` and `size` alone, which plain Yoga
 * should agree with Chrome on, and adds one at a time, so a mismatch is about what was added.
 */
import type { Case, CaseNode, Declaration } from './case.ts';
import { PERCENTS, Picker, type Optional } from './picker.ts';
import { widen, WIDENED } from './widen.ts';

export const FEATURES = [
  /** Flex containers and items: direction, wrap, alignment, grow, shrink, basis, gap. */
  'flex',
  /** Widths and heights in pixels and percentages, and their minimums and maximums. */
  'size',
  /** Padding, margin, border widths and `box-sizing`. */
  'spacing',
  /** `display: block` containers, so margins collapse and boxes stack as blocks. */
  'block',
  /** `display: grid` with px, fr, auto and percentage tracks, and items placed by span. */
  'grid',
  /** `inline-block` and `inline-flex` boxes, in lines. */
  'inline',
  /** `position: absolute` with insets. */
  'absolute',
  /** `display: none`. */
  'none',
  /** Text in a box, in Ahem: ten points a character, twenty a line. */
  'text',
  /** Margins of `auto`, and negative margins. */
  'margin-auto',
  ...WIDENED,
] as const;
export type Feature = (typeof FEATURES)[number];

export const SIDES = ['top', 'right', 'bottom', 'left'];
const FLEX_CONTAINER: readonly Optional[] = [
  [0.6, 'flex-direction', (p) => p.one(['row', 'column', 'row', 'row-reverse', 'column-reverse'])],
  [0.25, 'flex-wrap', (p) => p.one(['wrap', 'nowrap', 'wrap-reverse'])],
  [
    0.4,
    'justify-content',
    (p) =>
      p.one(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']),
  ],
  [0.4, 'align-items', (p) => p.one(['flex-start', 'center', 'flex-end', 'stretch'])],
  [
    0.15,
    'align-content',
    (p) => p.one(['flex-start', 'center', 'flex-end', 'stretch', 'space-between', 'space-around']),
  ],
  [0.3, (p) => p.one(['gap', 'row-gap', 'column-gap']), (p) => p.px(0, 20)],
];
const GRID_CONTAINER: readonly Optional[] = [
  [1, 'grid-template-columns', (p) => tracks(p)],
  [0.5, 'grid-template-rows', (p) => tracks(p)],
  [0.4, (p) => p.one(['gap', 'row-gap', 'column-gap']), (p) => p.px(0, 20)],
  [0.3, 'justify-items', (p) => p.one(['start', 'center', 'end', 'stretch'])],
  [0.3, 'align-items', (p) => p.one(['start', 'center', 'end', 'stretch'])],
];
const LIMITS: readonly Optional[] = [
  [0.12, 'min-width', (p) => p.size()],
  [0.12, 'max-width', (p) => p.size()],
  [0.1, 'min-height', (p) => p.size()],
  [0.1, 'max-height', (p) => p.size()],
];
const SPACING: readonly Optional[] = [
  [0.3, 'padding', (p) => p.px(0, 15)],
  [
    0.2,
    (p) => `padding-${p.one(SIDES)}`,
    (p) => (p.chance(0.15) ? p.one(['5%', '10%']) : p.px(0, 15)),
  ],
  [0.3, 'margin', (p) => p.px(0, 15)],
  [
    0.25,
    (p) => `margin-${p.one(SIDES)}`,
    (p) => (p.chance(0.15) ? p.one(['5%', '10%']) : p.px(0, 20)),
  ],
  [
    0.2,
    (p) => (p.chance(0.5) ? 'border-width' : `border-${p.one(SIDES)}-width`),
    (p) => p.px(1, 6),
  ],
  [0.15, 'box-sizing', () => 'content-box'],
];
const AUTO_MARGINS: readonly Optional[] = [
  [
    0.2,
    (p) => p.one(['margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'margin']),
    (p) => (p.chance(0.7) ? 'auto' : `-${p.int(1, 20)}px`),
  ],
];
const FLEX_ITEM: readonly Optional[] = [
  [0.3, 'flex-grow', (p) => String(p.int(0, 3))],
  [0.3, 'flex-shrink', (p) => String(p.int(0, 2))],
  [0.2, 'flex-basis', (p) => p.one(['auto', '0', p.px(0, 120), p.one(PERCENTS)])],
  [0.2, 'align-self', (p) => p.one(['auto', 'flex-start', 'center', 'flex-end', 'stretch'])],
];
const GRID_ITEM: readonly Optional[] = [
  [0.25, 'grid-column', (p) => `span ${p.int(1, 2)}`],
  [0.15, 'grid-row', (p) => `span ${p.int(1, 2)}`],
  [0.2, 'justify-self', (p) => p.one(['start', 'center', 'end', 'stretch'])],
  [0.2, 'align-self', (p) => p.one(['start', 'center', 'end', 'stretch'])],
];
const INSETS: readonly Optional[] = SIDES.map((side) => [
  0.35,
  side,
  (p) => (p.chance(0.2) ? p.one(PERCENTS) : p.px(0, 40)),
]);

function tracks(p: Picker): string {
  const track = () =>
    p.one([
      p.px(10, 80),
      `${p.int(1, 3)}fr`,
      'auto',
      p.one(PERCENTS),
      `minmax(${p.px(0, 40)}, 1fr)`,
    ]);
  return Array.from({ length: p.int(1, 3) }, track).join(' ');
}

const isFlex = (display: string) => display === 'flex' || display === 'inline-flex';

export function generate(seed: number, features: ReadonlySet<Feature>): Case {
  return widen(generateBase(seed, features), features);
}

/** A case of the first features alone; `widen` adds the rest without moving a draw of these. */
function generateBase(seed: number, features: ReadonlySet<Feature>): Case {
  const pick = new Picker(seed, features.has('size'));
  const has = (feature: Feature) => features.has(feature);
  let count = 0;
  const displays = [
    'flex',
    ...(has('block') ? ['block', 'block'] : []),
    ...(has('grid') ? ['grid'] : []),
  ];

  /** What a box says of its own size and spacing. */
  function sized(own: Declaration[], leaf: boolean): void {
    // A leaf with nothing in it needs a size to be seen at all.
    if (pick.chance(leaf ? 0.85 : 0.4)) own.push(['width', pick.size()]);
    if (pick.chance(leaf ? 0.85 : 0.3)) own.push(['height', pick.size()]);
    if (has('size')) pick.some(own, LIMITS);
    if (has('spacing')) pick.some(own, SPACING);
    if (has('margin-auto')) pick.some(own, AUTO_MARGINS);
  }

  /** What a box says as an item of the box it is in. */
  function item(own: Declaration[], parentDisplay: string): void {
    if (isFlex(parentDisplay)) pick.some(own, FLEX_ITEM);
    if (parentDisplay === 'grid') pick.some(own, GRID_ITEM);
    if (has('absolute') && pick.chance(0.12)) {
      own.push(['position', 'absolute']);
      pick.some(own, INSETS);
    }
    if (has('none') && pick.chance(0.06)) own.push(['display', 'none']);
  }

  /** How a box lays out what is in it, if it has anything; a box in a line may be inline-level. */
  function displayOf(wantsChildren: boolean, parentDisplay: string): string | undefined {
    const inline = has('inline') && parentDisplay !== 'grid' && pick.chance(0.25);
    if (!wantsChildren) return inline ? 'inline-block' : undefined;
    return inline ? pick.one(['inline-block', 'inline-flex']) : pick.one(displays);
  }

  function node(depth: number, parentDisplay: string): CaseNode {
    count++;
    const own: Declaration[] = [];
    const wantsChildren = depth < 3 && count < 8 && pick.chance(depth === 0 ? 1 : 0.35);
    const display = displayOf(wantsChildren, parentDisplay);
    if (display) container(own, display);
    const children: CaseNode[] = [];
    const many = wantsChildren ? pick.int(1, 4) : 0;
    for (let i = 0; i < many && count < 10; i++) children.push(node(depth + 1, display ?? 'flex'));
    const text = textOf(children.length === 0);
    sized(own, !children.length && text === undefined);
    if (depth > 0) item(own, parentDisplay);
    // `display` written by `item` (none) wins, as it is written last.
    return { declarations: own, children, ...(text === undefined ? {} : { text }) };
  }

  function container(own: Declaration[], display: string): void {
    own.push(['display', display]);
    if (isFlex(display)) pick.some(own, FLEX_CONTAINER);
    if (display === 'grid') pick.some(own, GRID_CONTAINER);
  }

  /** Text, sometimes, in a box with nothing else in it. */
  function textOf(empty: boolean): string | undefined {
    return has('text') && empty && pick.chance(0.3) ? pick.words() : undefined;
  }

  // The case's root sits in the screen, a flex column 400 wide and 800 tall.
  return { seed, root: node(0, 'flex') };
}
