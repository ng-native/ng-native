/**
 * A `calc()` whose terms do not agree in type: a number added to a length. CSS finds the value
 * invalid wherever it is used. In a token, the property that reads it is unset, as Chrome unsets
 * it. Written in a declaration it is invalid whatever the tokens hold, so it is refused with a
 * warning at build, as a value of the wrong type written out is.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs') as {
  compileCss(source: string, context?: string, options?: object): StyleSheet;
};

/** The `.a` view's committed props, with the weaker rule `.a { width: 10px }` before. */
function props(css: string, tokens: Record<string, string> = {}, warnings: string[] = []) {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const sheet = compileCss(`.a { width: 10px; opacity: 0.5 } ${css}`, 'types.css', {
    onUnsupported: (message: string) => warnings.push(message),
  });
  const node = engine.createElement('view', sheet);
  engine.addClass(node, 'a');
  for (const [name, value] of Object.entries(tokens)) engine.setCustomProperty(node, name, value);
  engine.appendChild(engine.root, node);
  engine.commit();
  return fabric.committed[0]!.props;
}

describe('a calc() adding a number to a length', () => {
  it('in a token, gives the token no length: a width that reads it is unset', () => {
    assert.equal(props('.a { --t: calc(1px + 2); width: var(--t) }')['width'] ?? null, null);
  });

  for (const [what, css] of [
    ['around a length token', '.a { --t: 1px; width: calc(var(--t) + 2) }'],
    ['around a number token', '.a { --t: 1; width: calc(var(--t) + 2) }'],
    ['with two tokens', '.a { --t: 1px; --u: 2px; width: calc(var(--t) + var(--u) + 2) }'],
  ]) {
    it(`${what}, is refused with a warning, keeping the weaker width`, () => {
      const warnings: string[] = [];
      assert.equal(props(css!, {}, warnings)['width'], 10);
      assert.match(warnings.join(), /values of different types/);
    });
  }

  it('keeps what agrees: a length added to a length, and a number that multiplies one', () => {
    assert.equal(props('.a { --t: 1px; width: calc(var(--t) + 2px) }')['width'], 3);
    assert.equal(props('.a { --t: 3px; width: calc(var(--t) * 2) }')['width'], 6);
    assert.equal(props('.a { --n: 3; width: calc(var(--n) * 1px + 2px) }')['width'], 5);
    assert.equal(props('.a { --t: calc(1px + 2px); width: var(--t) }')['width'], 3);
    assert.equal(props('.a { --t: 1px; --u: 2px; width: calc(var(--t) + var(--u)) }')['width'], 3);
    // A number in front of the token, as Bootstrap writes a negative margin.
    assert.equal(props('.a { --t: 4px; width: calc(-0.5 * var(--t) + 5px) }')['width'], 3);
    assert.equal(props('.a { --t: 4px; width: calc(2 * (var(--t)) - 1px) }')['width'], 7);
    assert.equal(
      props('.a { --t: 8px; --u: 2px; width: calc(var(--t) / var(--u) * 1px) }')['width'],
      4,
    );
  });

  it('keeps a length added to a percentage, a group, and a square divided back', () => {
    // The percentage waits for layout, so the warning is what says it was taken.
    const warnings: string[] = [];
    const percent = props('.a { --gap: 10px; width: calc(var(--gap) + 50% + 2px) }', {}, warnings);
    assert.deepEqual(warnings, []);
    assert.notEqual(percent['width'], 10, 'not the weaker rule, which a dropped sum would leave');
    const group = props('.a { --t: 3px; width: calc(1px * (var(--t) / 1px + 2)) }');
    assert.equal(group['width'], 5);
    const square = props('.a { --t: 4px; width: calc(var(--t) + 1px * 2px / 1px) }');
    assert.equal(square['width'], 6);
  });

  it('refuses a mixed calc() in a shorthand side, keeping the weaker padding', () => {
    const warnings: string[] = [];
    const padding = props(
      '.a { padding: 3px } .a { --a: 1px; --b: 2px; padding: 1px calc(var(--a) + var(--b) + 2) }',
      {},
      warnings,
    );
    assert.equal(padding['paddingTop'], 3);
    assert.equal(padding['paddingRight'], 3, 'not the 0 the side was written as');
    assert.match(warnings.join(), /values of different types/);
  });

  it('keeps a number added to a line height token, which multiplies the font size', () => {
    const warnings: string[] = [];
    props('.a { --lh: 1.5; line-height: calc(var(--lh) + 0.5) }', {}, warnings);
    assert.deepEqual(warnings, []);
  });

  it('in a number, a length is the odd one: the opacity is unset', () => {
    assert.equal(
      props('.a { --o: calc(0.5px + 0.2); opacity: var(--o) }')['opacity'] ?? null,
      null,
    );
    assert.equal(props('.a { --o: calc(0.1 + 0.2); opacity: var(--o) }')['opacity'], 0.3);
    // A length divided by a length is a number, in a sheet's token and in one set on the element.
    assert.equal(props('.a { --o: calc(1px / 2px); opacity: var(--o) }')['opacity'], 0.5);
    assert.equal(props('.a { opacity: var(--o) }', { '--o': 'calc(1px / 2px)' })['opacity'], 0.5);
  });

  it('follows a token set on the element, which a token holding the mixed sum is too', () => {
    assert.equal(props('.a { width: calc(var(--t) + 2px) }', { '--t': '1px' })['width'], 3);
    assert.equal(
      props('.a { width: var(--t) }', { '--t': 'calc(1px + 2)' })['width'] ?? null,
      null,
    );
  });
});
