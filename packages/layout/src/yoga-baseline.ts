/**
 * What a device lays out today: a fixture's CSS as the compiler reads it, laid out by Yoga.
 *
 * This is the baseline every candidate is scored against. It makes the readings the compiler
 * makes: a block, inline, flow-root or grid box is a flex column, `float` and `text-align` are
 * dropped, and everything else Yoga implements is passed on. Rounding to a screen's pixels is
 * left off, so a difference from Chrome is a difference in layout and not in rounding.
 */
import Yoga, {
  Align,
  BoxSizing,
  Direction,
  Display,
  Edge,
  FlexDirection,
  Errata,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Wrap,
  type MeasureFunction,
  type Node,
} from 'yoga-layout';
import type { Box, FixtureNode } from './fixture.ts';

/** The window Chrome records in, and the root every fixture sits in here. */
export const VIEWPORT = { width: 1000, height: 700 } as const;

/** The Ahem font at the size the fixtures set: every glyph is a square this wide and tall. */
const GLYPH = 10;

/**
 * React Native's own Yoga setup, without rounding to a pixel grid: `classic` keeps the errata a
 * view has by default, `strict` is a view under `experimental_LayoutConformance mode="strict"`.
 */
const CONFIGS = { classic: Yoga.Config.create(), strict: Yoga.Config.create() };
CONFIGS.classic.setErrata(Errata.All);
CONFIGS.strict.setErrata(Errata.None);
for (const each of Object.values(CONFIGS)) each.setPointScaleFactor(0);
export type Conformance = keyof typeof CONFIGS;
let config = CONFIGS.classic;

type Length = number | 'auto' | `${number}%`;

function length(value: string | undefined): Length | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto') return 'auto';
  const match = /^(-?[\d.]+)(px|%)?$/.exec(value);
  if (!match) return undefined;
  if (match[2] === '%') return `${Number(match[1])}%`;
  return match[2] === 'px' || Number(match[1]) === 0 ? Number(match[1]) : undefined;
}

/** A one to four value shorthand, as top, right, bottom, left. */
function sides(value: string): [string, string, string, string] {
  const [a, b = a, c = a, d = b] = value.split(/\s+/) as [string, string?, string?, string?];
  return [a!, b!, c!, d!];
}

const EDGES = [
  ['top', Edge.Top],
  ['right', Edge.Right],
  ['bottom', Edge.Bottom],
  ['left', Edge.Left],
] as const;

const ALIGN: Record<string, Align> = {
  auto: Align.Auto,
  start: Align.FlexStart,
  'flex-start': Align.FlexStart,
  center: Align.Center,
  end: Align.FlexEnd,
  'flex-end': Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
  'space-between': Align.SpaceBetween,
  'space-around': Align.SpaceAround,
  'space-evenly': Align.SpaceEvenly,
};
const JUSTIFY: Record<string, Justify> = {
  start: Justify.FlexStart,
  'flex-start': Justify.FlexStart,
  center: Justify.Center,
  end: Justify.FlexEnd,
  'flex-end': Justify.FlexEnd,
  'space-between': Justify.SpaceBetween,
  'space-around': Justify.SpaceAround,
  'space-evenly': Justify.SpaceEvenly,
};
const DIRECTION: Record<string, FlexDirection> = {
  row: FlexDirection.Row,
  column: FlexDirection.Column,
  'row-reverse': FlexDirection.RowReverse,
  'column-reverse': FlexDirection.ColumnReverse,
};
const WRAP: Record<string, Wrap> = {
  wrap: Wrap.Wrap,
  nowrap: Wrap.NoWrap,
  'wrap-reverse': Wrap.WrapReverse,
};

