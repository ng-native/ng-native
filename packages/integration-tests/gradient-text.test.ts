/**
 * `<gradient-text>`: a background drawn through the letters.
 *
 * The native view masks what is inside it by its first child and does not mask itself, so the
 * letters are that child and the background a stylesheet gives the element is painted on a view
 * behind them. A rule with `background-clip: text` is for this element alone.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { createRequire } from 'node:module';
import type { Type } from '@angular/core';
import { cleanup, render, screen, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

const IMAGE = 'experimental_backgroundImage';
const stops = (node: FakeFabricNode) =>
  (node.props[IMAGE] as { colorStops: { color: string }[] }[] | undefined)?.[0]?.colorStops.map(
    (stop) => stop.color,
  );

describe('gradient text', () => {
  let mod: Record<string, unknown>;
  type Host = {
    look: { set(value: string): void };
    tint: { set(value: string | null): void };
    word: { set(value: string): void };
  };

  before(async () => {
    mod = await compileFixture('fixtures/gradient-text.ts');
  });
  afterEach(cleanup);

  const mount = () => render<Host>(mod['GradientTextHost'] as Type<Host>);
  const parts = (id: string) => {
    const host = screen.getByTestId(id);
    const [letters, fill] = host.children;
    return { host, letters: letters!, fill: fill! };
  };

  it('commits the masked view, with the letters first and a view to fill them behind', async () => {
    await mount();
    const { host, letters, fill } = parts('mark');
    assert.equal(host.viewName, 'RNCMaskedView');
    assert.equal(host.children.length, 2);
    assert.equal(letters.viewName, 'Paragraph', 'the first child is the mask');
    assert.equal(fill.props['position'], 'absolute');
    assert.match((await mount()).fabric.render(), /RawText "Week "/);
  });

  it('paints the background the stylesheet gave the element on the fill, not on the element', async () => {
    await mount();
    const { host, fill } = parts('mark');
    assert.deepEqual(stops(fill), ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
    assert.equal(host.props[IMAGE], undefined, 'the view masks its children and not itself');
  });

  it('draws the letters in full, whatever colour the rule gave them, at the size it gave', async () => {
    await mount();
    const { letters } = parts('mark');
    assert.equal(letters.props['color'], 'rgb(0, 0, 0)', 'transparent letters would mask nothing');
    assert.equal(letters.props['fontSize'], 34);
  });

  it('follows the element to another background, and to none', async () => {
    const app = await mount();
    app.instance.look.set('warm');
    await app.detectChanges();
    assert.deepEqual(stops(parts('mark').fill), ['rgb(255, 255, 0)', 'rgb(255, 0, 0)']);
    assert.equal(parts('mark').letters.props['fontSize'], 20);

    app.instance.look.set('');
    await app.detectChanges();
    assert.equal(parts('mark').fill.props[IMAGE] ?? undefined, undefined);
  });

  it('takes a background from an inline style too, and loses it with it', async () => {
    const app = await mount();
    assert.equal(parts('inline').fill.props['backgroundColor'], 'rgb(0, 128, 0)');
    assert.equal(parts('inline').host.props['backgroundColor'], undefined);

    app.instance.tint.set(null);
    await app.detectChanges();
    assert.equal(parts('inline').fill.props['backgroundColor'] ?? undefined, undefined);
  });

  it('leaves a text with the same class as it was: the rule is for gradient text alone', async () => {
    await mount();
    const plain = screen.getByTestId('plain');
    assert.equal(plain.props[IMAGE], undefined);
    assert.equal(plain.props['color'], undefined, 'not transparent letters on a block of colour');
    assert.equal(plain.props['fontSize'], undefined);
  });

  it('is one element to a screen reader, read as text, by its letters', async () => {
    // iOS takes the mask out of the view hierarchy, so there is no text under the element for it
    // to read: without a label of its own VoiceOver does not find the element at all.
    const app = await mount();
    const { host } = parts('mark');
    assert.equal(host.props['accessible'], true);
    assert.equal(host.props['accessibilityRole'], 'text');
    assert.equal(host.props['accessibilityLabel'], 'Week now');

    app.instance.word.set('Month');
    await app.detectChanges();
    assert.equal(parts('mark').host.props['accessibilityLabel'], 'Month now');
  });

  it('keeps a label the app gave it', async () => {
    await mount();
    assert.equal(parts('named').host.props['accessibilityLabel'], 'Brand');
    assert.equal(parts('aria').host.props['accessibilityLabel'], 'Logo', 'by its web name too');
  });
});

describe('background-clip: text in a stylesheet', () => {
  const compile = (css: string) => {
    const warnings: string[] = [];
    const sheet = compileCss(css, 'clip', {
      onUnsupported: (message: string) => warnings.push(message),
    });
    return {
      rules: sheet.rules as {
        compounds: { type?: string; classes: string[] }[];
        declarations: Record<string, unknown>;
      }[],
      warnings,
    };
  };
  const clip =
    'background-image: linear-gradient(red, blue); background-clip: text; color: transparent';

  it('makes the rule one for gradient-text, and says nothing', () => {
    const { rules, warnings } = compile(`.brand { ${clip} }`);
    assert.deepEqual(warnings, []);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.compounds.at(-1)!.type, 'gradient-text');
    assert.equal('backgroundClip' in rules[0]!.declarations, false);
  });

  it('keeps a rule already written for the element, and scopes the last compound of a longer one', () => {
    const { rules, warnings } = compile(`gradient-text.brand { ${clip} } .card .brand { ${clip} }`);
    assert.deepEqual(warnings, []);
    assert.deepEqual(
      rules.map((rule) => rule.compounds.map((compound) => compound.type)),
      [['gradient-text'], [undefined, 'gradient-text']],
    );
  });

  it('drops a rule written for another element, and names the one to use', () => {
    const { rules, warnings } = compile(`text.brand { ${clip} } .other { opacity: 0.5 }`);
    assert.equal(rules.length, 1, 'the rule for a text is gone whole');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /background-clip: text.*<gradient-text>/);
  });

  it('still refuses the other values, which no native view has', () => {
    const { warnings } = compile('.a { background-clip: padding-box; opacity: 0.5 }');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /background-clip/);
  });
});
