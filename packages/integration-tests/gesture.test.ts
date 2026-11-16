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
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/components';
import {
  GESTURES,
  type EndedGesture,
  type GestureSpec,
  type GestureTarget,
} from '../components/src/gesture-backend.ts';
import { compileFixture } from './compile.ts';

const flatten = (n: FakeFabricNode[]): FakeFabricNode[] =>
  n.flatMap((x) => [x, ...flatten(x.children)]);

interface Attached {
  target: GestureTarget;
  gesture: GestureSpec;
  report: ((ended: EndedGesture) => void) | undefined;
  detached: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/gesture.ts');
});

async function boot(heard?: InteractionEvent[]) {
  const attached: Attached[] = [];
  const rendered = await render(mod['Draggable'] as Type<unknown>, {
    providers: [
      ...(heard ? [provideInteractionObserver((event) => heard.push(event))] : []),
      {
        provide: GESTURES,
        useValue: {
          attach: (
            target: GestureTarget,
            gesture: GestureSpec,
            report?: (ended: EndedGesture) => void,
          ) => {
            const record: Attached = { target, gesture, report, detached: 0 };
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

describe('native gesture, reported to interaction observers', () => {
  const pan: EndedGesture = {
    handlerName: 'PanGestureHandler',
    end: { handlerTag: 3, translationX: 90, translationY: 0, velocityX: 1200, velocityY: 0 },
  };
  const tap: EndedGesture = {
    handlerName: 'TapGestureHandler',
    end: { handlerTag: 3, x: 2, y: 3, absoluteX: 20, absoluteY: 30 },
  };

  it('asks the backend for no reports when no observer is registered', async () => {
    const { attached } = await boot();
    assert.equal(attached[0]!.report, undefined);
    cleanup();
  });

  it('reports a gesture that ended as the element it is attached to', async () => {
    const heard: InteractionEvent[] = [];
    const { engine, attached, dragged } = await boot(heard);

    attached[0]!.report!(pan);

    assert.equal(heard.length, 1);
    const { timestamp, ...rest } = heard[0]!;
    assert.deepEqual(rest, {
      type: 'swipe',
      gesture: 'pan',
      element: 'view',
      label: 'Draft card',
      testID: 'card',
      nativeTag: engine.tagOf(dragged().instanceHandle as never),
      direction: 'right',
      distance: 90,
      source: 'touch',
    });
    assert.equal(typeof timestamp, 'number');
    cleanup();
  });

  it('gives a tap the text inside the element, as a pressed control has', async () => {
    const heard: InteractionEvent[] = [];
    const { attached } = await boot(heard);

    attached[0]!.report!(tap);

    assert.equal(heard[0]!.type, 'click');
    assert.equal(heard[0]!.text, 'Open draft');
    assert.equal(heard[0]!.pageX, 20);
    cleanup();
  });

  it('reports nothing for a gesture the observers do not hear about', async () => {
    const heard: InteractionEvent[] = [];
    const { attached } = await boot(heard);

    attached[0]!.report!({ handlerName: 'HoverGestureHandler', end: { handlerTag: 3 } });

    assert.deepEqual(heard, []);
    cleanup();
  });

  it('keeps an element out with trackGesture, and lets it back in when bound to nothing', async () => {
    const heard: InteractionEvent[] = [];
    const { instance, attached } = await boot(heard);
    const typed = instance as { track: { set(value: boolean | undefined): void } };

    typed.track.set(false);
    await settle();
    assert.equal(attached.length, 2, 'attached again without reports');
    assert.equal(attached[0]!.detached, 1, 'and the reporting attach dropped');
    assert.equal(attached[1]!.report, undefined);

    typed.track.set(undefined as never);
    await settle();
    attached[2]!.report!(pan);
    assert.equal(heard.length, 1, 'unbound to a value, it takes its default of true');
    cleanup();
  });
});
