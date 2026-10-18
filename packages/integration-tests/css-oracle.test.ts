/**
 * The browser differential suite.
 *
 * Every other CSS test asserts a value I worked out by reading the spec, which can only ever be
 * as right as that reading. These assert what Chrome actually does with the same stylesheet and
 * the same tree, recorded once by `scripts/generate-css-oracle.mjs` and committed as a fixture, so
 * the tests stay pure `node --test` with no browser to install.
 *
 * Colours are the probe because `getComputedStyle` reports them in the same `rgb(r, g, b)` form
 * our own compiler emits, so what is compared is which declaration won, not how a value was
 * converted. Regenerate the fixture when adding a case.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import {
  Engine,
  StyleResolver,
  type EngineNode,
  type StyleSheet,
  type StyleTarget,
  type TokenValue,
} from '@ng-native/fabric';
import { NativeRendererFactory } from '@ng-native/platform';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { tokenFromValue } from '../fabric/src/inline-token.ts';
import {
  CASES,
  EXTRA_KEYS,
  INITIAL,
  PROPERTIES,
  type CaseNode,
  type ExtraProperty,
  type OracleCase,
} from './fixtures/css-oracle-cases.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const recorded = require('./fixtures/css-oracle.json') as {
  name: string;
  expected: Record<string, string>;
}[];

/**
 * Build the same tree the browser was given, as nodes the resolver understands. A node a None
 * component created has no sheet of its own, as the platform gives it none.
 */
function build(
  spec: CaseNode,
  sheet: StyleSheet,
  parent: StyleTarget | null,
  bound: OracleCase['bound'] = {},
): StyleTarget[] {
  const node: StyleTarget = {
    tag: spec.name,
    parent,
    classes: new Set(spec.classes ?? []),
    // An id is `nativeID` here, which is the prop React Native gives a view for the purpose.
    props: { ...(spec.id ? { nativeID: spec.id } : {}), ...(spec.attrs ?? {}) },
    templateSheet: spec.scope === 'none' ? null : sheet,
    hostSheet: null,
    styleCache: null,
    styleDirty: true,
    customProperties: spec.id === 'probe' ? boundTokens(bound) : null,
  };
  return [node, ...(spec.children ?? []).flatMap((child) => build(child, sheet, node, bound))];
}

