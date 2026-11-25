/**
 * Arithmetic on a token in a property that takes a number: `flex-grow`, `opacity`, and a
 * `line-height` that is a multiple of the font size. Chrome reads each; a length times a number
 * stays a length, as `leading-6` writes one from the spacing scale.
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

function view(css: string, name = 'view') {
  const warnings: string[] = [];
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const sheet = compileCss(css, 'numbers.css', { onUnsupported: (m: string) => warnings.push(m) });
  const node = engine.createElement(name, sheet);
  engine.addClass(node, 'a');
  engine.appendChild(engine.root, node);
  engine.commit();
  return { props: fabric.committed[0]!.props, warnings };
}

describe('arithmetic on a token, where a number is taken', () => {
  it('is read for flex-grow, as Chrome reads it', () => {
    const { props, warnings } = view('.a { --g: 2; flex-grow: calc(var(--g) * 1.5) }');
    assert.deepEqual(warnings, []);
    assert.equal(props['flexGrow'], 3);
  });

  it('is read for opacity', () => {
    const { props, warnings } = view('.a { --o: 1; opacity: calc(var(--o) / 2) }');
    assert.deepEqual(warnings, []);
    assert.equal(props['opacity'], 0.5);
  });

  it('is a multiple of the font size for line-height, from a number token', () => {
    const { props, warnings } = view(
      '.a { --l: 2; font-size: 10px; line-height: calc(var(--l) * 1.5) }',
      'text',
    );
    assert.deepEqual(warnings, []);
    assert.equal(props['lineHeight'], 30);
  });

  it('is a length for line-height from a length token, as leading-6 writes one', () => {
    const { props } = view(
      '.a { --spacing: 4px; font-size: 10px; line-height: calc(var(--spacing) * 6) }',
      'text',
    );
    assert.equal(props['lineHeight'], 24);
  });

  it('takes a length added to a token for line-height, and refuses a number added to a length', () => {
    const added = view('.a { --l: 10px; line-height: calc(var(--l) + 2px) }', 'text');
    assert.deepEqual(added.warnings, []);
    assert.equal(added.props['lineHeight'], 12);
    const mixed = view('.a { --l: 10px; line-height: calc(var(--l) + 2px + 1) }', 'text');
    assert.match(mixed.warnings.join(), /values of different types/);
  });

  it('is a length for line-height when the arithmetic gives a number token its unit', () => {
    const { props } = view(
      '.a { --n: 2; font-size: 10px; line-height: calc(var(--n) * 1px) }',
      'text',
    );
    assert.equal(props['lineHeight'], 2);
  });

  it('keeps a length a token times a dimension divided back comes to', () => {
    const fabric = view(
      '.a { --a: 4px; --b: 2px; --t: calc(var(--a) * 1px / 1px + var(--b)); width: var(--t) }',
    );
    assert.equal(fabric.props['width'], 6);
  });

  it("unsets flex-grow from a length token, which is no number: to 0, CSS's initial value", () => {
    const { props } = view('.a { flex-grow: 1 } .a { --g: 2px; flex-grow: calc(var(--g) * 2) }');
    assert.equal(props['flexGrow'], 0);
  });
});
