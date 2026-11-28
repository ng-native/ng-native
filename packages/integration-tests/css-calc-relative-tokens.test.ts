/**
 * A `calc()` of tokens where one token is a length in `em`, `rem` or a viewport unit, as a design
 * system writes its spacing: Taiga's `--t-offset: calc((var(--t-height) - var(--tui-lh)) / 2)`,
 * with `--tui-lh: 1.4em`. A browser substitutes each token where the sum is used and works the
 * `em` out against the font size there, so the same happens here, whether the sum is a
 * declaration or a custom property of its own.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

/** The props a view wearing `.a`, in a parent wearing `.p`, is committed with, under `css`. */
function propsOf(css: string): Record<string, unknown> {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css) as StyleSheet,
    conditions: { width: 320, height: 640, colorScheme: 'light' },
  });
  const parent = engine.createElement('view');
  engine.setClasses(parent, 'p');
  const view = engine.createElement('view');
  engine.setClasses(view, 'a');
  engine.appendChild(parent, view);
  engine.appendChild(engine.root, parent);
  engine.commit();
  return flatten(fabric.committed)[1]!.props;
}

describe('a calc() of tokens with one in em', () => {
  it('works the em out against the font size, in a declaration', () => {
    const css =
      '.a { font-size: 16px; --h: 56px; --l: 1.4em; padding-top: calc((var(--h) - var(--l)) / 2) }';
    assert.equal(propsOf(css)['paddingTop'], 16.8);
  });

  it('works the em out where a custom property holding the sum is used', () => {
    const css =
      '.p { --h: 56px; --l: 1.4em; --o: calc((var(--h) - var(--l)) / 2) }' +
      ' .a { font-size: 20px; padding-top: var(--o) }';
    // 1.4em of the 20px where it is used, not of anything where it is defined: (56 - 28) / 2.
    assert.equal(propsOf(css)['paddingTop'], 14);
  });

  it('adds em and points through more than one level of tokens', () => {
    const css =
      '.p { --o: calc((56px - var(--l)) / 2); --l: 1.4em }' +
      ' .a { font-size: 10px; top: calc((var(--o) + var(--l)) * 2) }';
    // ((56 - 14) / 2 + 14) * 2
    assert.equal(propsOf(css)['top'], 70);
  });

  it('scales a sum with em by a number on either side', () => {
    const css =
      '.a { font-size: 10px; --l: 2em; --n: 3; width: calc(var(--n) * (var(--l) + 1px)) }';
    assert.equal(propsOf(css)['width'], 63);
  });

  it('leaves a length multiplied by an em unworked, which is no length', () => {
    const at = (x: string) =>
      propsOf(
        `.a { font-size: 16px; --x: ${x}; --e: 1em; width: calc(var(--x) * 1em); height: calc(var(--x) * var(--e)); top: calc(var(--x) * 2 * 1em) }`,
      );
    assert.equal(at('2')['width'], 32);
    assert.equal(at('2')['height'], 32);
    assert.equal(at('2px')['width'], undefined);
    assert.equal(at('2px')['height'], undefined);
    assert.equal(at('2px')['top'], undefined);
    // A bare 0 is a number as well as a length: Tailwind's `--tw-space-y-reverse: 0`.
    assert.equal(at('0')['width'], 0);
  });

  it('works a viewport unit out against the screen, as it does an em', () => {
    const css = '.a { --v: 10vw; width: calc(var(--v) / 2 + 4px) }';
    assert.equal(propsOf(css)['width'], 20);
  });

  it('leaves a sum of em and a viewport unit unworked, which nothing here adds', () => {
    const css = '.a { font-size: 10px; --l: 2em; --v: 10vw; width: calc(var(--l) + var(--v)) }';
    assert.equal(propsOf(css)['width'], undefined);
  });

  it('still works a sum of points alone out', () => {
    const css = '.a { --h: 56px; --l: 22px; padding-top: calc((var(--h) - var(--l)) / 2) }';
    assert.equal(propsOf(css)['paddingTop'], 17);
  });
});

