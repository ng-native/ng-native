/**
 * Custom properties, fully cascading.
 *
 * They are the one mechanism that lets a parent theme a child component's internals, which the
 * per-component scoping otherwise forbids, exactly as custom properties pierce shadow DOM on the
 * web. Values are converted at build time into every form a use site might want, so the device
 * only ever does a lookup: there is no CSS parser on device and there cannot be one.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine, StyleResolver, type StyleTarget } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, type BoundQueries } from '@ng-native/testing';
import { compileFixture } from './compile.ts';
import { committedProps } from './tailwind-cli.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

after(cleanup);

/**
 * What an element wearing `classes` resolves to, one level below the root, straight from the
 * resolver: the shortest path from a stylesheet to the value native would be sent.
 */
function resolvedStyle(css: string, classes: string[]): Record<string, unknown> {
  const target = (name: string, parent: StyleTarget | null, own: string[]): StyleTarget => ({
    name,
    parent,
    classes: new Set(own),
    props: {},
    sheet: null,
    hostSheet: null,
    styleCache: null,
    styleDirty: true,
  });
  const root = target('view', null, []);
  const node = target('text', root, classes);
  const resolver = new StyleResolver(compileCss(css, 'tokens'), {
    width: 400,
    height: 800,
    colorScheme: 'light',
  });
  return resolver.resolve(node, 1).style;
}

