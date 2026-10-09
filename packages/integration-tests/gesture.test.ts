/**
 * Native gestures, at the seam.
 *
 * The recognisers are the library's and are not retested here. What matters on this side is that
 * a gesture is attached to a view that exists - native hangs a recogniser off a real view, and a
 * node has no react tag until it has been committed - and that it is dropped again, because a
 * handler nobody drops stays attached to a tag that will be reused.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, render, settle } from '@ng-native/testing';
import type { FakeFabricNode } from '@ng-native/testing';
import {
  GESTURES,
  type GestureSpec,
  type GestureTarget,
} from '../components/src/gesture-backend.ts';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

interface Attached {
  target: GestureTarget;
  gesture: GestureSpec;
  detached: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/gesture.ts');
});

async function boot() {
  const attached: Attached[] = [];
  const rendered = await render(mod['Draggable'] as Type<unknown>, {
    providers: [
      {
        provide: GESTURES,
        useValue: {
          attach: (target: GestureTarget, gesture: GestureSpec) => {
            const record: Attached = { target, gesture, detached: 0 };
            attached.push(record);
            return () => record.detached++;
          },
        },
      },
    ],
  });
  const engine = rendered.componentRef.injector.get(Engine);
  // Lookup by an arbitrary prop value: the query matrix has no query for that, so this keeps a
  // local `flatten` for this specific lookup.
  const dragged = () =>
    flatten(rendered.fabric.committed).find((n) => n.props['backgroundColor'] === 'red')!;
  return { ...rendered, engine, attached, dragged };
}

describe('native gesture', () => {
  it('attaches to the react tag of the element it sits on', async () => {
    const { engine, attached, dragged } = await boot();
    assert.equal(attached.length, 1);
    assert.equal(attached[0]!.target.tag, engine.tagOf(dragged().instanceHandle as never));
    assert.deepEqual(attached[0]!.gesture, { name: 'pan' });
    cleanup();
  });

  it('drops the old gesture when the bound one is replaced', async () => {
    const { instance, attached } = await boot();
    const typed = instance as { pan: { set(value: object): void } };

    typed.pan.set({ name: 'pinch' });
    await settle();

    assert.equal(attached.length, 2, 'the new gesture attached');
    assert.equal(attached[0]!.detached, 1, 'and the old one dropped');
    cleanup();
  });

  it('drops the gesture when the element goes away', async () => {
    const { unmount, attached } = await boot();
    unmount();
    await settle();
    assert.equal(attached[0]!.detached, 1);
  });
});
