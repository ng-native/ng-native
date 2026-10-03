/**
 * `pointer-events`, as CSS means it. It is inherited, and `none` is about the element alone: a
 * descendant that sets `auto` takes touches again. React Native's `none` covers the whole subtree,
 * and its word for the CSS meaning is `box-none`. So a computed `none` commits as `none` while
 * nothing inside it takes touches, which is all Android's text and images can be told, and as
 * `box-none` once something inside does.
 *
 * Chrome's computed values for the same sheets are in the oracle (`css-oracle-cases.ts`); this
 * covers what is committed, a value that changes, and the prop, which keeps React Native's meaning.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine, type EngineNode } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

/** A `.layer` holding a `.panel` and a `.plain`, each a view with a background so it commits. */
function tree(css: string) {
  const warnings: string[] = [];
  const sheet = compileCss(`view { background-color: rgb(1, 1, 1) } ${css}`, 'pointer', {
    onUnsupported: (m: string) => warnings.push(m),
  });
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1);
  const make = (name: string): EngineNode => {
    const node = engine.createElement('view', sheet);
    engine.addClass(node, name);
    return node;
  };
  const layer = make('layer');
  const panel = make('panel');
  const plain = make('plain');
  engine.appendChild(layer, panel);
  engine.appendChild(layer, plain);
  engine.appendChild(engine.root, layer);
  engine.commit();
  const committed = () => {
    const root = fabric.committed[0]!;
    return {
      layer: root.props['pointerEvents'],
      panel: root.children[0]!.props['pointerEvents'],
      plain: root.children[1]!.props['pointerEvents'],
    };
  };
  roots.set(engine, () => fabric.committed[0]!);
  return { engine, layer, panel, plain, committed, warnings };
}

/** The committed `.layer` of an engine `tree` made, read again after its children change. */
const roots = new WeakMap<Engine, () => { props: Record<string, unknown> }>();
const fabric = (engine: Engine) => roots.get(engine)!();