describe('a custom property holding clamp(), min() or max() of tokens', () => {
  // Taiga's `--t-zoom`: 0 at the font scale it is designed for, 1 from one and a half times it.
  const ZOOM =
    '.p { --t-zoom: clamp(0, (var(--scale, 1) - 1.4999) * 10000, 1) }' +
    ' .a { top: calc(10px * (1 - .15 * var(--t-zoom))) }';

  it('works the clamp out where it is used', () => {
    assert.equal(propsOf(ZOOM)['top'], 10);
  });

  it('follows the token the clamp reads', () => {
    assert.equal(propsOf(`${ZOOM} .p { --scale: 2 }`)['top'], 8.5);
  });

  it('works a clamp() of tokens out in a declaration too', () => {
    const css =
      '.a { --w: 70px; width: clamp(10px, var(--w), 50px); height: clamp(10px, var(--w) - 65px, 50px) }';
    const props = propsOf(css);
    assert.deepEqual([props['width'], props['height']], [50, 10]);
  });

  it('works min() and max() of tokens out too', () => {
    const css =
      '.p { --w: 30px; --lo: max(var(--w), 40px); --hi: min(var(--w), 20px) } .a { width: var(--lo); height: var(--hi) }';
    const props = propsOf(css);
    assert.deepEqual([props['width'], props['height']], [40, 20]);
  });
});

describe('a token holding a length', () => {
  it('is no font weight, whatever its number', () => {
    const css =
      '.p { --w: 1px; --x: 700 } .a { font-weight: var(--w); line-height: 1; } .p .a { --y: 1 }';
    assert.equal(propsOf(css)['fontWeight'], undefined);
    assert.equal(propsOf('.p { --x: 700 } .a { font-weight: var(--x) }')['fontWeight'], '700');
  });
});

describe('a calc() of tokens with an em or a viewport unit written in it', () => {
  it("works the em out against the font size, as Taiga UI centres a field's label", () => {
    const css =
      '.a { font-size: 16px; --t-height: 56px; padding-top: calc(var(--t-height) / 2 - .625em) }';
    assert.equal(propsOf(css)['paddingTop'], 18);
  });

  it('works a viewport unit out against the screen', () => {
    assert.equal(propsOf('.a { --w: 10px; width: calc(var(--w) + 10vw) }')['width'], 42);
  });

  it('leaves a sum of an em token and a vw written out unworked', () => {
    assert.equal(propsOf('.a { --l: 2em; width: calc(var(--l) + 10vw) }')['width'], undefined);
  });
});

describe('a calc() of tokens with a percentage in it', () => {
  it("is the share of the box it comes to, as Taiga UI centres a pin by a token's sign", () => {
    const css =
      ':root { --tui-inline: 1 } .a { transform: translate(calc(var(--tui-inline) * -50%), -50%) }';
    assert.deepEqual(propsOf(css)['transform'], [{ translateX: '-50%' }, { translateY: '-50%' }]);
    const rtl =
      ':root { --tui-inline: -1 } .a { transform: translate(calc(var(--tui-inline) * -50%), -50%) }';
    assert.deepEqual(propsOf(rtl)['transform'], [{ translateX: '50%' }, { translateY: '-50%' }]);
  });

  it('is a share of the box with points added, for a size', () => {
    assert.equal(propsOf('.a { --n: 2; width: calc(var(--n) * 25%) }')['width'], '50%');
  });
});

describe('a calc() of tokens with two units only the use site knows', () => {
  it('is refused with a warning at build time, as the device can work out one of them', () => {
    // A browser adds an em and a vw; the device keeps one such unit in a sum, and drops the rest.
    assert.throws(
      () => compileCss('.a { padding-top: calc(var(--x) + 1em + 1vw) }'),
      /'em' and 'vw'/,
    );
    assert.doesNotThrow(() => compileCss('.a { padding-top: calc(var(--x) + 1em + 2em) }'));
  });
});

describe('min(), max() or clamp() of tokens with an em or a viewport unit written in it', () => {
  it('is refused with a warning at build time, as the device compares points only', () => {
    for (const css of [
      '.a { width: min(var(--limit), 2em) }',
      '.a { width: max(var(--limit), 10vw) }',
      '.a { width: clamp(0px, var(--x), 1em) }',
    ]) {
      assert.throws(() => compileCss(css), /compares/, css);
    }
    assert.doesNotThrow(() => compileCss('.a { width: min(var(--limit), 20px) }'));
  });
});