describe('tokens', () => {
  let Host: Type<unknown>;
  let queries: BoundQueries;

  before(async () => {
    const mod = await compileFixture(
      fileURLToPath(new URL('./fixtures/tokened.ts', import.meta.url)),
    );
    Host = mod['TokenHost'] as Type<unknown>;
  });

  const boot = async (css: string, conditions?: Record<string, unknown>) => {
    queries = await render(Host, {
      globalStyles: compileCss(css, 'global'),
      ...(conditions ? { conditions: conditions as never } : {}),
    });
  };

  const all = (id: string) => queries.getAllByTestId(id);

  it('resolves a token defined on :root in the global sheet', async () => {
    await boot(':root { --pad: 12px; --bg: rgb(1, 1, 1) }');
    const [plain] = all('inner');
    assert.equal(plain!.props['paddingTop'], 12);
    assert.equal(plain!.props['backgroundColor'], 'rgb(1, 1, 1)');
  });

  it('lets a nearer definition override it, across a component boundary', async () => {
    // `.themed` is declared by the parent and read by the child's own rules. This is the whole
    // point: no other kind of rule may reach into a child component like this.
    await boot(':root { --pad: 12px; --bg: rgb(1, 1, 1) }');
    const [, themed] = all('inner');
    assert.equal(themed!.props['paddingTop'], 4);
    assert.equal(themed!.props['backgroundColor'], 'rgb(2, 2, 2)');
  });

  it('uses the fallback when a token is not defined anywhere', async () => {
    await boot(':root { --pad: 12px; --bg: rgb(1, 1, 1) }');
    assert.equal(all('inner-text')[0]!.props['color'], 'rgb(3, 3, 3)');
  });

  it('prefers a defined token over the fallback', async () => {
    await boot(':root { --pad: 12px; --bg: rgb(1, 1, 1); --ink: rgb(4, 4, 4) }');
    assert.equal(all('inner-text')[0]!.props['color'], 'rgb(4, 4, 4)');
  });

  it('drops the declaration when there is no token and no fallback', async () => {
    await boot(':root { --bg: rgb(1, 1, 1) }');
    assert.equal(all('inner')[0]!.props['paddingTop'], undefined);
  });

  it('takes a font weight from a token, numeric or named', async () => {
    await boot(':root { --pad: 1px; --weight: 600 }');
    assert.equal(all('inner-text')[0]!.props['fontWeight'], '600');
    await boot(':root { --pad: 1px; --weight: bold }');
    assert.equal(all('inner-text')[0]!.props['fontWeight'], '700');
  });

  it('keeps the arithmetic around a token in em, as -tracking-wide negates one', () => {
    const css =
      ':root { --t: .025em } .a { font-size: 16px; letter-spacing: calc(var(--t) * -1) }' +
      '.b { font-size: 16px; letter-spacing: calc(var(--t) * 2 + 1px) }';
    assert.equal(resolvedStyle(css, ['a'])['letterSpacing'], -0.4);
    assert.equal(resolvedStyle(css, ['b'])['letterSpacing'], 1.8);
  });

  it('works out a token in em where it is used, against the font size there', async () => {
    // The typography tokens are letter-spacing in em. Sent as they were, native got an object
    // where it wanted a number, logged an error per text and drew no tracking at all.
    await boot(':root { --pad: 1px; --ls: -0.05em }');
    const spacing = all('inner-text')[0]!.props['letterSpacing'] as number;
    assert.ok(Math.abs(spacing + 1) < 1e-6, `-0.05em of 20px is -1, got ${spacing}`);
  });

  it('reads a colour CSS has no property for, such as tint-color, from a token or as written', () => {
    // lightningcss does not know `tint-color`, so it arrives unparsed; the image and symbol views
    // take it all the same, and a theme has to be able to set it.
    const token = compileCss('view { tint-color: var(--ink, #00ff00) }').rules[0];
    assert.deepEqual(token.deferred, [
      { props: ['tintColor'], kind: 'color', reference: '--ink', fallback: 'rgb(0, 255, 0)' },
    ]);
    const plain = compileCss('view { tint-color: #ff0000 }').rules[0];
    assert.equal(plain.declarations.tintColor, 'rgb(255, 0, 0)');
  });

  it('writes every side of a four-sided shorthand, since a token is single-valued', () => {
    const { rules } = compileCss('view { padding: var(--pad) }');
    assert.deepEqual(rules[0].deferred[0].props, [
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
    ]);
  });

  it('refuses var() in a shorthand whose target genuinely depends on the value', () => {
    // `border: var(--x)` could be a width, a style or a colour, and nothing on device can parse
    // the substituted text to find out.
    assert.throws(() => compileCss('view { border: var(--b) }'), /shorthand/i);
    assert.throws(() => compileCss('view { font: var(--f) }'), /shorthand/i);
  });

  describe('with !important', () => {
    // A declaration whose value is settled on device - a var(), an em, a vw - kept no trace of its
    // `!important`. It lost to any later plain declaration and beat every earlier important one:
    // Bootstrap's `.fs-1` stayed at `calc(1.375rem + 1.5vw)` above the breakpoint where its own
    // `@media` rule says `2.5rem !important`, which Chrome takes.
    const css =
      ':root { --x: rgb(1, 1, 1) } .a { color: var(--x) !important } .a.b { color: red }' +
      '.c { color: rgb(2, 2, 2) !important } .c.d { color: var(--x) }' +
      '.e { font-size: calc(1rem + 1vw) !important } .e.f { font-size: 40px !important }' +
      '.g { font-size: 30px !important } .g.h { font-size: 2em !important }';

    it('beats a later plain declaration', () => {
      assert.equal(resolvedStyle(css, ['a', 'b'])['color'], 'rgb(1, 1, 1)');
    });

    it('is beaten, when it is not important, by an earlier important one', () => {
      assert.equal(resolvedStyle(css, ['c', 'd'])['color'], 'rgb(2, 2, 2)');
    });

    it('loses to a later important declaration, and beats an earlier one', () => {
      assert.equal(resolvedStyle(css, ['e', 'f'])['fontSize'], 40);
      assert.equal(resolvedStyle(css, ['g', 'h'])['fontSize'], 32);
    });
  });

  describe('in the forms real design systems write them', () => {
    // Found by compiling Bootstrap, Pico, Bulma and Open Props: each of these is a token every one
    // of them defines, and each was dropped - at build time with a misleading reason, or on device
    // with none at all.

    it('reads a font stack as its first family, as font-family itself does', () => {
      // `font-family: var(--x)` was refused as "a shorthand", and a stack was not a token at all.
      const css =
        ':root { --sans: system-ui, -apple-system, "Segoe UI", sans-serif; --mono: "SF Mono" }' +
        '.a { font-family: var(--sans) } .b { font-family: var(--mono) }' +
        '.c { font-family: var(--missing, Menlo, monospace) } .d { font-family: var(--one) }' +
        ':root { --one: Inter }';
      assert.equal(resolvedStyle(css, ['a'])['fontFamily'], 'system-ui');
      assert.equal(resolvedStyle(css, ['b'])['fontFamily'], 'SF Mono');
      assert.equal(resolvedStyle(css, ['c'])['fontFamily'], 'Menlo');
      assert.equal(resolvedStyle(css, ['d'])['fontFamily'], 'Inter');
    });

    it('reads a unitless line-height token as a multiple of the font size', () => {
      // `--bs-body-line-height: 1.5` had no length form, so every `line-height: var()` built on
      // one resolved to nothing on device, silently. A browser reads it as 1.5 times the size.
      const css =
        ':root { --ratio: 1.5; --fixed: 20px } .a { font-size: 12px; line-height: var(--ratio) }' +
        '.b { font-size: 12px; line-height: var(--fixed) } .c { line-height: var(--none, 2) }';
      assert.equal(resolvedStyle(css, ['a'])['lineHeight'], 18);
      assert.equal(resolvedStyle(css, ['b'])['lineHeight'], 20);
      assert.equal(resolvedStyle(css, ['c'])['lineHeight'], 32, 'twice the default 16');
    });

    it('places each var() of a multi-value side shorthand on the sides it names', () => {
      // `padding: var(--bs-btn-padding-y) var(--bs-btn-padding-x)` is how Bootstrap sizes every
      // button, card and alert, and it was refused outright. A token is single-valued, so the
      // number of values - and so which sides each covers - is known here.
      const css =
        ':root { --y: 6px; --x: 12px; --r: 4px }' +
        '.a { padding: var(--y) var(--x) } .b { margin: 0 var(--x) 2px }' +
        '.c { border-radius: var(--r) 0 } .d { padding-inline: var(--x) }' +
        '.e { gap: var(--y) var(--x) } .f { margin: var(--y) auto }';
      const a = resolvedStyle(css, ['a']);
      assert.deepEqual(
        [a['paddingTop'], a['paddingRight'], a['paddingBottom'], a['paddingLeft']],
        [6, 12, 6, 12],
      );
      const b = resolvedStyle(css, ['b']);
      assert.deepEqual(
        [b['marginTop'], b['marginRight'], b['marginBottom'], b['marginLeft']],
        [0, 12, 2, 12],
      );
      const c = resolvedStyle(css, ['c']);
      assert.deepEqual(
        [
          c['borderTopLeftRadius'],
          c['borderTopRightRadius'],
          c['borderBottomRightRadius'],
          c['borderBottomLeftRadius'],
        ],
        [4, 0, 4, 0],
      );
      const d = resolvedStyle(css, ['d']);
      assert.deepEqual([d['paddingLeft'], d['paddingRight']], [12, 12]);
      const e = resolvedStyle(css, ['e']);
      assert.deepEqual([e['rowGap'], e['columnGap']], [6, 12]);
      assert.equal(resolvedStyle(css, ['f'])['marginLeft'], 'auto');
    });

    it('reads calc() around a var() as one value of a multi-value shorthand', () => {
      // Pico's `padding: calc(var(--pico-spacing) * .5) var(--pico-spacing)`. The arithmetic was
      // understood for a single value and refused as one of several.
      const css =
        ':root { --s: 16px } .a { padding: calc(var(--s) * .5) var(--s) }' +
        '.b { margin: 0 calc(var(--s) + 4px) }';
      const a = resolvedStyle(css, ['a']);
      assert.deepEqual([a['paddingTop'], a['paddingRight']], [8, 16]);
      assert.equal(resolvedStyle(css, ['b'])['marginLeft'], 20);
    });

    it('reads a border shorthand built from tokens, width and colour by what each token is', () => {
      // `border: var(--bs-border-width) solid var(--bs-border-color)`. Which var() is the width
      // and which the colour cannot be told from the position, so each is offered as both and the
      // token answers: a length has no colour form and a colour no length form.
      const css =
        ':root { --w: 2px; --c: rgb(1, 2, 3) }' +
        '.a { border: var(--w) solid var(--c) } .b { border-top: var(--w) solid var(--c) }' +
        '.c { border: 1px solid var(--missing, rgb(4, 5, 6)) }';
      const a = resolvedStyle(css, ['a']);
      assert.deepEqual(
        [a['borderTopWidth'], a['borderStyle'], a['borderLeftColor']],
        [2, 'solid', 'rgb(1, 2, 3)'],
      );
      const b = resolvedStyle(css, ['b']);
      assert.deepEqual([b['borderTopWidth'], b['borderTopColor']], [2, 'rgb(1, 2, 3)']);
      const c = resolvedStyle(css, ['c']);
      assert.deepEqual([c['borderRightWidth'], c['borderBottomColor']], [1, 'rgb(4, 5, 6)']);
      // A side still has native's one style to live with, and a value that is no length is not
      // placed on a side as one.
      assert.throws(
        () => compileCss('view { border-top: var(--w) dashed var(--c) }'),
        /one border/,
      );
      assert.throws(() => compileCss('view { padding: var(--w) red }'), /not a length/);
    });

    it('takes the style from a token too, as Bootstrap writes its .border', () => {
      // `border: var(--bs-border-width) var(--bs-border-style) var(--bs-border-color)`. With no
      // style written, the line was read as having none, which CSS draws as no border at all.
      const css =
        ':root { --w: 1px; --s: dashed; --c: rgb(1, 2, 3) } .a { border: var(--w) var(--s) var(--c) }';
      const a = resolvedStyle(css, ['a']);
      assert.deepEqual(
        [a['borderTopWidth'], a['borderStyle'], a['borderLeftColor']],
        [1, 'dashed', 'rgb(1, 2, 3)'],
      );
      // Written out with no style at all, there is none, and so no line: what a browser draws.
      const none = compileCss('view { border: 2px red }').rules[0].declarations;
      assert.deepEqual(
        [none.borderTopWidth, none.borderLeftWidth, none.borderStyle],
        [0, 0, 'none'],
      );
    });

    it('reads a unitless zero token as the length it is', () => {
      // `--bs-gutter-y: 0`. CSS allows a bare 0 wherever a length goes, and without a length form
      // every `margin-top: var(--bs-gutter-y)` on device resolved to nothing.
      const css = ':root { --zero: 0 } .a { padding-top: 4px } .a.b { padding-top: var(--zero) }';
      assert.equal(resolvedStyle(css, ['a', 'b'])['paddingTop'], 0);
    });

    it('reads a shadow token as the list box-shadow takes', () => {
      // `--bs-box-shadow-sm: 0 .125rem .25rem rgba(0, 0, 0, .075)` and `.shadow-sm { box-shadow:
      // var(--bs-box-shadow-sm) }`. A token of several parts had no form at all, and box-shadow
      // was refused as a shorthand, though it only ever lands in one native prop.
      const css =
        ':root { --sm: 0 .125rem .25rem rgba(0, 0, 0, .075); --two: inset 0 1px red, 0 2px 4px blue }' +
        '.a { box-shadow: var(--sm) } .b { box-shadow: var(--two) } .c { box-shadow: var(--none, 0 1px 2px red) }';
      assert.deepEqual(resolvedStyle(css, ['a'])['boxShadow'], [
        {
          offsetX: 0,
          offsetY: 2,
          blurRadius: 4,
          spreadDistance: 0,
          color: 'rgba(0, 0, 0, 0.075)',
          inset: false,
        },
      ]);
      const two = resolvedStyle(css, ['b'])['boxShadow'] as { inset: boolean }[];
      assert.deepEqual(
        two.map((shadow) => shadow.inset),
        [true, false],
      );
      assert.equal((resolvedStyle(css, ['c'])['boxShadow'] as unknown[]).length, 1, 'fallback');
      // A colour this cannot write back out leaves the token without a shadow form, not broken.
      assert.throws(
        () => compileCss(':root { --wide: 0 1px color(display-p3 0.5 0.2 0.2) }'),
        /cannot express in any form/,
      );
    });

    it('builds a colour from a token of bare channels, with an alpha of its own', () => {
      // Every Bootstrap colour utility: `--bs-primary-rgb: 13, 110, 253` and
      // `.text-primary { color: rgba(var(--bs-primary-rgb), var(--bs-text-opacity)) }`, where a
      // second class sets the opacity token. Refused as var() mixed with other values.
      const css =
        ':root { --rgb: 13, 110, 253 } .a { --op: 1; color: rgba(var(--rgb), var(--op)) }' +
        '.a.half { --op: .5 } .b { background-color: rgba(var(--rgb), .25) }' +
        '.c { color: RGBA(var(--rgb), var(--missing, .3)) } .d { color: rgb(var(--rgb)) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(13, 110, 253)');
      assert.equal(resolvedStyle(css, ['a', 'half'])['color'], 'rgba(13, 110, 253, 0.5)');
      assert.equal(resolvedStyle(css, ['b'])['backgroundColor'], 'rgba(13, 110, 253, 0.25)');
      assert.equal(resolvedStyle(css, ['c'])['color'], 'rgba(13, 110, 253, 0.3)');
      assert.equal(resolvedStyle(css, ['d'])['color'], 'rgb(13, 110, 253)');
    });

    it('builds a colour from a token of space-separated channels, as Tailwind 3 and shadcn do', () => {
      // Tailwind 3's docs write `--primary: 255 115 179` and `rgb(var(--primary) / <alpha-value>)`;
      // shadcn writes `--primary: 0 100% 50%` and `hsl(var(--primary))`.
      const css =
        ':root { --rgb: 13 110 253; --hsl: 0 100% 50% }' +
        '.a { color: rgb(var(--rgb)) } .b { color: rgb(var(--rgb) / .5) }' +
        '.c { color: hsl(var(--hsl)) } .d { --op: .25; color: hsla(var(--hsl) / var(--op)) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(13, 110, 253)');
      assert.equal(resolvedStyle(css, ['b'])['color'], 'rgba(13, 110, 253, 0.5)');
      assert.equal(resolvedStyle(css, ['c'])['color'], 'rgb(255, 0, 0)');
      assert.equal(resolvedStyle(css, ['d'])['color'], 'rgba(255, 0, 0, 0.25)');
    });

    it('reads channels only through the function CSS takes them in, clamped as CSS clamps', () => {
      const css =
        ':root { --pct: 100% 0% 0%; --num: 240 100 50; --hsl: 0 100% 50%; --bs: 13, 110, 253;' +
        '--over: 0 200% 50%; --deg: 240deg 100% 50%; --big: 300 0 0 }' +
        '.a { color: rgb(var(--pct)) } .b { color: hsl(var(--num)) }' +
        '.c { color: rgb(var(--hsl)) } .d { color: hsl(var(--bs)) }' +
        '.e { color: hsl(var(--over)) } .f { color: rgb(var(--num)) }' +
        '.g { color: hsl(var(--deg)) } .h { color: rgb(var(--big)) }';
      const colour = (name: string) => resolvedStyle(css, [name])['color'];
      assert.equal(colour('a'), 'rgb(255, 0, 0)', 'percentages are of 255 in rgb()');
      assert.equal(colour('b'), 'rgb(0, 0, 255)', 'numbers are percentages in a space hsl()');
      assert.equal(colour('c'), undefined, 'rgb() takes no mix of numbers and percentages');
      assert.equal(colour('d'), undefined, "a comma hsl()'s saturation has to be a percentage");
      assert.equal(colour('e'), 'rgb(255, 0, 0)', 'saturation clamps at 100%');
      assert.equal(colour('f'), 'rgb(240, 100, 50)');
      assert.equal(colour('g'), 'rgb(0, 0, 255)', 'a hue in degrees');
      assert.equal(colour('h'), 'rgb(255, 0, 0)', 'a channel clamps at 255');
    });

    it('keeps a list of numbers every other form it has, such as a shadow', () => {
      // Read as channels first, `--s: 0 0 0` lost the shadow form it had always had.
      const css = ':root { --s: 0 0 0 } .a { box-shadow: var(--s) }';
      assert.deepEqual(resolvedStyle(css, ['a'])['boxShadow'], [
        { offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 0, color: 'black', inset: false },
      ]);
    });

    it('works out a token defined as calc() of another where it is defined', () => {
      // `translate-x-4` sets `--tw-translate-x: calc(var(--spacing) * 4)` for `translate` to read.
      const css =
        ':root { --s: 4px; --n: 2 } .a { --t: calc(var(--s) * 6); padding-top: var(--t) }' +
        '.b { --m: calc(var(--n) * 3); flex-grow: var(--m) }';
      assert.equal(resolvedStyle(css, ['a'])['paddingTop'], 24);
      assert.equal(resolvedStyle(css, ['b'])['flexGrow'], 6);
    });

    it('adds a percentage to a token of one, as Open Props strengthens a shadow', () => {
      // `--shadow-strength-4: calc(var(--shadow-strength) + 3%)`, read as an alpha: 1% + 3%. Chrome
      // draws the card's shadow in rgba(37, 38, 39, 0.04).
      const css =
        ':root { --strength: 1%; --strength-4: calc(var(--strength) + 3%); --c: 220 3% 15% }' +
        '.a { background-color: hsl(var(--c) / var(--strength-4)) }';
      assert.equal(resolvedStyle(css, ['a'])['backgroundColor'], 'rgba(37, 38, 39, 0.04)');
      const refused: string[] = [];
      compileCss(':root { --s: 4px } .b { padding-top: calc(var(--s) + 3%) }', 'length', {
        onUnsupported: (message: string) => refused.push(message),
      });
      assert.equal(refused.length, 1, "a length's percentage needs layout, and stays refused");
    });

    it('takes the larger or smaller of two values that are both tokens', () => {
      // `pt-safe-or-4`: the safe-area inset, or the spacing scale's 4, whichever is larger.
      const rule =
        '.a { padding-top: max(var(--inset, 0px), calc(var(--s) * 4));' +
        'padding-bottom: min(var(--inset, 0px), calc(var(--s) * 4)) }';
      const without = resolvedStyle(`:root { --s: 4px } ${rule}`, ['a']);
      const inset = resolvedStyle(`:root { --s: 4px; --inset: 20px } ${rule}`, ['a']);
      assert.deepEqual([without['paddingTop'], without['paddingBottom']], [16, 0]);
      assert.deepEqual([inset['paddingTop'], inset['paddingBottom']], [20, 16]);
    });

    it("reads a transition's timing from tokens, as Tailwind's default duration and easing", () => {
      const css =
        ':root { --d: 300ms; --e: cubic-bezier(0.4, 0, 0.2, 1); --l: linear; --w: .05s }' +
        '.a { transition-property: opacity; transition-duration: var(--d);' +
        'transition-timing-function: var(--e); transition-delay: var(--w) }' +
        '.b { transition-timing-function: var(--l) } .c { transition-duration: var(--none, 20ms) }';
      const a = resolvedStyle(css, ['a']);
      assert.equal(a['$transitionDuration'], 300);
      assert.deepEqual(a['$transitionEasing'], [0.4, 0, 0.2, 1]);
      assert.equal(a['$transitionDelay'], 50);
      assert.ok((a['$transition'] as Record<string, unknown>)['opacity'], 'the property list');
      assert.deepEqual(resolvedStyle(css, ['b'])['$transitionEasing'], [0, 0, 1, 1]);
      assert.equal(resolvedStyle(css, ['c'])['$transitionDuration'], 20);
    });

    it('plays an animation a token holds, as Tailwind writes animate-spin', () => {
      const css =
        ':root { --an: spin 1s linear infinite } @keyframes spin { to { rotate: 360deg } }' +
        '.a { animation: var(--an) } .b { animation: spin 1s linear infinite }' +
        '.c { animation: var(--missing, spin 2s) }';
      const b = resolvedStyle(css, ['b'])['$animation'];
      assert.ok(b);
      assert.deepEqual(resolvedStyle(css, ['a'])['$animation'], b);
      assert.equal(
        (resolvedStyle(css, ['c'])['$animation'] as { duration: number }).duration,
        2000,
      );
    });

    it("does not read one of Tailwind's own slots as an animation, which none of them holds", () => {
      // `inset-shadow-[200ms]` is `--tw-inset-shadow: inset 200ms`: an animation named inset, to a
      // parser, and a shadow that is not one, which has to be reported rather than kept.
      const refused: string[] = [];
      compileCss('.a { --tw-inset-shadow: inset 200ms }', 'slot', {
        onUnsupported: (message: string) => refused.push(message),
      });
      assert.equal(refused.length, 1);
    });

    it('draws a blur and a drop shadow a filter slot takes from the theme', () => {
      // `blur-sm` is `--tw-blur: blur(var(--blur-sm))`; `drop-shadow-xs` is
      // `--tw-drop-shadow: drop-shadow(var(--drop-shadow-xs))`. Both draw on Android only.
      const css =
        ':root { --b: 8px; --ds: 0 1px 1px rgb(0 0 0 / 0.05) }' +
        '.platform-android .a { --tw-blur: blur(var(--b)); ' +
        '--tw-drop-shadow: drop-shadow(var(--ds)); filter: var(--tw-blur,) var(--tw-drop-shadow,) }';
      const fabric = createFakeFabric();
      const engine = new Engine(fabric, 1, { globalStyles: compileCss(css, 'filters') });
      const phone = engine.createElement('view');
      const node = engine.createElement('view');
      engine.setClasses(phone, 'platform-android');
      engine.setClasses(node, 'a');
      engine.appendChild(phone, node);
      engine.appendChild(engine.root, phone);
      engine.commit();
      assert.deepEqual(committedProps(fabric, node)['filter'], [
        { blur: 8 },
        {
          dropShadow: {
            offsetX: 0,
            offsetY: 1,
            standardDeviation: 1,
            color: 'rgba(0, 0, 0, 0.05)',
          },
        },
      ]);
    });

    it('builds a colour token from a color-mix() of another, as Tailwind colours a shadow', () => {
      // `shadow-red-500` is `--tw-shadow-color: color-mix(in oklab, var(--color-red-500) 100%,
      // transparent)`, read by the shadow; the same mix written where it is used is the oracle.
      const css =
        ':root { --brand: rgb(255, 0, 0) }' +
        '.a { --c: color-mix(in oklab, var(--brand) 50%, transparent); color: var(--c) }' +
        '.b { color: color-mix(in oklab, var(--brand) 50%, transparent) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], resolvedStyle(css, ['b'])['color']);
      assert.ok(resolvedStyle(css, ['b'])['color'], 'the oracle is a colour');
    });

    it('builds a colour from hsl() whose channels are tokens, as Bulma writes every colour', () => {
      // `--bulma-text-strong: hsl(var(--bulma-text-h), var(--bulma-text-s),
      // var(--bulma-text-strong-l))`: a token whose value is a colour made of other tokens.
      const css =
        ':root { --h: 221deg; --s: 14%; --l: 21%; --text: hsl(var(--h), var(--s), var(--l)) }' +
        '.a { color: var(--text) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(46, 51, 61)');
    });

    it('reads hsla() and the space syntax with a slashed alpha, both as tokens', () => {
      // hsla() is a synonym for hsl() with the same argument grammar, and the modern space
      // syntax (`hsl(h s l / a)`) is how a sheet writes the alpha without commas.
      const css =
        ':root { --h: 221deg; --s: 14%; --l: 21%; --a: .5;' +
        '--comma: hsla(var(--h), var(--s), var(--l), var(--a));' +
        '--space: hsl(var(--h) var(--s) var(--l) / var(--a)) }' +
        '.a { color: var(--comma) } .b { color: var(--space) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], 'rgba(46, 51, 61, 0.5)');
      assert.equal(resolvedStyle(css, ['b'])['color'], 'rgba(46, 51, 61, 0.5)');
    });

    it('falls back a channel of an hsl() token when the token it names is undefined', () => {
      const css =
        ':root { --s: 14%; --l: 21%; --text: hsl(var(--missing, 221deg), var(--s), var(--l)) }' +
        '.a { color: var(--text) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(46, 51, 61)');
    });

    it('drops an hsl() token when one of its channels is not defined and has no fallback', () => {
      const css =
        ':root { --s: 14%; --l: 21%; --text: hsl(var(--missing), var(--s), var(--l)) }' +
        '.a { color: var(--text) }';
      assert.equal(resolvedStyle(css, ['a'])['color'], undefined);
    });

    it('reads a ratio token as the number aspect-ratio takes', () => {
      // Open Props' `--ratio-widescreen: 16/9`.
      const css = ':root { --wide: 16/9; --square: 1 } .a { aspect-ratio: var(--wide) }';
      assert.equal(resolvedStyle(css, ['a'])['aspectRatio'], 1.77778);
    });
  });

  describe('defined as another token', () => {
    // How a design system is written: a semantic token is a palette token by another name, and
    // dark mode redefines the semantic ones only.
    it('resolves an alias to the token it names', async () => {
      await boot(':root { --grey: rgb(5, 5, 5); --bg: var(--grey); --pad: 12px }');
      assert.equal(all('inner')[0]!.props['backgroundColor'], 'rgb(5, 5, 5)');
    });

    it('follows a chain of aliases', async () => {
      await boot(':root { --c: 7px; --b: var(--c); --pad: var(--b); --bg: rgb(1, 1, 1) }');
      assert.equal(all('inner')[0]!.props['paddingTop'], 7);
    });

    it('uses the alias fallback when the token it names is not defined', async () => {
      await boot(':root { --bg: var(--missing, rgb(6, 6, 6)); --pad: 1px }');
      assert.equal(all('inner')[0]!.props['backgroundColor'], 'rgb(6, 6, 6)');
    });

    it('takes the definition a media query switches to', async () => {
      const css =
        ':root { --light: rgb(250, 250, 250); --dark: rgb(10, 10, 10); --bg: var(--light) }' +
        '@media (prefers-color-scheme: dark) { :root { --bg: var(--dark) } }';
      await boot(css, { colorScheme: 'dark' });
      assert.equal(all('inner')[0]!.props['backgroundColor'], 'rgb(10, 10, 10)');
    });

    it('treats a cycle as undefined rather than hanging', async () => {
      await boot(':root { --a: var(--b); --b: var(--a); --pad: var(--a); --bg: rgb(1, 1, 1) }');
      assert.equal(all('inner')[0]!.props['paddingTop'], undefined);
    });
  });
});

