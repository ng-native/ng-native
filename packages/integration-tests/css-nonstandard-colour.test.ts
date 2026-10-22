/**
 * A colour CSS has no property for, `tint-color` (an image's or a symbol's colour) and
 * `shadow-color`, takes every value `color` does. lightningcss knows neither, so each arrives as raw
 * terms rather than the colour or the var() `color` arrives as, and was read as a colour or a
 * lone token only: a platform colour, a relative colour or a mix of a token, and a light-dark()
 * side holding either, were dropped as "not mapped yet" while `color` took them.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import {
  cleanup,
  compileCss,
  createFakeFabric,
  render,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

after(cleanup);

const BLUE = 'rgb(0, 0, 255)';
const RED = 'rgb(255, 0, 0)';
/** The properties that take a colour and that lightningcss does not know, by the prop each sets. */
const NONSTANDARD = { 'tint-color': 'tintColor', 'shadow-color': 'shadowColor' } as const;

/** One rule's compiled output, with `prop` renamed to `as`, and every warning collected. */
function compiled(css: string, prop?: string, as?: string) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'colour', { onUnsupported: (m: string) => warnings.push(m) });
  const rename = (key: string) => (key === prop ? as! : key);
  const rules = sheet.rules.map((rule) => ({
    condition: rule.condition,
    declarations: Object.fromEntries(
      Object.entries(rule.declarations).map(([key, value]) => [rename(key), value]),
    ),
    deferred: (rule.deferred ?? []).map((one) => ({ ...one, props: one.props.map(rename) })),
  }));
  return { rules, warnings };
}

describe('a colour CSS has no property for, compiled', () => {
  const VALUES = [
    'platform-color(link)',
    'platform-color(label, "?attr/colorForeground")',
    'rgb(from var(--blue-100) r g b / 0.85)',
    'oklch(from var(--blue-100) l c h / 0.5)',
    'color-mix(in srgb, var(--blue-100) 85%, transparent)',
    'color-mix(in oklab, var(--blue-100) 40%, var(--blue-500))',
    'light-dark(var(--blue-100), rgb(from var(--blue-500) r g b / 0.5))',
    'var(--blue-100)',
    'red',
  ];

  for (const [property, prop] of Object.entries(NONSTANDARD)) {
    for (const value of VALUES) {
      it(`reads ${property}: ${value} as color reads it`, () => {
        const colour = compiled(`.c { color: ${value} }`, 'color', prop);
        const other = compiled(`.c { ${property}: ${value} }`);
        assert.deepEqual(colour.warnings, [], 'color takes it');
        assert.deepEqual(other.warnings, []);
        assert.deepEqual(other.rules, colour.rules);
      });
    }
  }

  it('reads a system colour by its name, as color does', () => {
    for (const [property, prop] of Object.entries(NONSTANDARD)) {
      const colour = compiled('.c { color: LinkText }', 'color', prop);
      const other = compiled(`.c { ${property}: LinkText }`);
      assert.deepEqual(other.warnings, []);
      assert.deepEqual(other.rules, colour.rules);
    }
  });

  it('says a CSS-wide keyword is not implemented, rather than sending the word as a colour', () => {
    for (const property of Object.keys(NONSTANDARD)) {
      const { rules, warnings } = compiled(`.c { ${property}: inherit }`);
      assert.deepEqual(rules, []);
      assert.match(warnings.join('\n'), /CSS-wide keyword/);
    }
  });

  it('says a value no colour takes is not a value, rather than that the property is unknown', () => {
    const { warnings } = compiled('.c { tint-color: hsl(var(--h) 50% 50%) }');
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0]!, /not mapped yet/);
  });
});

/** A parent wearing `.p` around a child wearing `.a`, with every warning collected. */
function tree(css: string) {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'colour', { onUnsupported: (m: string) => warnings.push(m) });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const outer = engine.createElement('view', sheet);
  engine.addClass(outer, 'p');
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  engine.appendChild(outer, node);
  engine.appendChild(engine.root, outer);
  engine.commit();
  const props = () => fabric.committed[0]!.children[0]!.props;
  return { engine, outer, node, props, warnings };
}

