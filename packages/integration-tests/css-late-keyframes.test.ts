/**
 * `@keyframes` from a sheet the commit meets after a node that names them.
 *
 * A component's sheet is registered when the first node it styles is committed. An element
 * committed before it, from another component, can name its keyframes, and a browser applies them
 * however the sheets arrived. The element animates from the first commit, and nothing warns that
 * they are missing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Engine, type StyleSheet } from '@ng-native/fabric';
import { compileCss, createFakeFabric, type FakeFabricNode } from '@ng-native/testing';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

function scene(dev = false) {
  let now = 1000;
  const warnings: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => void warnings.push(args.join(' '));
  try {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { now: () => now, dev });
    const above = compileCss('.p { animation: fade 1000ms linear }') as StyleSheet;
    const below = compileCss(
      '@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .c { width: 1px }',
    ) as StyleSheet;
    // Siblings, so the one naming the keyframes is committed before the sheet that has them.
    const named = engine.createElement('view', above);
    const later = engine.createElement('view', below);
    engine.addClass(named, 'p');
    engine.addClass(later, 'c');
    engine.appendChild(engine.root, named);
    engine.appendChild(engine.root, later);
    engine.commit();
    return {
      warnings,
      opacity: () => flatten(fabric.committed)[0]?.props['opacity'],
      tick(ms: number) {
        now += ms;
        engine.advanceAnimations();
        engine.commit();
      },
    };
  } finally {
    console.error = error;
  }
}

describe('keyframes from a sheet met later in the same commit', () => {
  it('play on the element that names them, from the first commit', () => {
    const { opacity, tick } = scene();
    assert.equal(opacity(), 0);
    tick(500);
    assert.equal(opacity(), 0.5);
  });

  it('are not reported missing in development', () => {
    assert.deepEqual(
      scene(true).warnings.filter((w) => /keyframes/i.test(w)),
      [],
    );
  });

  it('still reports a name no sheet has once the commit is over', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { dev: true });
    const errors: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void errors.push(args.join(' '));
    try {
      const node = engine.createElement(
        'view',
        compileCss('.p { animation: nowhere 1s }') as StyleSheet,
      );
      engine.addClass(node, 'p');
      engine.appendChild(engine.root, node);
      engine.commit();
    } finally {
      console.error = error;
    }
    assert.equal(errors.filter((e) => /no @keyframes named 'nowhere'/.test(e)).length, 1);
  });

  it('leave a face a later sheet declares in the same commit matched', () => {
    // The commit that plays them must not lose the font rematch the first one asked for.
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { now: () => 0 });
    const above = compileCss(
      '.t { font-family: Zig; font-weight: 700 } .p { animation: fade 1000ms linear }',
    ) as StyleSheet;
    const below = compileCss(
      "@font-face { font-family: Zig; src: url('./Zig.ttf'); font-weight: 700 } " +
        '@keyframes fade { from { opacity: 0 } to { opacity: 1 } } .c { width: 1px }',
    ) as StyleSheet;
    const text = engine.createElement('text', above);
    const named = engine.createElement('view', above);
    const later = engine.createElement('view', below);
    engine.addClass(text, 't');
    engine.addClass(named, 'p');
    engine.addClass(later, 'c');
    for (const node of [text, named, later]) engine.appendChild(engine.root, node);
    engine.commit();
    const [first, second] = flatten(fabric.committed);
    assert.equal(first?.props['fontFamily'], 'Zig-700');
    assert.equal(second?.props['opacity'], 0);
  });
});
