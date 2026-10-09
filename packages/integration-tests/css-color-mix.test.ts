/**
 * `color-mix(in <space>, var(--x) N%, transparent)`: a token at reduced opacity.
 *
 * This is what Tailwind emits for `bg-primary/90`, and a design system built on themed colours
 * writes little else - a hover shade, a disabled shade, a ring, a translucent border are all the
 * same colour at a different alpha. The colour itself cannot be known at build time, because
 * `--primary` is one value under `:root` and another under `.dark`, so the mix has to survive to
 * the device the way a plain `var()` already does.
 *
 * The transparent case stays an alpha on the token, which is what Tailwind writes. A mix with a
 * real colour is worked out on device in the space it names; see css-color-mix-device.test.ts.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { cleanup, render, type BoundQueries } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

describe('color-mix with a token', () => {
  let Host: Type<unknown>;
  let queries: BoundQueries;

  before(async () => {
    const mod = await compileFixture('fixtures/mixed.ts');
    Host = mod['MixHost'] as Type<unknown>;
  });

  const boot = async (css: string) => {
    queries = await render(Host, { globalStyles: compileCss(css, 'global') });
  };

  const node = (id: string) => queries.getByTestId(id);

  it('applies the percentage as alpha on the resolved token', async () => {
    await boot(':root { --brand: rgb(10, 20, 30) }');
    assert.equal(node('mixed').props['backgroundColor'], 'rgba(10, 20, 30, 0.9)');
  });

  it('resolves against the nearest definition, so a theme changes the colour', async () => {
    // The whole reason this cannot be folded at build time: one class down the tree redefines
    // the token, and the mix has to be recomputed from the new value.
    await boot(':root { --brand: rgb(10, 20, 30) }');
    assert.equal(node('themed-mixed').props['backgroundColor'], 'rgba(40, 50, 60, 0.9)');
  });

  it('multiplies rather than replaces an alpha the token already had', async () => {
    // A token already at 20%, faded to 90% of that: the two multiply, as a browser's mix does.
    await boot(':root { --brand: rgba(10, 20, 30, 0.2) }');
    assert.equal(node('mixed').props['backgroundColor'], 'rgba(10, 20, 30, 0.18)');
  });

  it('uses the fallback colour when the token is not defined', async () => {
    await boot(':root { }');
    assert.equal(node('fallback-mixed').props['backgroundColor'], 'rgba(1, 2, 3, 0.5)');
  });

  it('folds a literal mix, in the space it names', () => {
    // With no token in it, lightningcss computes the mix itself and hands back an `oklab()`,
    // which was refused. It is converted to sRGB now (see css-color-spaces.test.ts); faded
    // towards transparent, the colour is the one it started as, at a quarter of the alpha.
    const sheet = compileCss(
      '.a { background-color: color-mix(in oklab, rgb(10, 20, 30) 25%, transparent) }',
      'literal',
    );
    assert.equal(sheet.rules[0].declarations['backgroundColor'], 'rgba(10, 20, 30, 0.25)');
  });

  it('carries a mix of a token and a real colour to the device, in the space it names', () => {
    // Worked out there once the token is known: see css-color-mix-device.test.ts.
    const [declaration] = compileCss(
      '.a { background-color: color-mix(in oklab, var(--brand) 50%, rgb(0, 0, 0)) }',
      'two-colours',
    ).rules[0].deferred;
    assert.deepEqual(declaration.within, {
      __colour: {
        mix: {
          space: 'oklab',
          a: { reference: '--brand' },
          aPercentage: 50,
          b: { color: 'rgb(0, 0, 0)' },
        },
      },
    });
  });
});