describe('a var() whose fallback is another var()', () => {
  // The fallback was read in the form the use site needed, and a var() has no form until it is
  // looked up, so 'var(--a, var(--b, green))' had no fallback at all and painted nothing.
  it('tries each token in turn, then the written fallback', () => {
    const css = '.x { color: var(--a, var(--b, rgb(0, 128, 0))) }';
    assert.equal(resolvedStyle(css, ['x'])['color'], 'rgb(0, 128, 0)');
    assert.equal(
      resolvedStyle(`:root { --b: rgb(1, 2, 3) } ${css}`, ['x'])['color'],
      'rgb(1, 2, 3)',
    );
    assert.equal(
      resolvedStyle(`:root { --a: rgb(4, 5, 6); --b: rgb(1, 2, 3) } ${css}`, ['x'])['color'],
      'rgb(4, 5, 6)',
    );
  });

  it('works for a length, and with no written fallback at the end', () => {
    const css = ':root { --c: 9px } .x { padding-top: var(--a, var(--b, var(--c))) }';
    assert.equal(resolvedStyle(css, ['x'])['paddingTop'], 9);
    assert.equal(
      resolvedStyle('.x { padding-top: var(--a, var(--b)) }', ['x'])['paddingTop'],
      undefined,
    );
  });
});

