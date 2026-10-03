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
  it('numbers layers from the weakest, and leaves a rule in no layer unnumbered', () => {
    assert.deepEqual(
      layersOf('@layer a { .a { opacity: 1 } } @layer b { .b { opacity: 1 } } .c { opacity: 1 }'),
      {
        a: 0,
        b: 1,
        c: undefined,
      },
    );
  });

  it('puts the rules of a sheet with no layer in it exactly as before', () => {
    const sheet = compileCss('.a { opacity: 1 } .b { opacity: 0.5 }', 'plain');
    assert.ok((sheet.rules as Rule[]).every((rule) => !('layer' in rule)));
  });

  it("numbers a layer's nested layers before its own rules", () => {
    assert.deepEqual(
      layersOf(
        '@layer a { .own { opacity: 1 } @layer x { .x { opacity: 1 } } } @layer b { .b { opacity: 1 } }',
      ),
      { x: 0, own: 1, b: 2 },
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
