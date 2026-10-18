/**
 * Where this project puts each box of a case, without a device: the case's stylesheet compiled by
 * Metro's CSS compiler, the tree built in the engine, and what the engine commits laid out by
 * React Native's Yoga (`yoga.ts`). The engine reads boxes back from that layout where it lays out
 * what Yoga cannot, as it reads them from a device.
 */
import { createRequire } from 'node:module';
import { Engine, type EngineNode, type StyleSheet } from '@ng-native/fabric';
import type { FakeFabricNode } from '@ng-native/testing';
import { boxes, hidden, stylesheet, type Case } from './case.ts';
import { createYogaFabric, type Backend, type Conformance } from './yoga.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(
    css: string,
    name: string,
    options: { onUnsupported(message: string): void },
  ): StyleSheet;
};

export type Rect = readonly [left: number, top: number, width: number, height: number];

export interface PipelineResult {
  /** Each laid-out box by name, against the screen. */
  readonly rects: Map<string, Rect>;
  /** What the compiler dropped, one message each. */
  readonly refused: readonly string[];
  /** Committed layout props the harness's Yoga cannot apply, so its layout would be wrong. */
  readonly unmodelled: readonly string[];
  /** What the engine committed, as indented lines of view names and props. */
  readonly committed: string;
}

function describeCommitted(nodes: readonly FakeFabricNode[], depth = 0): string {
  return nodes
    .map((node) => {
      const props = Object.entries(node.props)
        .filter(([key, value]) => value !== null && value !== undefined && key !== 'nativeID')
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(', ');
      const name = node.props['nativeID'] ?? node.viewName;
      const line = `${'  '.repeat(depth)}${String(name)} { ${props} }`;
      return [line, describeCommitted(node.children, depth + 1)].filter(Boolean).join('\n');
    })
    .join('\n');
}

/**
 * The layout props `layout.ts` hands to Yoga, and the values it reads for each. A committed prop
 * outside these is left off the Yoga node, so a case that commits one is not compared.
 */
const LENGTH = (value: unknown) =>
  typeof value === 'number' || value === 'auto' || /^-?[\d.]+%$/.test(String(value));
const EDGE_SUFFIXES = [
  ...['', 'Horizontal', 'Vertical', 'Block', 'Inline', 'BlockStart', 'BlockEnd'],
  ...['Top', 'Right', 'Bottom', 'Left', 'Start', 'End'],
];
const MODELLED: Record<string, (value: unknown) => boolean> = {
  ...Object.fromEntries(
    ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexBasis'].map((k) => [
      k,
      LENGTH,
    ]),
  ),
  ...Object.fromEntries(
    EDGE_SUFFIXES.flatMap((s) => [
      [`margin${s}`, LENGTH],
      [`padding${s}`, (v: unknown) => typeof v === 'number' || /^-?[\d.]+%$/.test(String(v))],
      [`border${s}Width`, (v: unknown) => typeof v === 'number'],
    ]),
  ),
  ...Object.fromEntries(
    ['top', 'right', 'bottom', 'left', 'start', 'end'].map((k) => [
      k,
      (v: unknown) => typeof v === 'number' || /^-?[\d.]+%$/.test(String(v)),
    ]),
  ),
  ...Object.fromEntries(
    ['gap', 'rowGap', 'columnGap'].map((k) => [
      k,
      (v: unknown) => typeof v === 'number' || /^-?[\d.]+%$/.test(String(v)),
    ]),
  ),
  position: (v) => ['absolute', 'relative', 'static'].includes(v as string),
  flexDirection: (v) => ['row', 'column', 'row-reverse', 'column-reverse'].includes(v as string),
  flexWrap: (v) => ['wrap', 'nowrap', 'wrap-reverse'].includes(v as string),
  flex: (v) => typeof v === 'number',
  flexGrow: (v) => typeof v === 'number',
  flexShrink: (v) => typeof v === 'number',
  alignItems: (v) => ALIGN.has(v as string),
  alignSelf: (v) => ALIGN.has(v as string),
  alignContent: (v) => ALIGN.has(v as string),
  justifyContent: (v) =>
    ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'].includes(
      v as string,
    ),
  display: (v) => ['flex', 'none', 'contents'].includes(v as string),
  overflow: (v) => ['visible', 'hidden', 'scroll'].includes(v as string),
  aspectRatio: (v) => typeof v === 'number',
  boxSizing: (v) => ['border-box', 'content-box'].includes(v as string),
  direction: (v) => ['ltr', 'rtl', 'inherit'].includes(v as string),
};
const ALIGN = new Set([
  'auto',
  'flex-start',
  'center',
  'flex-end',
  'stretch',
  'baseline',
  'space-between',
  'space-around',
  'space-evenly',
]);
/** Committed props that are not layout, or that Yoga ignores, and so cannot move a box. */
const NOT_LAYOUT = new Set(['nativeID', 'mode', 'text', 'collapsable', 'collapsableChildren']);
const LAYOUT_WORD =
  /^(width|height|min|max|flex|margin|padding|border.*Width|top|right|bottom|left|start|end|inset|gap|rowGap|columnGap|position|align|justify|display|overflow|aspectRatio|boxSizing|direction)/;

function unmodelledProps(nodes: readonly FakeFabricNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.props)) {
      if (value === null || value === undefined || NOT_LAYOUT.has(key)) continue;
      if (!LAYOUT_WORD.test(key)) continue;
      const check = MODELLED[key];
      if (!check || !check(value)) out.push(`${key}: ${JSON.stringify(value)}`);
    }
    unmodelledProps(node.children, out);
  }
  return out;
}

/**
 * The font Chrome's screen has, ten pixels on a twenty pixel line, which every box inherits: a
 * line of boxes with no text is as tall as its strut of it.
 */
const SCREEN_FONT = ':root { font-size: 10px; line-height: 20px }';

export function layOutInPipeline(
  test: Case,
  conformance: Conformance = 'strict',
  backend: Backend = 'react-native',
): PipelineResult {
  const refused: string[] = [];
  const sheet = compileCss(`${SCREEN_FONT}\n${stylesheet(test.root)}`, 'case.css', {
    onUnsupported: (message) => refused.push(message),
  });
  const fabric = createYogaFabric(conformance, backend);
  const engine = new Engine(fabric, 1, {
    globalStyles: sheet,
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });
  const all = boxes(test.root);
  const created = new Map<string, EngineNode>();
  for (const { name, node, parent } of all) {
    const element = engine.createElement('view');
    engine.setClasses(element, name);
    engine.setProp(element, 'nativeID', name);
    const parentName = parent ? all.find((each) => each.node === parent)!.name : undefined;
    engine.appendChild(parentName ? created.get(parentName)! : engine.root, element);
    created.set(name, element);
    if (node.text !== undefined) {
      const text = engine.createElement('text');
      engine.appendChild(text, engine.createText(node.text));
      engine.appendChild(element, text);
    }
  }
  engine.commit();
  const skip = hidden(test.root);
  const rects = new Map<string, Rect>();
  for (const [node, { left, top, width, height }] of fabric.boxes()) {
    const name = node.props['nativeID'];
    if (typeof name === 'string' && !skip.has(name)) rects.set(name, [left, top, width, height]);
  }
  return {
    rects,
    refused,
    unmodelled: [...new Set(unmodelledProps(fabric.committed))],
    committed: describeCommitted(fabric.committed),
  };
}