describe('tokens worked out on device', () => {
  it('turns a negative hue the right way round the wheel', () => {
    const css =
      ':root { --h: -120deg; --text: hsl(var(--h), 100%, 50%) } .a { color: var(--text) }';
    assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(0, 0, 255)');
  });

  it('builds each sixth of the hue wheel from its own two channels', () => {
    const colour = (hue: number) =>
      resolvedStyle(
        `:root { --h: ${hue}deg; --text: hsl(var(--h), 100%, 50%) } .a { color: var(--text) }`,
        ['a'],
      )['color'];
    assert.deepEqual([30, 90, 150, 210, 270, 330].map(colour), [
      'rgb(255, 128, 0)',
      'rgb(128, 255, 0)',
      'rgb(0, 255, 128)',
      'rgb(0, 128, 255)',
      'rgb(128, 0, 255)',
      'rgb(255, 0, 128)',
    ]);
  });

  it('keeps the other sides of a var() shorthand when a later rule sets one of them', () => {
    const css = ':root { --p: 8px } .a { padding: var(--p) } .a.b { padding-top: 3px }';
    const style = resolvedStyle(css, ['a', 'b']);
    assert.deepEqual([style['paddingTop'], style['paddingLeft']], [3, 8]);
  });

  it('lets a var() declared !important beat a later rule that is not', () => {
    const css =
      ':root { --x: rgb(255, 0, 0); --y: rgb(0, 0, 255) }' +
      '.a { color: var(--x) !important } .a.b { color: var(--y) }';
    assert.equal(resolvedStyle(css, ['a', 'b'])['color'], 'rgb(255, 0, 0)');
  });

  it("places a gradient's colour stop where a token says", () => {
    const css =
      ':root { --start: red; --end: blue; --at: 30% }' +
      '.a { background-image: linear-gradient(var(--start) var(--at), var(--end)) }';
    const [gradient] = resolvedStyle(css, ['a'])['experimental_backgroundImage'] as {
      colorStops: { position: unknown }[];
    }[];
    assert.deepEqual(
      gradient!.colorStops.map((stop) => stop.position),
      ['30%', null],
    );
  });
});

describe('tokens the build reads', () => {
  it('keeps a font weight only from a token within the range weights have', () => {
    const tokens = (value: string) =>
      compileCss(`view { --w: ${value}; font-weight: var(--w, 400) }`).rules[0].tokens['--w'];
    assert.equal(tokens('900').weight, '900');
    assert.equal(tokens('1200').weight, undefined);
  });

  it('refuses a ratio with a zero divisor rather than making an enormous number of it', () => {
    assert.throws(() => compileCss('view { --r: 1/0 }'), /cannot express/);
  });

  it('subtracts and divides in calc() around a var(), on device', () => {
    const css =
      ':root { --x: 10px } .a { width: calc(var(--x) - 4px); height: calc(var(--x) / 2) }';
    const style = resolvedStyle(css, ['a']);
    assert.deepEqual([style['width'], style['height']], [6, 5]);
  });

  it("reads a turn in an hsl() channel's fallback as the hue it names", () => {
    const css = ':root { --text: hsl(var(--h, 0.5turn), 100%, 50%) } .a { color: var(--text) }';
    assert.equal(resolvedStyle(css, ['a'])['color'], 'rgb(0, 255, 255)');
  });
});
