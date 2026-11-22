/**
 * A transform bound on an element as a string, which no build step converts.
 *
 * Chrome drops an inline transform it cannot read, and the transform a rule sets applies instead,
 * or none. CSS whitespace is a space, a tab, a newline, a carriage return or a form feed; a no-break
 * space is part of a word, so a value with one in it is unreadable. The expected values were read
 * from Chrome's `getComputedStyle` with the same rule and inline values.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

it('commits no length to measure from a style set as a whole', () => {
  for (const transform of ['translateX(1em)', 'translateX(calc(1vw + 1px))']) {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const node: EngineNode = engine.createElement('view');
    engine.setProp(node, 'style', { transform });
    engine.appendChild(engine.root, node);
    engine.commit();
    const style = fabric.committed[0]!.props['style'] as Record<string, unknown> | undefined;
    assert.equal(style?.['transform'], undefined, transform);
  }
});

it('drops a length where a number or an angle goes, as Chrome does, and reads one where it goes', () => {
  const committed = (transform: string) => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const node: EngineNode = engine.createElement('view');
    engine.setProp(node, 'style', { transform });
    engine.appendChild(engine.root, node);
    engine.commit();
    const style = fabric.committed[0]!.props['style'] as Record<string, unknown> | undefined;
    return style?.['transform'] ?? fabric.committed[0]!.props['transform'];
  };
  for (const transform of [
    'scale(2px)',
    'scaleX(2PX)',
    'rotate(2px)',
    'skewX(2px)',
    'matrix(1px, 0, 0, 1, 0, 0)',
  ]) {
    assert.equal(committed(transform), undefined, transform);
  }
  assert.deepEqual(committed('scale(2)'), [{ scale: 2 }]);
  assert.deepEqual(committed('translateX(2px)'), [{ translateX: 2 }]);
});

describe('a transform bound on an element', () => {
  let transform: (id: string) => unknown;

  before(async () => {
    const mod = await compileFixture('fixtures/inline-transform.ts');
    await render(mod['InlineTransform'] as Type<unknown>);
    const ids = [
      'class-only',
      'nbsp-argument',
      'nbsp-argument-alone',
      'nbsp-none',
      'junk-after',
      'nbsp-between',
      'valid',
      'padded',
      'none',
      'upper-none',
      'comma',
      'upper',
      'mixed',
      'unknown',
      'third-axis',
      'along-z',
      'zero-z-unit',
      'one-of-three',
      'two-of-three',
      'unspaced',
      'separators',
      'math',
      'fractions',
      'empty-argument',
      'left-open',
      'spelt',
    ];
    const props = Object.fromEntries(ids.map((id) => [id, screen.getByTestId(id).props]));
    transform = (id) => props[id]!['transform'];
    cleanup();
  });

  it('applies one it can read over the rule', () => {
    assert.deepEqual(transform('valid'), [{ rotate: '90deg' }]);
    assert.deepEqual(transform('padded'), [{ rotate: '90deg' }]);
    assert.deepEqual(transform('comma'), [{ translateX: 4 }, { translateY: 8 }]);
  });

  it('reads the three-dimensional spellings of a flat transform as the flat one', () => {
    assert.deepEqual(transform('third-axis'), [
      { scaleX: 0 },
      { scaleY: 0.5 },
      { translateX: 4 },
      { translateY: 8 },
    ]);
    // Nothing along z in any unit is still nothing.
    assert.deepEqual(transform('zero-z-unit'), [{ translateX: 4 }, { translateY: 8 }]);
  });

  it('reads functions and arguments however they are spaced and separated', () => {
    assert.deepEqual(transform('unspaced'), [
      { translateX: 4 },
      { translateY: 8 },
      { rotate: '90deg' },
    ]);
    assert.deepEqual(transform('separators'), [{ translateX: 4 }, { translateY: 8 }, { scale: 2 }]);
    assert.deepEqual(transform('fractions'), [{ translateX: -0.5 }, { rotate: '.5turn' }]);
  });

  it('reads a number with a sign, an exponent or its unit in capitals as the number', () => {
    assert.deepEqual(transform('spelt'), [{ translateX: 4 }, { translateY: 10 }, { scale: 0.1 }]);
  });

  it('reads a math function in an argument beside a plain one', () => {
    assert.deepEqual(transform('math'), [
      { translateX: 4 },
      { translateY: 8 },
      { rotate: '90deg' },
    ]);
  });

  it('closes a bracket the value leaves open, as Chrome closes it', () => {
    assert.deepEqual(transform('left-open'), [
      { translateX: 4 },
      { translateY: 8 },
      { rotate: '90deg' },
    ]);
  });

  it('reads a function name in any case', () => {
    assert.deepEqual(transform('upper'), [{ rotate: '90deg' }]);
    assert.deepEqual(transform('mixed'), [{ translateX: 4 }]);
  });

  it('applies none over the rule, in any case', () => {
    const none = (id: string) => (transform(id) as unknown[] | undefined)?.length ?? 0;
    assert.equal(none('none'), 0);
    assert.equal(none('upper-none'), 0);
  });

  for (const id of [
    'nbsp-argument',
    'nbsp-none',
    'junk-after',
    'nbsp-between',
    'unknown',
    'along-z',
    'one-of-three',
    'two-of-three',
    'empty-argument',
  ]) {
    it(`leaves the rule's transform where it cannot read ${id}`, () => {
      assert.deepEqual(transform(id), transform('class-only'));
    });
  }

  it('leaves no transform where no rule sets one', () => {
    assert.equal(transform('nbsp-argument-alone'), undefined);
  });
});
