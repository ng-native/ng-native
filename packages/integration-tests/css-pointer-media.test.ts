/**
 * The pointer media features: `hover`, `any-hover`, `pointer` and `any-pointer`. A desktop answers
 * `hover` and `fine`, a phone `none` and `coarse`, and the engine reads them from its conditions,
 * which `currentConditions` fills in for the OS the app runs on.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type Conditions, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const PHONE: Conditions = { width: 390, height: 844, colorScheme: 'light' };
const DESK: Conditions = {
  ...PHONE,
  hover: 'hover',
  anyHover: 'hover',
  pointer: 'fine',
  anyPointer: 'fine',
};

function opacity(css: string, conditions: Conditions): unknown {
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {
    globalStyles: compileCss(css, 'app.css') as StyleSheet,
    conditions,
  });
  const box = engine.createElement('view');
  engine.setClasses(box, 'box');
  engine.appendChild(engine.root, box);
  engine.commit();
  const find = (nodes: readonly FakeFabricNode[]): FakeFabricNode | undefined => {
    for (const n of nodes) {
      if (n.props['opacity'] !== undefined) return n;
      const found = find(n.children);
      if (found) return found;
    }
    return undefined;
  };
  return find(fabric.committed)?.props['opacity'];
}

describe('the pointer media features', () => {
  for (const [query, desk, phone] of [
    ['(hover: hover)', 0.5, undefined],
    ['(hover: none)', undefined, 0.5],
    ['(hover)', 0.5, undefined],
    ['(any-hover: hover)', 0.5, undefined],
    ['(pointer: fine)', 0.5, undefined],
    ['(pointer: coarse)', undefined, 0.5],
    ['(pointer)', 0.5, 0.5],
    ['(pointer: none)', undefined, undefined],
    ['(any-pointer: fine)', 0.5, undefined],
    ['(any-pointer: coarse)', undefined, 0.5],
  ] as const) {
    it(`answers ${query} on a desktop and on a phone`, () => {
      const css = `@media ${query} { .box { opacity: 0.5 } }`;
      assert.equal(opacity(css, DESK), desk, 'desktop');
      assert.equal(opacity(css, PHONE), phone, 'phone, where a condition set leaves them out');
    });
  }

  it('refuses a value the feature does not have', () => {
    assert.throws(() => compileCss('@media (hover: fine) { .a { color: red } }'), /hover/);
  });
});
