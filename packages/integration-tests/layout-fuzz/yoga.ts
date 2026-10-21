/**
 * Laying out what the engine committed, as React Native would: a fake Fabric whose
 * `getBoundingClientRect` answers from a Yoga layout of the committed tree, so the engine's own
 * read-back works as it does on a device.
 *
 * Two Yogas can do it. `react-native` is the Yoga vendored in the react-native package this
 * workspace builds against, built into a Node addon (`rn-yoga/`): what a device runs. `npm` is
 * `yoga-layout` from npm, as `laid-out-fabric.ts` uses, which is an older Yoga.
 */
import { createRequire } from 'node:module';
import type { FabricNode, FabricUIManager } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { paragraph, SCREEN } from '../laid-out-fabric.ts';
import { layOutRects, type Box } from '../layout.ts';
import { build } from './rn-yoga/build.ts';

export type Backend = 'react-native' | 'npm';
export type Conformance = 'classic' | 'strict';

const require = createRequire(import.meta.url);
let addon: { layout(ops: Float64Array, texts: string[]): Float64Array } | undefined;
const native = () => (addon ??= require(build()) as NonNullable<typeof addon>);

/** React Native's own screens are 3x on the iPhones this is compared for. */
const SCALE = 3;

const EDGE = {
  left: 0,
  top: 1,
  right: 2,
  bottom: 3,
  start: 4,
  end: 5,
  horizontal: 6,
  vertical: 7,
  all: 8,
};
/** Each edge prop and its Yoga edge, broadest first, so a more specific one wins (`layout.ts`). */
const EDGES: readonly (readonly [string, number])[] = [
  ['', EDGE.all],
  ['Horizontal', EDGE.horizontal],
  ['Vertical', EDGE.vertical],
  ['Block', EDGE.vertical],
  ['Inline', EDGE.horizontal],
  ['Top', EDGE.top],
  ['Right', EDGE.right],
  ['Bottom', EDGE.bottom],
  ['Left', EDGE.left],
  ['Start', EDGE.start],
  ['End', EDGE.end],
  ['BlockStart', EDGE.top],
  ['BlockEnd', EDGE.bottom],
];
const ALIGN = [
  'auto',
  'flex-start',
  'center',
  'flex-end',
  'stretch',
  'baseline',
  'space-between',
  'space-around',
  'space-evenly',
];
const JUSTIFY = [
  'flex-start',
  'center',
  'flex-end',
  'space-between',
  'space-around',
  'space-evenly',
];
const DIRECTION = ['column', 'column-reverse', 'row', 'row-reverse'];
const WRAP = ['nowrap', 'wrap', 'wrap-reverse'];
const POSITION = ['static', 'relative', 'absolute'];
const DISPLAY = ['flex', 'none', 'contents'];
const OVERFLOW = ['visible', 'hidden', 'scroll'];
const DIRECTIONS = ['inherit', 'ltr', 'rtl'];

/** A length as unit and value: a number in points, `n%`, or `auto`. Anything else, nothing. */
function length(value: unknown): [unit: number, value: number] | undefined {
  if (typeof value === 'number') return [0, value];
  if (value === 'auto') return [2, 0];
  if (typeof value === 'string' && /^-?[\d.]+%$/.test(value)) return [1, Number.parseFloat(value)];
  return undefined;
}

/** A committed node's props as the addon's ops, as `layout.ts`'s `apply` sets them in Yoga. */
// eslint-disable-next-line complexity -- one flat case per layout prop
function ops(props: Readonly<Record<string, unknown>>): number[] {
  const out: number[] = [];
  const op = (code: number, edge: number, unit: number, value: number) =>
    out.push(code, edge, unit, value);
  const size = (key: string, code: number, edge = 0, allow = [0, 1, 2]) => {
    const v = length(props[key]);
    if (v && allow.includes(v[0])) op(code, edge, v[0], v[1]);
  };
  size('width', 1);
  size('height', 2);
  // `auto` is no limit, and React Native reads it as unset.
  size('minWidth', 3, 0, [0, 1]);
  size('minHeight', 4, 0, [0, 1]);
  size('maxWidth', 5, 0, [0, 1]);
  size('maxHeight', 6, 0, [0, 1]);
  size('flexBasis', 7);
  for (const [suffix, edge] of EDGES) {
    size(`margin${suffix}`, 10, edge);
    size(`padding${suffix}`, 11, edge, [0, 1]);
    const border = props[`border${suffix}Width`];
    if (typeof border === 'number') op(12, edge, 0, border);
  }
  for (const key of ['top', 'right', 'bottom', 'left', 'start', 'end'] as const)
    size(key, 13, EDGE[key], [0, 1]);
  for (const [key, gutter] of [
    ['gap', 2],
    ['rowGap', 1],
    ['columnGap', 0],
  ] as const) {
    // React Native reads a gap as points or a percentage, as Yoga lays it out.
    const gap = length(props[key]);
    if (gap && gap[0] !== 2) op(14, gutter, gap[0], gap[1]);
  }
  const word = (key: string, code: number, names: readonly string[]) => {
    const index = names.indexOf(props[key] as string);
    if (index >= 0) op(code, 0, 0, index);
  };
  // `relative` is Yoga's default, and `layout.ts` sets only the other two.
  if (props['position'] === 'absolute' || props['position'] === 'static')
    word('position', 20, POSITION);
  word('flexDirection', 21, DIRECTION);
  word('flexWrap', 22, WRAP);
  for (const [key, code] of [
    ['flex', 23],
    ['flexGrow', 24],
    ['flexShrink', 25],
    ['aspectRatio', 32],
  ] as const) {
    if (typeof props[key] === 'number') op(code, 0, 0, props[key]);
  }
  word('alignItems', 26, ALIGN);
  word('alignSelf', 27, ALIGN);
  word('alignContent', 28, ALIGN);
  word('justifyContent', 29, JUSTIFY);
  if (props['display'] === 'none' || props['display'] === 'contents') word('display', 30, DISPLAY);
  if (props['overflow'] === 'hidden' || props['overflow'] === 'scroll')
    word('overflow', 31, OVERFLOW);
  if (props['boxSizing'] === 'content-box') op(33, 0, 0, 1);
  word('direction', 34, DIRECTIONS);
  return out;
}

