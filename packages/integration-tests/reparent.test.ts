/**
 * A node Angular moves to another parent. Native gives a view one parent for its whole life -
 * `ShadowNodeFamily::setParent` asserts it in a debug build, and a release build goes on laying the
 * view out against the parent it had - so the engine creates a moved node again, with its subtree.
 * The fake enforces the same rule for every test, which is how two other cases were found.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine, registerHoist, type EngineNode } from '@ng-native/fabric';
import {
  cleanup,
  createFakeFabric,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/reparent.ts');
});

it('creates projected content again when its container is mounted again', async () => {
  const { instance } = await render(
    mod['Reparent'] as Type<{ holder(): { mounts: { set(value: number[]): void } } }>,
  );
  const before = screen.getByTestId('moved').reactTag;
  // Mount the container again: the projected text now belongs to a new native parent.
  instance.holder().mounts.set([1]);
  await settle();
  const after = screen.getByTestId('moved');
  assert.notEqual(after.reactTag, before, 'a new view, not the old one under a new parent');
  assert.ok(screen.getByTestId('container').children.includes(after));
});

it('creates what a destroyed node holds again when the node comes back', () => {
  // Content projected into an `@if`: when the `@if` closes, Angular destroys the projected
  // element along with the view that showed it, though the element is its declaring view's and
  // is put back when the `@if` opens. What it holds is another component's view, which nobody
  // destroyed. A one-time code field's caret is one: a slot shows it only while it is empty.
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {});
  const slot = engine.createElement('view');
  const caret = engine.createElement('view');
  const line = engine.createElement('view');
  engine.setProp(line, 'nativeID', 'line');
  engine.appendChild(engine.root, slot);
  engine.appendChild(slot, caret);
  engine.appendChild(caret, line);
  engine.commit();
  const before = engine.tagOf(line);

  engine.removeChild(slot, caret);
  engine.destroyNode(caret);
  engine.commit();
  engine.appendChild(slot, caret);
  // The fake throws here where a view is handed to a second parent, as native aborts.
  engine.commit();
  assert.notEqual(engine.tagOf(line), before, 'a new view under the new caret');
});

it('hoists a destroyed element again when it comes back', () => {
  // A header projected into an `@if` is destroyed when the `@if` closes and put back when it opens.
  registerHoist('reparent-config', 'reparent-host');
  const fabric = createFakeFabric();
  const engine = new Engine(fabric, 1, {});
  const add = (name: string, id: string, parent: EngineNode) => {
    const node = engine.createElement(name);
    engine.setProp(node, 'nativeID', id);
    engine.appendChild(parent, node);
    return node;
  };
  const tree = () => {
    engine.commit();
    const walk = (all: readonly FakeFabricNode[]): unknown[] =>
      all.map((node) => [node.props['nativeID'], ...walk(node.children)]);
    return walk(fabric.committed);
  };
  const host = add('reparent-host', 'host', engine.root);
  const frame = add('view', 'frame', host);
  const config = add('reparent-config', 'config', frame);
  assert.deepEqual(tree(), [['host', ['frame'], ['config']]]);

  engine.removeChild(frame, config);
  engine.destroyNode(config);
  assert.deepEqual(tree(), [['host', ['frame']]]);
  engine.appendChild(frame, config);
  assert.deepEqual(tree(), [['host', ['frame'], ['config']]], 'into its host, not where it is');

  // Destroyed in a subtree that left, it is the subtree's to bring back.
  engine.removeChild(host, frame);
  engine.destroyNode(config);
  assert.deepEqual(tree(), [['host']]);
  engine.appendChild(host, frame);
  assert.deepEqual(tree(), [['host', ['frame'], ['config']]], 'hoisted when the subtree is back');

  // Destroyed where it is, it is still in the tree, and still hoisted.
  engine.destroyNode(config);
  engine.setProp(config, 'nativeID', 'still');
  assert.deepEqual(tree(), [['host', ['frame'], ['still']]]);

  // Moved out of a subtree that left, it takes its hoisting along, and leaves the subtree its own.
  const wrap = add('view', 'wrap', frame);
  const other = add('reparent-config', 'other', wrap);
  engine.appendChild(wrap, config);
  engine.removeChild(frame, wrap);
  assert.deepEqual(tree(), [['host', ['frame']]]);
  engine.insertBefore(frame, config, null);
  assert.deepEqual(tree(), [['host', ['frame'], ['still']]], 'hoisted where it went');
  engine.appendChild(frame, wrap);
  assert.deepEqual(tree(), [['host', ['frame', ['wrap']], ['still'], ['other']]]);
  assert.equal(other.parent, wrap);
  // And taken out first, then put in by a call of its own, with a commit between.
  engine.appendChild(wrap, config);
  engine.removeChild(frame, wrap);
  assert.deepEqual(tree(), [['host', ['frame']]]);
  engine.removeChild(wrap, config);
  assert.deepEqual(tree(), [['host', ['frame']]]);
  engine.appendChild(frame, config);
  assert.deepEqual(tree(), [['host', ['frame'], ['still']]], 'hoisted after a separate removal');

  // And one destroyed before it was ever put in is not held: no removal comes to let it go.
  const hoisted = (engine as unknown as { hoisted: Set<EngineNode> }).hoisted;
  const never = engine.createElement('reparent-config');
  engine.destroyNode(never);
  engine.commit();
  assert.equal(hoisted.has(never), false, 'the engine lets go of it');
  // Nor is an element that does not hoist made to, by being destroyed and put back.
  const plain = engine.createElement('view');
  engine.destroyNode(plain);
  engine.appendChild(engine.root, plain);
  assert.equal(hoisted.has(plain), false);
});

it('keeps the listeners of content projected into an @if when the @if opens again', async () => {
  // Angular runs its destroy action on the nodes an <ng-content> at the top of a closing view
  // projects, though they belong to the declaring view, which is alive, and it puts the same nodes
  // back without listening again. A listener goes when the view that owns it goes.
  const { fabric, instance } = await render(
    mod['Folded'] as Type<{
      hits(): number;
      fold(): { open: { set(value: boolean): void } };
      pressable(): { hovered(): boolean };
    }>,
  );
  const layout = (height: number) => ({ layout: { x: 0, y: 0, width: 1, height } });
  fabric.emit(screen.getByTestId('row'), 'topLayout', layout(1));
  await settle();
  assert.equal(instance.hits(), 1);
  const before = screen.getByTestId('inner').reactTag;

  instance.fold().open.set(false);
  await settle();
  assert.equal(screen.queryByTestId('row'), null, 'the content left with the block');
  // The fake throws here where a view is handed to a second parent, as native aborts.
  instance.fold().open.set(true);
  await settle();
  assert.notEqual(screen.getByTestId('inner').reactTag, before, 'created again, not re-parented');

  fabric.emit(screen.getByTestId('row'), 'topLayout', layout(2));
  await settle();
  assert.equal(instance.hits(), 2, 'the listener outlived the block it was projected into');
  // And one a directive added on the engine itself, which it takes off when it is destroyed.
  fabric.emit(screen.getByTestId('press'), 'topPointerEnter', {});
  await settle();
  assert.equal(instance.pressable().hovered(), true, 'the pressable still hears the pointer');
});

it('hoists content projected inside an element of an @if when the @if opens again', async () => {
  // The element is made again and the content moved into the new one, out of the old one, which
  // left with the block: what hoists in it must hoist from the new one.
  registerHoist('reparent-config', 'reparent-host');
  const { fabric, instance } = await render(
    mod['WrappedHoist'] as Type<{ fold(): { open: { set(value: boolean): void } } }>,
  );
  const walk = (all: readonly FakeFabricNode[]): unknown[] =>
    all.map((node) => [node.props['nativeID'] ?? node.viewName, ...walk(node.children)]);
  const open = walk(fabric.committed);
  assert.deepEqual(open, [['View', ['host', ['View', ['box', ['wrap']]], ['config']]]]);

  instance.fold().open.set(false);
  await settle();
  assert.deepEqual(walk(fabric.committed), [['View', ['host', ['View', ['box']]]]]);
  instance.fold().open.set(true);
  await settle();
  assert.deepEqual(walk(fabric.committed), open, 'into its host, not inside the new element');
});