describe('a colour CSS has no property for, on a device', () => {
  const MIXED = 'rgba(0, 0, 255, 0.85)';

  for (const [property, prop] of Object.entries(NONSTANDARD)) {
    it(`sends ${property}: platform-color() as the platform colour color sends`, () => {
      const value = 'platform-color(link)';
      const { props, warnings } = tree(`.a { color: ${value}; ${property}: ${value} }`);
      assert.deepEqual(warnings, []);
      assert.deepEqual(props()[prop], { semantic: ['link'] });
      assert.deepEqual(props()[prop], props()['color']);
    });

    it(`takes a platform colour on one side of a light-dark() in ${property}`, () => {
      const value = 'light-dark(platform-color(link), blue)';
      const { engine, props, warnings } = tree(`.a { color: ${value}; ${property}: ${value} }`);
      assert.deepEqual(warnings, []);
      assert.deepEqual(props()[prop], { semantic: ['link'] });
      engine.updateConditions({ width: 320, height: 640, colorScheme: 'dark' });
      engine.commit();
      // `color` sends the word as it was written, which processColor reads as the same colour.
      assert.equal(props()[prop], BLUE);
      assert.equal(props()['color'], 'blue');
      engine.updateConditions({ width: 320, height: 640, colorScheme: 'light' });
      engine.commit();
      assert.deepEqual(props()[prop], { semantic: ['link'] });
      assert.deepEqual(props()['color'], { semantic: ['link'] });
    });

    it(`takes ${property}: currentColor as the colour of the text, and follows it`, () => {
      const { engine, outer, props, warnings } = tree(
        `.p { color: ${RED} } .q { color: ${BLUE} } .a { ${property}: currentColor }`,
      );
      assert.deepEqual(warnings, []);
      assert.equal(props()[prop], RED);
      engine.removeClass(outer, 'p');
      engine.addClass(outer, 'q');
      engine.commit();
      assert.equal(props()[prop], BLUE);
    });

    it(`works out ${property} from a token, and follows it when it changes and goes`, () => {
      const mix = 'color-mix(in srgb, var(--blue-100) 85%, transparent)';
      const relative = 'rgb(from var(--blue-100) r g b / 0.85)';
      const { engine, outer, props, warnings } = tree(
        `.p { --blue-100: ${BLUE} } .a { color: ${mix}; ${property}: ${relative} }`,
      );
      assert.deepEqual(warnings, []);
      assert.equal(props()[prop], MIXED);
      assert.equal(props()['color'], MIXED);

      engine.setCustomProperty(outer, '--blue-100', RED);
      engine.commit();
      assert.equal(props()[prop], 'rgba(255, 0, 0, 0.85)');
      assert.equal(props()[prop], props()['color']);

      engine.removeClass(outer, 'p');
      engine.setCustomProperty(outer, '--blue-100', null);
      engine.commit();
      assert.equal(props()[prop] ?? null, null, 'unset once the token is');
      assert.equal(props()['color'] ?? null, null);
    });

    it(`takes ${property} from a token that holds a mix of another`, () => {
      const { engine, outer, props, warnings } = tree(
        `.p { --blue-100: ${BLUE}; --ring: color-mix(in srgb, var(--blue-100) 85%, transparent) } ` +
          `.a { ${property}: var(--ring) }`,
      );
      assert.deepEqual(warnings, []);
      assert.equal(props()[prop], MIXED);
      engine.setCustomProperty(outer, '--blue-100', RED);
      engine.commit();
      assert.equal(props()[prop], 'rgba(255, 0, 0, 0.85)');
    });
  }
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

describe('tint-color on a symbol', () => {
  it('tints it from a stylesheet and from a bound style, and follows the token', async () => {
    const MIXED = 'rgba(0, 0, 255, 0.85)';
    const mod = await compileFixture('fixtures/symbol-tint-values.ts');
    const app = await render(
      mod['SymbolTintValues'] as Type<{ blue: { set(value: string): void } }>,
      { processColor: (value) => value },
    );
    const tint = (id: string) =>
      flatten(app.fabric.committed).find((node) => node.props['nativeID'] === id)!.props[
        'tintColor'
      ];

    assert.deepEqual(tint('system'), { semantic: ['link'] });
    assert.equal(tint('relative'), MIXED);
    assert.equal(tint('mixed'), MIXED);
    assert.equal(tint('bound'), MIXED);

    app.instance.blue.set(RED);
    await settle();
    for (const id of ['relative', 'mixed', 'bound']) {
      assert.equal(tint(id), 'rgba(255, 0, 0, 0.85)', id);
    }
  });
});
