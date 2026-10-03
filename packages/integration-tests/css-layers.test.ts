/**
 * `@layer`: what a sheet's cascade layers compile to. Which rule wins is Chrome's to say, and is
 * in the oracle (`css-oracle-cases.ts`); this covers what the oracle does not measure.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

interface Rule {
  layer?: number;
  compounds: { classes?: string[] }[];
}

const layersOf = (css: string): Record<string, number | undefined> => {
  const warnings: string[] = [];
  const sheet = compileCss(css, 'layers', { onUnsupported: (m: string) => warnings.push(m) });
  assert.deepEqual(warnings, [], 'nothing is refused');
  return Object.fromEntries(
    (sheet.rules as Rule[]).map((rule) => [rule.compounds.at(-1)!.classes![0]!, rule.layer]),
  );
};

describe('@layer', () => {
  it('names each layer once, in the order first named, and marks each rule with its layer', () => {
    const sheet = compileCss(
      '@layer a { .a { opacity: 1 } } @layer b { .b { opacity: 1 } } .c { opacity: 1 } @layer a { .a2 { opacity: 1 } }',
      'layers',
    );
    assert.deepEqual(sheet.layers, [['a'], ['b']]);
    assert.deepEqual(
      layersOf('@layer a { .a { opacity: 1 } } @layer b { .b { opacity: 1 } } .c { opacity: 1 }'),
      {
        a: 0,
        b: 1,
        c: undefined,
      },
    );
  });

  it('leaves a sheet with no layer in it exactly as before', () => {
    const sheet = compileCss('.a { opacity: 1 } .b { opacity: 0.5 }', 'plain');
    assert.equal('layers' in sheet, false);
    assert.ok((sheet.rules as Rule[]).every((rule) => !('layer' in rule)));
  });

  it("names a nested layer by its path, and orders a layer's nested rules before its own", () => {
    const sheet = compileCss(
      '@layer a { .own { opacity: 1 } @layer x { .x { opacity: 1 } } } @layer b { .b { opacity: 1 } } @layer { .anon { opacity: 1 } }',
      'nested',
    );
    assert.deepEqual(sheet.layers.slice(0, 3), [['a'], ['a', 'x'], ['b']]);
    assert.match(sheet.layers[3][0], /^\0/, 'a block with no name has one nothing can write');
    assert.deepEqual(
      (sheet.rules as Rule[]).map((rule) => rule.compounds.at(-1)!.classes![0]),
      ['x', 'own', 'b', 'anon'],
      'weakest first',
    );
  });

  it('keeps @keyframes and @font-face written inside a layer', () => {
    const sheet = compileCss(
      `@layer motion {
        @keyframes spin { to { opacity: 0 } }
        @font-face { font-family: Inter; src: url(inter.ttf) }
        .a { animation: spin 1s }
      }`,
      'inside',
    );
    assert.ok(sheet.keyframes?.spin, 'the keyframes');
    assert.equal(sheet.fonts?.length, 1, 'the face');
    assert.equal(sheet.rules.length, 1);
  });

  it('takes @keyframes of one name from the strongest layer, as Chrome does', () => {
    // Chrome 154: one 0.2, two 0.5, three 0.7. The nesting pass settles it: lightningcss puts
    // the layers in their order before a rule here is read.
    const sheet = compileCss(
      `@layer a, b;
       @layer b { @keyframes one { to { opacity: 0.2 } } }
       @layer a { @keyframes one { to { opacity: 0.9 } } }
       @keyframes two { to { opacity: 0.5 } }
       @layer a { @keyframes two { to { opacity: 0.9 } } }
       @layer a { @keyframes three { to { opacity: 0.3 } } }
       @layer a { @keyframes three { to { opacity: 0.7 } } }`,
      'frames',
    );
    const last = (name: string) => sheet.keyframes[name].at(-1).declarations.opacity;
    assert.deepEqual([last('one'), last('two'), last('three')], [0.2, 0.5, 0.7]);
  });

  it('still says what it refuses inside a layer, and keeps the rest of the layer', () => {
    const warnings: string[] = [];
    const sheet = compileCss(
      '@layer a { .a { float: left; opacity: 0.5 } @supports (a: b) { .b { opacity: 1 } } .c { opacity: 1 } }',
      'refused',
      { onUnsupported: (m: string) => warnings.push(m) },
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /float/);
    assert.match(warnings.join('\n'), /@supports/);
    assert.equal(sheet.rules.length, 2);
  });

  it("keeps what a library ships in a layer: the CDK's overlay stacking and backdrop", () => {
    const warnings: string[] = [];
    const sheet = compileCss(
      `.cdk-overlay-pane { position: absolute }
       @layer cdk-overlay {
         .cdk-overlay-pane { z-index: 1000 }
         .cdk-overlay-dark-backdrop { background: rgba(0, 0, 0, 0.32) }
       }`,
      '@angular/cdk',
      { recover: true, onUnsupported: (m: string) => warnings.push(m) },
    );
    assert.deepEqual(warnings, []);
    const layered = (sheet.rules as (Rule & { declarations: Record<string, unknown> })[]).filter(
      (rule) => rule.layer === 0,
    );
    assert.deepEqual(
      layered.map((rule) => rule.declarations),
      [{ zIndex: 1000 }, { backgroundColor: 'rgba(0, 0, 0, 0.32)' }],
    );
  });
});
