/**
 * A scroll handled on the UI thread.
 *
 * The runtime is Reanimated's and is not retested here; what matters on this side is that the
 * directive registers against a node native can actually address - it has no react tag until it
 * has been committed - and that it unregisters, because a handler nobody removed keeps running
 * for the life of the app against a tag that will be reused.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { render, settle, type FakeFabricNode } from '@ng-native/testing';
import {
  WORKLETS,
  type WorkletScrollSpec,
  type WorkletStyleSpec,
  type WorkletTarget,
} from '../components/src/worklets.ts';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

interface Bound {
  target: WorkletTarget;
  spec: WorkletScrollSpec;
  stopped: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/worklet-scroll.ts');
});

async function boot() {
  const bound: Bound[] = [];
  const app = await render(mod['Scrolling'] as Type<unknown>, {
    providers: [
      {
        provide: WORKLETS,
        useValue: {
          bind: (_target: WorkletTarget, _style: WorkletStyleSpec) => () => {},
          scroll: (target: WorkletTarget, spec: WorkletScrollSpec) => {
            const record: Bound = { target, spec, stopped: 0 };
            bound.push(record);
            return () => record.stopped++;
          },
        },
      },
    ],
  });
  const { fabric } = app;
  const engine = app.componentRef.injector.get(Engine);
  const scroller = () => flatten(fabric.committed).find((n) => n['viewName'] === 'ScrollView')!;
  return { app, engine, bound, scroller };
}

describe('worklet scroll', () => {
  it('registers against the committed scroll view', async () => {
    const { engine, bound, scroller } = await boot();
    assert.equal(bound.length, 1);
    assert.equal(bound[0]!.target.tag, engine.tagOf(scroller().instanceHandle as never));
  });

  it('hands the worklet the values it was built with', async () => {
    const { bound } = await boot();
    const { values, handler } = bound[0]!.spec;
    handler({ contentOffset: { x: 0, y: 42 } } as never, ...values);
    assert.equal((values[0] as { value: number }).value, 42, 'the worklet wrote the shared value');
  });

  it('unregisters when the element goes away', async () => {
    const { app, bound } = await boot();
    app.componentRef.destroy();
    await settle();
    assert.equal(bound[0]!.stopped, 1);
  });
});
