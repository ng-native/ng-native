/**
 * An error thrown while a native event is being dispatched reaches the app's `ErrorHandler`.
 *
 * Fabric calls the engine's event handler synchronously from C++, in the middle of whatever
 * native was doing when it sent the event, and a throw that escapes it unwinds through that. For
 * `RNSScreen` that is the mounting transaction of a push, and the next commit reads props freed on
 * the way out. Angular catches what its own template listeners
 * throw; these are the rest of the path: responder handlers, and listeners registered on the
 * engine directly.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, type Type } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, createFakeFabric, fireEvent, render, screen } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

class Recording extends ErrorHandler {
  readonly errors: unknown[] = [];
  override handleError(error: unknown): void {
    this.errors.push(error);
  }
}

const message = (error: unknown) => (error as Error).message;

describe('errors thrown during event dispatch, on the engine', () => {
  it('go to the error hook with the event name, and never out to native', () => {
    const fabric = createFakeFabric();
    const seen: [string, string][] = [];
    const engine = new Engine(fabric, 1, {
      onError: (error, topLevelType) => seen.push([message(error), topLevelType]),
    });
    const node = engine.createElement('view');
    engine.appendChild(engine.root, node);
    engine.commit();
    engine.setEventListener(node, 'topWillAppear', () => {
      throw new Error('boom');
    });

    assert.doesNotThrow(() => fabric.emit(fabric.committed[0]!, 'topWillAppear', {}));
    assert.deepEqual(seen, [['boom', 'topWillAppear']]);
  });

  it('let the rest of the path run after one listener throws', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { onError: () => {} });
    const outer = engine.createElement('view');
    const inner = engine.createElement('view');
    engine.appendChild(engine.root, outer);
    engine.appendChild(outer, inner);
    engine.commit();
    const log: string[] = [];
    engine.setEventListener(inner, 'topTouchEnd', () => {
      throw new Error('first');
    });
    engine.setEventListener(inner, 'topTouchEnd', () => log.push('inner'));
    engine.setEventListener(outer, 'topTouchEnd', () => log.push('outer'));

    engine.dispatchEvent(inner, 'topTouchEnd', {});
    assert.deepEqual(log, ['inner', 'outer']);
  });

  it('are reported to the console with the event name when nothing is hooked up', () => {
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1);
    const node = engine.createElement('view');
    engine.appendChild(engine.root, node);
    engine.commit();
    engine.setEventListener(node, 'topWillAppear', () => {
      throw new Error('unhooked');
    });

    const reports: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => reports.push(args);
    try {
      assert.doesNotThrow(() => engine.dispatchEvent(node, 'topWillAppear', {}));
    } finally {
      console.error = original;
    }
    assert.equal(reports.length, 1);
    assert.match(String(reports[0]![0]), /topWillAppear/);
    assert.equal(message(reports[0]![1]), 'unhooked');
  });
});

describe('errors thrown during event dispatch, in an app', () => {
  let Component: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/event-errors.ts');
    Component = mod['EventErrors'] as Type<unknown>;
  });

  afterEach(cleanup);

  const start = async () => {
    const handler = new Recording();
    const rendered = await render(Component, {
      providers: [{ provide: ErrorHandler, useValue: handler }],
    });
    return {
      handler,
      fabric: rendered.fabric,
      engine: rendered.componentRef.injector.get(Engine),
      host: rendered.instance as { bubbled: string[] },
    };
  };

  it('reach the ErrorHandler from a listener outside Angular', async () => {
    // Sent to the root component's host as Fabric sends a native event, outside every Angular
    // listener wrapper.
    const { handler, fabric } = await start();
    assert.doesNotThrow(() => fabric.emit(fabric.committed[0]!, 'topWillAppear', {}));
    assert.deepEqual(handler.errors.map(message), ['willAppear failed']);
  });

  it('reach the ErrorHandler from a responder handler, and the touch still bubbles', async () => {
    const { handler, host } = await start();
    const target = screen.getByTestId('target');
    await assert.doesNotReject(fireEvent(target, 'touchStart', {}));
    assert.deepEqual(handler.errors.map(message), ['grant failed']);

    await fireEvent(target, 'touchEnd', {});
    assert.deepEqual(host.bubbled, ['view', 'host']);
  });
});
