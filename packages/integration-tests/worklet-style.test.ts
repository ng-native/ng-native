/**
 * Reanimated's worklets, at the seam.
 *
 * The UI runtime is Reanimated's and is not retested here. What matters on this side is that the
 * directive hands it a node it can actually write to - a react tag and the shadow node behind it,
 * neither of which exists before the first commit - and that it lets go of the runtime when the
 * style is replaced or the element goes away, because a mapper nobody stopped keeps running on
 * the UI thread for the life of the app.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { render, settle, type FakeFabricNode } from '@ng-native/testing';
import { WORKLETS, type WorkletStyleSpec, type WorkletTarget } from '../components/src/worklets.ts';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

interface Binding {
  target: WorkletTarget;
  style: WorkletStyleSpec;
  stopped: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/worklet.ts');
});

async function boot() {
  const bound: Binding[] = [];
  const app = await render(mod['Sliding'] as Type<unknown>, {
    providers: [
      {
        provide: WORKLETS,
        useValue: {
          bind: (target: WorkletTarget, style: WorkletStyleSpec) => {
            const binding: Binding = { target, style, stopped: 0 };
            bound.push(binding);
            return () => binding.stopped++;
          },
        },
      },
    ],
  });
  const { fabric } = app;
  const engine = app.componentRef.injector.get(Engine);
  // Fabric clones on write, so the node has to be looked up again after every commit.
  const animated = () =>
    flatten(fabric.committed).find((n) => n.props['backgroundColor'] === 'red')!;
  return { fabric, app, engine, bound, animated };
}

describe('worklet style', () => {
  it('binds to the committed node, by tag and by shadow node', async () => {
    const { engine, bound, animated } = await boot();
    assert.equal(bound.length, 1);
    const node = animated().instanceHandle as never;
    assert.equal(bound[0]!.target.tag, engine.tagOf(node), 'the element it sits on');
    assert.equal(
      bound[0]!.target.shadowNode,
      engine.shadowNodeOf(node),
      'and the shadow node Fabric holds for it, which is what the UI thread writes to',
    );
  });

  it('runs the updater over the values it was given, with nothing captured', async () => {
    const { bound } = await boot();
    const { values, updater } = bound[0]!.style;
    (values[0] as { value: number }).value = 12;
    assert.deepEqual(updater(...values), { transform: [{ translateX: 12 }] });
  });

  it('stops the old mapper when the style is replaced', async () => {
    const { app, bound } = await boot();
    const instance = app.componentRef.instance as {
      style: { set(value: WorkletStyleSpec): void };
    };

    instance.style.set({ values: [], updater: () => ({ opacity: 0.5 }) });
    await settle();

    assert.equal(bound.length, 2, 'a mapper for the new style');
    assert.equal(bound[0]!.stopped, 1, 'and the old one stopped');
  });

  it('stops when the element goes away', async () => {
    const { app, bound } = await boot();
    app.componentRef.destroy();
    await settle();
    assert.equal(bound[0]!.stopped, 1);
  });
});
