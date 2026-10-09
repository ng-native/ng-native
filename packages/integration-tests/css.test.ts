/**
 * The CSS system: build-time compilation, selector matching, cascade and inheritance.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import {
  cleanup,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
  compileCss,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

// No query by arbitrary prop presence or bare view name in the shared query matrix, so `card()`
// and `label()` keep a local `flatten` over the committed tree.
const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

describe('CSS compilation', () => {
  it('expands shorthands and converts units at build time', () => {
    const { rules } = compileCss('.a { padding: 12px 8px; margin-left: 2rem; width: 50% }');
    assert.deepEqual(rules[0].declarations, {
      paddingTop: 12,
      paddingRight: 8,
      paddingBottom: 12,
      paddingLeft: 8,
      marginLeft: 32,
      width: '50%',
    });
  });

  it('sorts rules by specificity then source order, so the device only merges', () => {
    const { rules } = compileCss('.a { color: red } #b { color: red } view { color: red }');
    assert.deepEqual(
      rules.map((r: { specificity: number }) => r.specificity),
      [1, 1000, 1_000_000],
    );
  });

  it('rejects what native cannot express, naming it', () => {
    // A style that silently does nothing is the failure mode this project keeps hitting.
    assert.throws(() => compileCss('.a { float: left }'), /float.*no React Native equivalent/s);
    assert.throws(() => compileCss('.a { display: grid }'), /display: grid does not exist/);
    assert.throws(() => compileCss('.a { width: 3ex }'), /unit 'ex'/);
    assert.throws(() => compileCss('.a:hover { color: red }'), /':hover' is not supported/);
    assert.throws(() => compileCss('@supports (a: b) { .a { color: red } }'), /@supports/);
    assert.throws(
      () => compileCss('@media print { .a { color: red } }'),
      /media type has no meaning/,
    );
    assert.throws(
      () => compileCss('@media (hover: hover) { .a { color: red } }'),
      /not a media feature/,
    );
  });
});

describe('CSS at runtime', () => {
  let Component: Type<{ raised: { set(v: boolean): void } }>;
  let fabric: FakeFabric;
  let instance: { raised: { set(v: boolean): void } };

  before(async () => {
    const mod = await compileFixture('fixtures/styled.ts');
    Component = mod['Styled'] as typeof Component;
  });

  beforeEach(async () => {
    const rendered = await render(Component);
    fabric = rendered.fabric;
    instance = rendered.instance;
  });

  afterEach(cleanup);

  const card = () =>
    flatten(fabric.committed).find((n) => n.props['backgroundColor'] !== undefined)!;
  const label = () => flatten(fabric.committed).find((n) => n.viewName === 'Paragraph')!;

  it('applies a class rule to a native view', () => {
    assert.equal(card().props['backgroundColor'], 'rgb(255, 0, 0)');
    assert.equal(card().props['paddingTop'], 12);
    assert.equal(card().props['paddingLeft'], 8);
  });

  it('applies a type selector to every matching element', () => {
    // `view { flex: 1 }` reaches both views, and not the root component's host, which is no `view`.
    const views = flatten(fabric.committed[0]!.children).filter((n) => n.viewName === 'View');
    assert.ok(views.length >= 2);
    for (const view of views) assert.equal(view.props['flexGrow'], 1);
  });

  it('never sends class as a native prop', () => {
    // Nothing on the native side reads it; it exists only for matching.
    for (const node of flatten(fabric.committed)) {
      assert.equal(node.props['class'], undefined);
    }
  });

  it('matches descendant and id selectors', () => {
    assert.equal(card().props['borderTopLeftRadius'], 6, '#main .card matched');
    assert.equal(label().props['color'], 'rgb(0, 0, 255)', '.card .label matched');
    assert.equal(label().props['fontSize'], 20);
  });

  it('inherits text properties down the tree, which RN does not', () => {
    /*
     * A text with no rule of its own, inside a card that sets a colour and a size.
     *
     * The previous version of this asserted the *label's* colour, which the test above already
     * proves and which is set on the label directly - so it would have passed with inheritance
     * removed entirely. There was no inheriting element in the fixture at all until now.
     */
    const plain = flatten(fabric.committed).find((n) => n.props['nativeID'] === 'inheriting')!;
    assert.equal(plain.props['color'], 'rgb(1, 2, 3)', 'from the card');
    assert.equal(plain.props['fontSize'], 11);

    // And a rule of its own still wins over what it would have inherited.
    assert.equal(label().props['color'], 'rgb(0, 0, 255)');
    assert.equal(label().props['fontSize'], 20);
  });

  it('resolves specificity when a bound class is added', async () => {
    instance.raised.set(true);
    await settle();

    // `.card.raised` is more specific than `.card`.
    assert.equal(card().props['backgroundColor'], 'rgb(0, 128, 0)');
  });
});
