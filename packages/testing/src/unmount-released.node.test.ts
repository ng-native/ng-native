/**
 * What is left of a render once it is unmounted: nothing, so a test can prove a component of its
 * own lets go of what it held.
 *
 * `mount` gives Angular a stand-in document, which Angular keeps until the next mount replaces it.
 * Its one function was made inside `mount`, sharing the scope of every closure there, so the last
 * render's component, engine and fake Fabric stayed reachable after `unmount()` however little the
 * test kept of them.
 */
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { Component, output } from '@angular/core';
import { releaseOnDestroy, Text } from '@ng-native/components';
import { cleanup, render } from '@ng-native/testing';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

afterEach(cleanup);

/**
 * Whether every target has been collected, within half a second. A macrotask goes between each
 * pass, because a `WeakRef` holds its target until the job ends, and they are 20ms apart because a
 * frame the unmounted app had asked for is a 16ms timer under Node, which holds it until it runs.
 */
async function collected(refs: readonly WeakRef<object>[]): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    gc();
    if (refs.every((ref) => ref.deref() === undefined)) return true;
  }
  return false;
}

@Component({ selector: 'app-card', imports: [Text], template: '<text>Card</text>' })
class Card {}

/** What native code keeps of a gesture: a remote function, never released. */
const rooted: (() => void)[] = [];

@Component({ selector: 'app-swipe-row', imports: [Text], template: '<text>Row</text>' })
class SwipeRow {
  readonly removed = output<void>();

  constructor() {
    // Reads `this`, as a callback written without care for it does.
    rooted.push(releaseOnDestroy(() => this.removed.emit()));
  }
}

/** Renders and unmounts `type`, keeping nothing but weak references to what it made. */
async function renderAndUnmount(type: new () => object): Promise<WeakRef<object>[]> {
  const { instance, fabric, unmount } = await render(type);
  const refs = [new WeakRef(instance), new WeakRef(fabric)];
  unmount();
  return refs;
}

test('an unmounted component and its fake Fabric can be collected', async () => {
  const refs = await renderAndUnmount(Card);
  assert.equal(await collected(refs), true, 'the component or its fake Fabric is still reachable');
});

test('a component whose callback native code still holds can be collected once unmounted', async () => {
  const [component] = await renderAndUnmount(SwipeRow);
  // A boolean, not the component: a failure would otherwise print the whole of its view tree.
  assert.equal(await collected([component!]), true, 'the component is still reachable');
  assert.equal(rooted.length, 1);
});