describe('pointer-events: none', () => {
  it('lets a descendant with pointer-events: auto take touches again', () => {
    const { committed, warnings } = tree(
      '.layer { pointer-events: none } .panel { pointer-events: auto }',
    );
    assert.deepEqual(warnings, []);
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'auto', plain: 'none' });
  });

  it('is inherited by a descendant that sets nothing', () => {
    const { committed } = tree('.layer { pointer-events: none }');
    assert.deepEqual(committed(), { layer: 'none', panel: 'none', plain: 'none' });
  });

  it('is nothing at all where no rule sets it', () => {
    const { committed } = tree('.layer { opacity: 0.5 }');
    assert.deepEqual(committed(), { layer: undefined, panel: undefined, plain: undefined });
  });

  it('follows the class that sets it, there and in what inherits it', () => {
    const { engine, layer, committed } = tree(
      '.off { pointer-events: none } .panel { pointer-events: auto }',
    );
    assert.deepEqual(committed(), { layer: undefined, panel: 'auto', plain: undefined });
    engine.addClass(layer, 'off');
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'auto', plain: 'none' });
    engine.removeClass(layer, 'off');
    engine.commit();
    // A prop that went is committed as null, which resets it on the native side.
    assert.deepEqual(committed(), { layer: null, panel: 'auto', plain: null });
  });

  it('means the same set inline, as a style attribute or a style binding sets it', () => {
    const { engine, layer, committed } = tree('.panel { pointer-events: auto }');
    engine.setProp(layer, 'style', { pointerEvents: 'none' });
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'auto', plain: 'none' });
  });

  it('opens when a descendant starts taking touches, and closes when it stops', () => {
    const { engine, panel, committed } = tree(
      '.layer { pointer-events: none } .on { pointer-events: auto }',
    );
    assert.deepEqual(committed(), { layer: 'none', panel: 'none', plain: 'none' });
    engine.addClass(panel, 'on');
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'auto', plain: 'none' });
    engine.removeClass(panel, 'on');
    engine.commit();
    assert.deepEqual(committed(), { layer: 'none', panel: 'none', plain: 'none' });
  });

  it('closes when the descendant that took touches is removed, and opens when one is added', () => {
    const { engine, layer, panel, committed } = tree(
      '.layer { pointer-events: none } .panel { pointer-events: auto }',
    );
    assert.equal(committed().layer, 'box-none');
    engine.removeChild(layer, panel);
    engine.commit();
    assert.equal(fabric(engine).props['pointerEvents'], 'none');
    engine.appendChild(layer, panel);
    engine.commit();
    assert.equal(fabric(engine).props['pointerEvents'], 'box-none');
  });

  it('opens every element between the one that sets none and the one that sets auto', () => {
    const { engine, layer, plain, committed } = tree(
      '.layer { pointer-events: none } .deep { pointer-events: auto }',
    );
    const deep = engine.createElement('view', layer.sheet);
    engine.addClass(deep, 'deep');
    engine.appendChild(plain, deep);
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'none', plain: 'box-none' });
  });

  it('stays none around a box-none element with nothing inside it that takes touches', () => {
    // `box-none` takes no touches itself: it only passes the question on to its children.
    const { engine, panel, committed } = tree('.layer { pointer-events: none }');
    engine.setProp(panel, 'style', { pointerEvents: 'box-none' });
    engine.commit();
    assert.deepEqual(committed(), { layer: 'none', panel: 'box-none', plain: 'none' });

    const inside = engine.createElement('view', panel.sheet);
    engine.setProp(inside, 'style', { pointerEvents: 'auto' });
    engine.appendChild(panel, inside);
    engine.commit();
    assert.equal(committed().layer, 'box-none', 'and opens for something inside that does');
  });

  it('reads an inline style given as a list, on an element no rule matches', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const layer = engine.createElement('view');
    const child = engine.createElement('view');
    engine.setProp(layer, 'style', [{ opacity: 1 }, { pointerEvents: 'none' }]);
    engine.setProp(child, 'style', [{ opacity: 1 }, { pointerEvents: 'auto' }]);
    engine.appendChild(layer, child);
    engine.appendChild(engine.root, layer);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['pointerEvents'], 'box-none');
    assert.equal(fabric.committed[0]!.children[0]!.props['pointerEvents'], 'auto');
  });

  it('hands no box-none down from an inline style, on elements no rule matches', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const parent = engine.createElement('view');
    const child = engine.createElement('view');
    engine.setProp(parent, 'style', { pointerEvents: 'box-none', opacity: 0.9 });
    engine.setProp(child, 'style', { opacity: 0.8 });
    engine.appendChild(parent, child);
    engine.appendChild(engine.root, parent);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['pointerEvents'], 'box-none');
    assert.equal(fabric.committed[0]!.children[0]!.props['pointerEvents'], undefined);
  });

  it("takes an inline inherit as the parent's value, over a weaker rule's auto", () => {
    const { engine, panel, committed } = tree(
      '.layer { pointer-events: none } .panel { pointer-events: auto }',
    );
    engine.setProp(panel, 'style', { pointerEvents: 'inherit' });
    engine.commit();
    assert.deepEqual(committed(), { layer: 'none', panel: 'none', plain: 'none' });
  });

  it("takes an inline inherit as the parent's value where no rule matches at all", () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const parent = engine.createElement('view');
    const child = engine.createElement('view');
    engine.setProp(parent, 'style', { pointerEvents: 'none', opacity: 0.9 });
    engine.setProp(child, 'style', { pointerEvents: 'inherit', opacity: 0.8 });
    engine.appendChild(parent, child);
    engine.appendChild(engine.root, parent);
    engine.commit();
    assert.equal(fabric.committed[0]!.props['pointerEvents'], 'none');
    assert.equal(fabric.committed[0]!.children[0]!.props['pointerEvents'], 'none');
  });

  it('opens for a descendant whose pointerEvents prop takes touches', () => {
    const { engine, panel, plain, committed } = tree('.layer { pointer-events: none }');
    engine.setProp(panel, 'pointerEvents', 'auto');
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'auto', plain: 'none' });
    engine.setProp(panel, 'pointerEvents', null);
    engine.setProp(plain, 'pointerEvents', 'box-only');
    engine.commit();
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'none', plain: 'box-only' });
  });

  it('stays closed around a descendant whose pointerEvents prop is none, whatever is inside it', () => {
    const { engine, layer, panel, committed } = tree(
      '.layer { pointer-events: none } .deep { pointer-events: auto }',
    );
    const deep = engine.createElement('view', layer.sheet);
    engine.addClass(deep, 'deep');
    engine.appendChild(panel, deep);
    engine.setProp(panel, 'pointerEvents', 'none');
    engine.commit();
    // Native's none is the whole subtree, so nothing under the panel can take a touch.
    assert.deepEqual(committed(), { layer: 'none', panel: 'none', plain: 'none' });
  });

  it("keeps React Native's meaning as the pointerEvents prop: the whole subtree", () => {
    const { engine, layer, committed } = tree('.panel { pointer-events: auto }');
    engine.setProp(layer, 'pointerEvents', 'none');
    engine.commit();
    assert.equal(committed().layer, 'none');
  });

  it("keeps React Native's own box-none and box-only as written, and inherits neither", () => {
    const { committed } = tree(
      '.layer { pointer-events: box-none } .panel { pointer-events: box-only }',
    );
    assert.deepEqual(committed(), { layer: 'box-none', panel: 'box-only', plain: undefined });
  });
});
