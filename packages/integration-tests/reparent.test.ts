/**
 * A node Angular moves to another parent. Native gives a view one parent for its whole life -
 * `ShadowNodeFamily::setParent` asserts it in a debug build, and a release build goes on laying the
 * view out against the parent it had - so the engine creates a moved node again, with its subtree.
 * The fake enforces the same rule for every test, which is how two other cases were found.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, createFakeFabric, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/reparent.ts', import.meta.url)));
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
