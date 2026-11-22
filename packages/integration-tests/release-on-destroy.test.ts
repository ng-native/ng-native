/**
 * `releaseOnDestroy`: a callback a worklet can hold, for as long as native code keeps it, without
 * keeping the component that made it.
 *
 * Native code is stood in for by an array the test never empties, which is what a remote function
 * rooted by react-native-worklets is: a reference that outlives the gesture it was made for.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createEnvironmentInjector, DestroyRef, type EnvironmentInjector } from '@angular/core';
import { releaseOnDestroy } from '@ng-native/components';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** A macrotask between each pass, because a `WeakRef` holds its target until the job ends. */
async function collect(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

const scope = (): EnvironmentInjector =>
  createEnvironmentInjector([], null as unknown as EnvironmentInjector);

/** What native code keeps: never emptied. */
const rooted: ((...args: never[]) => void)[] = [];

describe('releaseOnDestroy', () => {
  it('calls the callback, with its arguments, until it is destroyed', () => {
    const injector = scope();
    const heard: [number, string][] = [];
    const forward = releaseOnDestroy(
      (n: number, s: string) => heard.push([n, s]),
      injector.get(DestroyRef),
    );
    forward(1, 'a');
    forward(2, 'b');
    assert.deepEqual(heard, [
      [1, 'a'],
      [2, 'b'],
    ]);
    injector.destroy();
  });

  it('does nothing once it is destroyed', () => {
    const injector = scope();
    let calls = 0;
    const forward = releaseOnDestroy(() => calls++, injector.get(DestroyRef));
    injector.destroy();
    assert.doesNotThrow(() => forward());
    assert.equal(calls, 0);
  });

  it('lets the owner be collected while the forwarder is still held', async () => {
    const owner = await (async () => {
      const injector = scope();
      // The component a callback reads through: a method on it, as `this.removed.emit()` is.
      const component = {
        count: 0,
        big: new Array(10_000).fill(0),
        bump() {
          this.count++;
        },
      };
      const forward = releaseOnDestroy(() => component.bump(), injector.get(DestroyRef));
      rooted.push(forward);
      forward();
      assert.equal(component.count, 1);
      injector.destroy();
      return new WeakRef(component);
    })();
    await collect();
    assert.equal(
      owner.deref() === undefined,
      true,
      'the component is still reachable from the forwarder',
    );
    assert.equal(rooted.length, 1, 'and the forwarder itself was kept');
  });
});