/** The longhands a fixture's declarations come to, with each shorthand spread over its sides. */
function longhands(style: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [property, value] of Object.entries(style)) {
    if (property === 'margin' || property === 'padding') {
      sides(value).forEach((side, i) => (out[`${property}-${EDGES[i]![0]}`] = side));
    } else if (property === 'inset') {
      sides(value).forEach((side, i) => (out[EDGES[i]![0]] = side));
    } else if (property === 'border-width') {
      sides(value).forEach((side, i) => (out[`border-${EDGES[i]![0]}-width`] = side));
    } else if (/^border(-(top|right|bottom|left))?$/.test(property)) {
      const width = value.split(/\s+/).find((word) => length(word) !== undefined);
      const edges = property === 'border' ? EDGES.map(([edge]) => edge) : [property.slice(7)];
      if (width) for (const edge of edges) out[`border-${edge}-width`] = width;
    } else {
      out[property] = value;
    }
  }
  return out;
}

// eslint-disable-next-line complexity -- one flat case per layout property
function apply(node: Node, fixture: FixtureNode): void {
  const style = longhands(fixture.style);
  const set = (property: string, to: (value: Length) => void) => {
    const value = length(style[property]);
    if (value !== undefined) to(value);
  };
  set('width', (v) => node.setWidth(v));
  set('height', (v) => node.setHeight(v));
  set('min-width', (v) => v !== 'auto' && node.setMinWidth(v));
  set('min-height', (v) => v !== 'auto' && node.setMinHeight(v));
  set('max-width', (v) => v !== 'auto' && node.setMaxWidth(v));
  set('max-height', (v) => v !== 'auto' && node.setMaxHeight(v));
  set('flex-basis', (v) => node.setFlexBasis(v));
  for (const [name, edge] of EDGES) {
    set(`margin-${name}`, (v) => node.setMargin(edge, v));
    set(`padding-${name}`, (v) => v !== 'auto' && node.setPadding(edge, v));
    set(`border-${name}-width`, (v) => typeof v === 'number' && node.setBorder(edge, v));
    set(name, (v) => v !== 'auto' && node.setPosition(edge, v));
  }
  if (style['display'] === 'none') node.setDisplay(Display.None);
  if (style['display'] === 'contents') node.setDisplay(Display.Contents);
  if (style['position'] === 'absolute') node.setPositionType(PositionType.Absolute);
  if (style['position'] === 'static') node.setPositionType(PositionType.Static);
  const pick = <T>(property: string, from: Record<string, T>, to: (value: T) => void) => {
    const value = from[style[property] ?? ''];
    if (value !== undefined) to(value);
  };
  pick('flex-direction', DIRECTION, (v) => node.setFlexDirection(v));
  pick('flex-wrap', WRAP, (v) => node.setFlexWrap(v));
  pick('align-items', ALIGN, (v) => node.setAlignItems(v));
  pick('align-self', ALIGN, (v) => node.setAlignSelf(v));
  pick('align-content', ALIGN, (v) => node.setAlignContent(v));
  pick('justify-content', JUSTIFY, (v) => node.setJustifyContent(v));
  if (style['flex-grow'] !== undefined) node.setFlexGrow(Number(style['flex-grow']));
  if (style['flex-shrink'] !== undefined) node.setFlexShrink(Number(style['flex-shrink']));
  const overflow = [style['overflow'], style['overflow-x'], style['overflow-y']];
  if (overflow.some((value) => value === 'scroll' || value === 'auto')) {
    node.setOverflow(Overflow.Scroll);
  } else if (overflow.some((value) => value === 'hidden' || value === 'clip')) {
    node.setOverflow(Overflow.Hidden);
  }
  const ratio = /^([\d.]+)(?:\s*\/\s*([\d.]+))?$/.exec(style['aspect-ratio'] ?? '');
  if (ratio) node.setAspectRatio(Number(ratio[1]) / Number(ratio[2] ?? 1));
  const contentBox =
    style['box-sizing'] ?? (fixture.classes.includes('content-box') && 'content-box');
  if (contentBox === 'content-box') node.setBoxSizing(BoxSizing.ContentBox);
}

