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
  StyleResolver,
  type StyleSheet,
  type StyleTarget,
  type TokenValue,
} from '@ng-native/fabric';
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
    name: spec.name,
    parent,
    classes: new Set(spec.classes ?? []),
    // An id is `nativeID` here, which is the prop React Native gives a view for the purpose.
    props: { ...(spec.id ? { nativeID: spec.id } : {}), ...(spec.attrs ?? {}) },
    sheet: spec.scope === 'none' ? null : sheet,
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
]);

/** What native draws for a property nothing set, where it is not nothing. */
const NATIVE_INITIAL: Partial<Record<ExtraProperty, unknown>> = {
  'border-top-width': 0,
  'padding-top': 0,
  opacity: 1,
  'pointer-events': 'auto',
};

/** One of a case's extra properties against what the browser computed for it. */
function assertExtra(property: ExtraProperty, style: Record<string, unknown>, browser: string) {
  if (property === 'display') {
    // Native has flex, none and contents, and every view is flex when display is unset. What a
    // browser lays out as a block, inline or flow-root box is a flex column here. Any other
    // display, a grid or a table, is none native has, so it is left unset.
    if (!NATIVE_DISPLAY.has(browser)) {
      assert.equal(style['display'], undefined, `${property}: ${browser}`);
      return;
    }
    const native = ['none', 'contents'].includes(browser) ? browser : 'flex';
    assert.equal(style['display'] ?? 'flex', native, property);
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
  const ours = style[EXTRA_KEYS[property]] ?? NATIVE_INITIAL[property];
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

/** CSS property name to the React Native style key it lands in. */
const RN_KEY: Record<string, string> = { color: 'color', 'background-color': 'backgroundColor' };

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
      const nodes = build(test.tree as CaseNode, sheet, null, test.bound);
      const probe = nodes.find((node) => node.props['nativeID'] === 'probe')!;
      // Resolve every node, as a commit does, so inherited values and tokens flow down.
      const resolver = resolverFor(test);
      for (const node of nodes) resolver.resolve(node, 1);
      const style = resolver.resolve(probe, 1).style;

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
        assertExtra(property, style, expected.expected[property]!);
      }
    });
  });
});