/** Custom properties bound on an element, read as `Engine.setCustomProperty` reads them. */
function boundTokens(bound: Readonly<Record<string, string>>): Record<string, TokenValue> | null {
  const entries = Object.entries(bound).flatMap(([name, value]) => {
    const token = tokenFromValue(value);
    return token ? [[name, token] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * A resolver with the case's global sheet, and its None component's sheet registered as the
 * platform registers it when the component renders.
 */
function resolverFor(test: OracleCase): StyleResolver {
  const global = test.global === undefined ? null : (compileCss(test.global) as StyleSheet);
  const resolver = new StyleResolver(global, { width: 0, height: 0, colorScheme: 'light' });
  if (test.none !== undefined) resolver.addGlobalSheet(compileCss(test.none) as StyleSheet);
  return resolver;
}

/** The displays a browser computes that native has, or reads as flex. */
const NATIVE_DISPLAY: ReadonlySet<string> = new Set([
  'none',
  'contents',
  'flex',
  'inline-flex',
  'block',
  'inline',
  'inline-block',
  'flow-root',
  'grid',
  'inline-grid',
]);

/** The displays the cascade keeps as the browser computes them. */
const KEPT_DISPLAY: ReadonlySet<string> = new Set([
  'none',
  'contents',
  'block',
  'inline-block',
  'flow-root',
  'grid',
  'inline-flex',
  'inline-grid',
]);

/** What native draws for a property nothing set, where it is not nothing. */
const NATIVE_INITIAL: Partial<Record<ExtraProperty, unknown>> = {
  'border-top-width': 0,
  'padding-top': 0,
  opacity: 1,
  'pointer-events': 'auto',
};

/** One shadow in three props here: none is no blur, no offset and no colour to draw one in. */
function assertNoTextShadow(style: Record<string, unknown>, browser: string): void {
  assert.equal(browser, 'none', 'only none is compared');
  assert.equal(style['textShadowRadius'], 0);
  assert.deepEqual(style['textShadowOffset'], { width: 0, height: 0 });
  assert.equal(style['textShadowColor'], 'rgba(0, 0, 0, 0)');
}

/**
 * The props a native view reads a side, a corner or a gap from, the first set winning, as Yoga
 * and React Native read them: the side itself, its logical form, then each shorthand over it.
 */
function readFrom(property: ExtraProperty, style: Record<string, unknown>): string[] {
  const start = style['direction'] === 'rtl' ? 'End' : 'Start';
  const top = (box: string) => [
    `${box}Top`,
    `${box}BlockStart`,
    `${box}Block`,
    `${box}Vertical`,
    box,
  ];
  const keys: Partial<Record<ExtraProperty, string[]>> = {
    'padding-top': top('padding'),
    'margin-top': top('margin'),
    'padding-left': [
      ...[`paddingInline${start}`, `padding${start}`, 'paddingLeft'],
      ...['paddingInline', 'paddingHorizontal', 'padding'],
    ],
    top: ['top', 'insetBlockStart', 'insetBlock', 'inset'],
    'row-gap': ['rowGap', 'gap'],
    'border-top-width': ['borderTopWidth', 'borderWidth'],
    'border-top-color': [
      'borderTopColor',
      'borderBlockStartColor',
      'borderBlockColor',
      'borderColor',
    ],
    'border-top-left-radius': ['borderTopLeftRadius', `borderTop${start}Radius`, 'borderRadius'],
  };
  return keys[property] ?? [EXTRA_KEYS[property]];
}

/** One of a case's extra properties against what the browser computed for it. */
function assertExtra(property: ExtraProperty, style: Record<string, unknown>, browser: string) {
  if (property === 'display') {
    // Every view is flex when display is unset. A block container and a grid are kept as the
    // browser has them, for the engine to lay out, and so are none and contents and the boxes
    // that sit in a line; an inline box is a flex box. Any other display, a table say, is none
    // native has, so it is left unset.
    if (!NATIVE_DISPLAY.has(browser)) {
      assert.equal(style['display'], undefined, `${property}: ${browser}`);
      return;
    }
    const kept = KEPT_DISPLAY.has(browser) ? browser : 'flex';
    assert.equal(style['display'] ?? 'flex', kept, property);
    return;
  }
  // One family by name here, and the whole stack, quoted where it needs to be, in the browser.
  if (property === 'font-family') {
    // Chrome quotes a family that needs it, and escapes a quote or a backslash inside.
    const quoted = /^"((?:\\.|[^"\\])*)"/.exec(browser)?.[1]?.replace(/\\(.)/g, '$1');
    assert.equal(style['fontFamily'], quoted ?? browser.split(',')[0], property);
    return;
  }
  // A length is a number of points here, and `2px` in the browser. An unset one is native's
  // initial value, as the browser reports its own.
  const read = readFrom(property, style).map((key) => style[key]);
  const ours = read.find((value) => value != null) ?? NATIVE_INITIAL[property];
  const unit = property === 'opacity' ? '' : 'px';
  const value = typeof ours === 'number' ? `${ours}${unit}` : ours;
  assert.equal(value, legacyColour(browser), property);
}

/**
 * Chrome reports a `color-mix()` in sRGB as `color(srgb 0 0 1 / 0.35)`, channels from 0 to 1.
 * Native takes the same colour as `rgba(0, 0, 255, 0.35)`.
 */
function legacyColour(browser: string): string {
  const mixed = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(browser);
  if (!mixed) return browser;
  const channels = mixed.slice(1, 4).map((channel) => Math.round(Number(channel) * 255));
  const alpha = mixed[4];
  return alpha === undefined
    ? `rgb(${channels.join(', ')})`
    : `rgba(${channels.join(', ')}, ${alpha})`;
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

/**
 * What the probe commits with the case's inline declarations, set through the renderer as a
 * binding sets them, over the case's one sheet.
 */
function committed(test: OracleCase, sheet: StyleSheet): Record<string, unknown> {
  assert.equal(test.global ?? test.none ?? test.bound, undefined, 'an inline case has one sheet');
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
  const renderer = new NativeRendererFactory(engine).createRenderer(null, null);
  const add = (spec: CaseNode, parent: EngineNode): void => {
    const node = renderer.createElement(spec.name) as EngineNode;
    if (spec.classes) renderer.setAttribute(node, 'class', spec.classes.join(' '));
    if (spec.id) renderer.setAttribute(node, 'nativeID', spec.id);
    for (const [name, value] of Object.entries(spec.attrs ?? {})) {
      renderer.setAttribute(node, name, value);
    }
    if (spec.id === 'probe') {
      for (const [name, value] of Object.entries(test.inline!)) {
        renderer.setStyle(node, name, value);
      }
    }
    renderer.appendChild(parent, node);
    for (const child of spec.children ?? []) add(child, node);
  };
  add(test.tree, engine.root);
  engine.commit();
  return flatten(fabric.committed).find((node) => node.props['nativeID'] === 'probe')!.props;
}

/** CSS property name to the React Native style key it lands in. */
const RN_KEY: Record<string, string> = { color: 'color', 'background-color': 'backgroundColor' };

/** What the resolver settles for the probe, every node resolved as a commit resolves them. */
function resolved(test: OracleCase, sheet: StyleSheet): Record<string, unknown> {
  const nodes = build(test.tree, sheet, null, test.bound);
  const probe = nodes.find((node) => node.props['nativeID'] === 'probe')!;
  // Resolve every node, as a commit does, so inherited values and tokens flow down.
  const resolver = resolverFor(test);
  for (const node of nodes) resolver.resolve(node, 1);
  return resolver.resolve(probe, 1).style;
}

describe('what a browser does with the same stylesheet', () => {
  assert.equal(recorded.length, CASES.length, 'the fixture is stale; regenerate it');

  CASES.forEach((test, index) => {
    it(test.name, () => {
      const expected = recorded[index]!;
      assert.equal(expected.name, test.name, 'the fixture is out of step with the cases');

      // Strict, so a warning fails the case, unless the case expects the compiler to refuse part
      // of the sheet.
      const warnings: string[] = [];
      const onUnsupported = test.warns ? (message: string) => warnings.push(message) : undefined;
      const sheet = compileCss(test.css, test.name, { onUnsupported }) as StyleSheet;
      if (test.warns) assert.notEqual(warnings.length, 0, 'the compiler should refuse the value');
      const style = test.inline ? committed(test, sheet) : resolved(test, sheet);

      for (const property of PROPERTIES) {
        const browser = expected.expected[property]!;
        const ours = style[RN_KEY[property]!];
        if (browser === INITIAL[property]) {
          // The browser always reports a value; we report nothing when no rule set one, which
          // leaves the native default in place.
          assert.equal(ours, undefined, `${property}: no rule should have matched`);
        } else {
          assert.equal(ours, browser, property);
        }
      }
      for (const property of test.extra ?? []) {
        const browser = expected.expected[property]!;
        if (property === 'text-shadow') assertNoTextShadow(style, browser);
        else assertExtra(property, style, browser);
      }
    });
  });
});