/** Ahem text, wrapped where it may break: what a text node measures to at a given width. */
function measureText(text: string, width: number, mode: MeasureMode) {
  const words = text.split('​').map((word) => word.length * GLYPH);
  const limit = mode === MeasureMode.Undefined ? Infinity : width;
  let widest = 0;
  let line = 0;
  let lines = 1;
  for (const word of words) {
    if (line > 0 && line + word > limit) {
      lines += 1;
      line = 0;
    }
    line += word;
    widest = Math.max(widest, line);
  }
  return { width: mode === MeasureMode.Exactly ? width : widest, height: lines * GLYPH };
}

/** What lays out a box Yoga cannot, a grid say: its size for Yoga, then its children's boxes. */
export interface Foreign {
  measure(fixture: FixtureNode): MeasureFunction | undefined;
  children(fixture: FixtureNode, box: readonly [number, number, number, number]): Box[] | undefined;
}

function build(fixture: FixtureNode, foreign?: Foreign): Node {
  const node = Yoga.Node.create(config);
  apply(node, fixture);
  const measure = foreign?.measure(fixture);
  if (measure) {
    node.setMeasureFunc(measure);
  } else if (fixture.text && !fixture.children.length) {
    node.setMeasureFunc((width, mode) => measureText(fixture.text, width, mode));
  } else {
    fixture.children.forEach((child, i) => node.insertChild(build(child, foreign), i));
  }
  return node;
}

function boxes(
  node: Node,
  fixture: FixtureNode,
  seen?: Map<FixtureNode, Box>,
  foreign?: Foreign,
): Box {
  const { left, top, width, height } = node.getComputedLayout();
  // A text box is a leaf here, and has no element children in the fixture either.
  const children =
    foreign?.children(fixture, [left, top, width, height]) ??
    (node.getChildCount()
      ? fixture.children.map((child, i) => boxes(node.getChild(i), child, seen, foreign))
      : []);
  const box: Box = [left, top, width, height, children];
  seen?.set(fixture, box);
  return box;
}

/** The fixture's boxes as a device lays them out today. */
export function layOutToday(fixture: FixtureNode, conformance: Conformance = 'classic'): Box {
  return layOut(fixture, { conformance });
}

/** Every node's box after one layout: what the engine reads back from Fabric after a commit. */
export function readBack(fixture: FixtureNode, conformance: Conformance): Map<FixtureNode, Box> {
  const seen = new Map<FixtureNode, Box>();
  layOut(fixture, { conformance, seen });
  return seen;
}

export interface LayOutOptions {
  conformance: Conformance;
  seen?: Map<FixtureNode, Box>;
  foreign?: Foreign;
  /** The width of the box the root sits in, which is as wide as the root when left out. */
  width?: number;
}

export function layOut(fixture: FixtureNode, options: LayOutOptions): Box {
  // Yoga runs a measure function inside `calculateLayout`, and that may lay out a tree of its
  // own, so the config in use is put back when this returns.
  const outer = config;
  config = CONFIGS[options.conformance];
  const viewport = Yoga.Node.create(config);
  viewport.setWidth(VIEWPORT.width);
  viewport.setHeight(VIEWPORT.height);
  // The recorder's `.case` wrapper: out of flow at the corner, holding the root at its own size.
  const wrapper = Yoga.Node.create(config);
  wrapper.setPositionType(PositionType.Absolute);
  wrapper.setPosition(Edge.Left, 0);
  wrapper.setPosition(Edge.Top, 0);
  wrapper.setAlignItems(Align.FlexStart);
  if (options.width !== undefined) wrapper.setWidth(options.width);
  const root = build(fixture, options.foreign);
  wrapper.insertChild(root, 0);
  viewport.insertChild(wrapper, 0);
  const rtl = fixture.classes.includes('rtl') || fixture.style['direction'] === 'rtl';
  viewport.calculateLayout(undefined, undefined, rtl ? Direction.RTL : Direction.LTR);
  const out = boxes(root, fixture, options.seen, options.foreign);
  viewport.freeRecursive();
  config = outer;
  return out;
}