const textOf = (node: FakeFabricNode): string =>
  node.children.map((child) => String(child.props['text'] ?? '') + textOf(child)).join('');

/** The committed tree laid out by React Native's Yoga: each node's box against the screen. */
function layOutNative(
  nodes: readonly FakeFabricNode[],
  conformance: Conformance,
): Map<FakeFabricNode, Box> {
  const order: FakeFabricNode[] = [];
  const parents: number[] = [];
  const texts: string[] = [];
  const textIndex: number[] = [];
  const visit = (node: FakeFabricNode, parent: number) => {
    order.push(node);
    parents.push(parent);
    const index = order.length - 1;
    if (node.viewName === 'Paragraph') {
      textIndex.push(texts.push(textOf(node)) - 1);
      return;
    }
    textIndex.push(-1);
    for (const child of node.children) visit(child, index);
  };
  for (const node of nodes) visit(node, -1);
  const numbers: number[] = [
    SCREEN.width,
    SCREEN.height,
    conformance === 'strict' ? 0 : 1,
    SCALE,
    order.length,
  ];
  order.forEach((node, i) => {
    const props = Object.fromEntries(Object.entries(node.props).filter(([, v]) => v !== null));
    const own = ops(props);
    numbers.push(parents[i]!, textIndex[i]!, own.length / 4, ...own);
  });
  const result = native().layout(Float64Array.from(numbers), texts);
  const boxes = new Map<FakeFabricNode, Box>();
  const absolute: Box[] = [];
  order.forEach((node, i) => {
    const origin = parents[i]! < 0 ? { left: 0, top: 0 } : absolute[parents[i]!]!;
    const box = {
      left: origin.left + result[i * 4]!,
      top: origin.top + result[i * 4 + 1]!,
      width: result[i * 4 + 2]!,
      height: result[i * 4 + 3]!,
    };
    absolute.push(box);
    boxes.set(node, box);
  });
  return boxes;
}

export function layOutCommitted(
  nodes: readonly FakeFabricNode[],
  conformance: Conformance,
  backend: Backend,
): Map<FakeFabricNode, Box> {
  return backend === 'react-native'
    ? layOutNative(nodes, conformance)
    : layOutRects(nodes, SCREEN, paragraph, conformance);
}

export interface YogaFabric extends FakeFabric {
  /** Each committed node's box against the screen, laid out once a commit. */
  boxes(): Map<FakeFabricNode, Box>;
}

/** A Fabric that answers where a committed node is, as React Native's does. */
type ReadsBack = FabricUIManager & {
  getBoundingClientRect?: (handle: FabricNode) => readonly number[] | undefined;
};

export function createYogaFabric(conformance: Conformance, backend: Backend): YogaFabric {
  const fabric = createFakeFabric() as YogaFabric;
  let laidOut: readonly FakeFabricNode[] | undefined;
  let cached = new Map<FakeFabricNode, Box>();
  fabric.boxes = () => {
    if (laidOut !== fabric.committed) {
      cached = layOutCommitted(fabric.committed, conformance, backend);
      laidOut = fabric.committed;
    }
    return cached;
  };
  const find = (all: readonly FakeFabricNode[], tag: number): FakeFabricNode | undefined => {
    for (const each of all) {
      const found = each.reactTag === tag ? each : find(each.children, tag);
      if (found) return found;
    }
    return undefined;
  };
  (fabric as ReadsBack).getBoundingClientRect = (handle: FabricNode) => {
    // The newest clone of the node, as Fabric answers for: the handle may be an older one.
    const node = find(fabric.committed, (handle as unknown as FakeFabricNode).reactTag);
    const box = node && fabric.boxes().get(node);
    return box ? [box.left, box.top, box.width, box.height] : undefined;
  };
  return fabric;
}
