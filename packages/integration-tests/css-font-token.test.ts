/**
 * `font: var(--token)`, where the token holds a whole `font` shorthand: how Taiga UI sets every
 * text style, `font: var(--tui-typography-body-m)` with `--tui-typography-body-m: normal
 * calc(var(--tui-font-offset) + 1rem) / calc(24 / 16) var(--tui-typography-family-text)`. The
 * token's parts are worked out where it is used, the tokens inside it with them, and the text is
 * set as the same `font` written out would set it.
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

const FONT = ['fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight'];

/** The font a text in a view wearing `.a`, in one wearing `.p`, is set in under `css`. */
function fontOf(css: string): Record<string, unknown> {
  const reports: string[] = [];
  const fabric = createFakeFabric();
  const sheet = compileCss(css, 'app.css', { onUnsupported: (m: string) => reports.push(m) });
  const engine = new Engine(fabric, 1, { globalStyles: sheet as StyleSheet });
  const parent = engine.createElement('view');
  engine.setClasses(parent, 'p');
  const text = engine.createElement('text');
  engine.setClasses(text, 'a');
  engine.appendChild(text, engine.createText('Aa'));
  engine.appendChild(parent, text);
  engine.appendChild(engine.root, parent);
  engine.commit();
  assert.deepEqual(reports, [], css);
  const props = flatten(fabric.committed).find((node) => node.viewName === 'Paragraph')!.props;
  return Object.fromEntries(FONT.map((key) => [key, props[key]]));
}

describe('font: var() of a token that holds a font shorthand', () => {
  it('sets the text as the shorthand written out does', () => {
    assert.deepEqual(
      fontOf(':root { --f: bold 20px/1.5 Manrope, system-ui } .a { font: var(--f) }'),
      fontOf('.a { font: bold 20px/1.5 Manrope, system-ui }'),
    );
    assert.deepEqual(
      fontOf(':root { --f: italic 500 1rem Manrope } .a { font: var(--f) }'),
      fontOf('.a { font: italic 500 1rem Manrope }'),
    );
  });

  it('reads a quoted family, as the shorthand written out does', () => {
    assert.deepEqual(
      fontOf(':root { --f: italic 20px "Open Sans" } .a { font: var(--f) }'),
      fontOf('.a { font: italic 20px "Open Sans" }'),
    );
    assert.deepEqual(
      fontOf(':root { --f: 20px "A \\"B\\"", serif } .a { font: var(--f) }'),
      fontOf('.a { font: 20px "A \\"B\\"", serif }'),
    );
  });

  it('takes a line height in percent or em of the size it sets', () => {
    assert.deepEqual(
      fontOf(':root { --size: 20px; --f: var(--size)/150% serif } .a { font: var(--f) }'),
      fontOf('.a { font: 20px/150% serif }'),
    );
    for (const height of ['150%', '1.5em']) {
      assert.deepEqual(
        fontOf(`.p { font-size: 10px } :root { --f: 2em/${height} serif } .a { font: var(--f) }`),
        fontOf(`.p { font-size: 10px } .a { font: 2em/${height} serif }`),
      );
    }
  });

  it('reads a family from a token at the head of a family list', () => {
    assert.deepEqual(
      fontOf(':root { --family: Manrope; --f: 20px var(--family), serif } .a { font: var(--f) }'),
      fontOf('.a { font: 20px Manrope, serif }'),
    );
    // A family after the first is never the one native takes.
    assert.deepEqual(
      fontOf(':root { --family: Manrope; --f: 20px serif, var(--family) } .a { font: var(--f) }'),
      fontOf('.a { font: 20px serif }'),
    );
  });

  it("takes a family token's fallback where the token is unset", () => {
    assert.deepEqual(
      fontOf(':root { --f: 20px var(--missing, Manrope) } .a { font: var(--f) }'),
      fontOf('.a { font: 20px Manrope }'),
    );
    assert.deepEqual(
      fontOf(':root { --fam: serif; --f: 20px var(--fam, Manrope) } .a { font: var(--f) }'),
      fontOf('.a { font: 20px serif }'),
    );
  });

  it("works out tokens inside the shorthand where it is used, as Taiga UI's typography has them", () => {
    const taiga =
      ':root { --t-font-offset: 0; --tui-font-offset: calc(var(--t-font-offset, 0) * 1px);' +
      " --tui-typography-family-text: 'Manrope', system-ui, sans-serif;" +
      ' --tui-typography-body-m: normal calc(var(--tui-font-offset) + 1rem) / calc(24 / 16)' +
      ' var(--tui-typography-family-text) } .a { font: var(--tui-typography-body-m) }';
    assert.deepEqual(fontOf(taiga), fontOf('.a { font: normal 16px / 1.5 Manrope }'));
    // The offset Taiga's font watcher sets on the root moves every size with it.
    assert.equal(fontOf(`${taiga} :root { --t-font-offset: 4 }`)['fontSize'], 20);
  });

  it('measures an em in it against the font size the text is in', () => {
    assert.deepEqual(
      fontOf('.p { font-size: 10px } :root { --f: 1.5em/1 Manrope } .a { font: var(--f) }'),
      fontOf('.p { font-size: 10px } .a { font: 1.5em/1 Manrope }'),
    );
  });

  it('follows the token a theme sets on an ancestor', () => {
    const css = ':root { --f: 12px Manrope } .p { --f: bold 30px Manrope } .a { font: var(--f) }';
    assert.deepEqual(fontOf(css), fontOf('.a { font: bold 30px Manrope }'));
  });

  it('works the tokens inside it out where it is defined, as a custom property inherits them', () => {
    assert.deepEqual(
      fontOf(
        '.p { --family: serif; --f: 20px var(--family) } .a { --family: Manrope; font: var(--f) }',
      ),
      fontOf('.a { font: 20px serif }'),
    );
    assert.deepEqual(
      fontOf('.p { --o: 0px; --f: calc(var(--o) + 20px) serif } .a { --o: 10px; font: var(--f) }'),
      fontOf('.a { font: 20px serif }'),
    );
    // An em in it is still measured where it is used.
    assert.deepEqual(
      fontOf(
        '.p { font-size: 10px; --o: 0px; --f: calc(var(--o) + 2em) serif } .a { font: var(--f) }',
      ),
      fontOf('.p { font-size: 10px } .a { font: 2em serif }'),
    );
  });

  it("takes the var()'s fallback where the token is not set, and the token where it is", () => {
    const written = fontOf('.a { font: bold 20px Manrope }');
    assert.deepEqual(fontOf('.a { font: var(--missing, bold 20px Manrope) }'), written);
    assert.deepEqual(
      fontOf(':root { --body: bold 20px Manrope } .a { font: var(--missing, var(--body)) }'),
      written,
    );
    assert.deepEqual(
      fontOf(':root { --body: bold 20px Manrope } .a { font: var(--body, 12px serif) }'),
      written,
    );
  });

  it('inherits the font where the token is not set, as an invalid font does', () => {
    assert.deepEqual(
      fontOf('.p { font: 13px Manrope } .a { font: var(--missing) }'),
      fontOf('.p { font: 13px Manrope }'),
    );
  });
});
