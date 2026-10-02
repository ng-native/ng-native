import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ApplicationRef,
  EnvironmentInjector,
  ErrorHandler,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type Type,
} from '@angular/core';
import { WIDGET_EVENTS, widget, type NativeWidget, type WidgetEntry } from '@ng-native/expo/widget';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Score {
  us: string;
  them: string;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeWidget(stored?: WidgetEntry<Score>['props']) {
  const snapshots: Score[] = [];
  let timeline: WidgetEntry<Score>[] = stored ? [{ date: new Date(0), props: stored }] : [];
  const native: NativeWidget<Score> = {
    updateSnapshot: (props) => {
      snapshots.push(props);
      timeline = [{ date: new Date(), props }];
    },
    getTimeline: async () => timeline,
    reload: () => snapshots.push({ us: 'reload', them: 'reload' }),
  };
  return {
    native,
    snapshots,
    tapInWidget: (target: string) => {
      const last = timeline.at(-1)!.props;
      timeline = [{ date: new Date(), props: { ...last, taps: [...(last.taps ?? []), target] } }];
    },
  };
}

function fakeEvents() {
  const taps = new Set<() => void>();
  const foregrounds = new Set<() => void>();
  const backgrounds = new Set<() => void>();
  return {
    events: {
      onTap: (listener: () => void) => (taps.add(listener), () => taps.delete(listener)),
      onForeground: (listener: () => void) => (
        foregrounds.add(listener),
        () => foregrounds.delete(listener)
      ),
      onBackground: (listener: () => void) => (
        backgrounds.add(listener),
        () => backgrounds.delete(listener)
      ),
    },
    background: () => backgrounds.forEach((listener) => listener()),
    tap: () => taps.forEach((listener) => listener()),
    foreground: () => foregrounds.forEach((listener) => listener()),
    listening: () => taps.size + foregrounds.size + backgrounds.size,
  };
}

let root: EnvironmentInjector;
before(async () => {
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/counter.ts', import.meta.url)),
  );
  root = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector.get(
    EnvironmentInjector,
  );
});

function setup(stored?: WidgetEntry<Score>['props'], handled: unknown[] = []) {
  const fake = fakeWidget(stored);
  const events = fakeEvents();
  const received: string[][] = [];
  const injector = createEnvironmentInjector(
    [
      { provide: WIDGET_EVENTS, useValue: events.events },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => handled.push(error) } },
    ],
    root,
  );
  const score = signal<Score>({ us: '0', them: '0' });
  const ref = runInInjectionContext(injector, () =>
    widget(fake.native, score, { onTaps: (taps) => received.push([...taps]) }),
  );
  const flush = async () => {
    await settle();
    root.get(ApplicationRef).tick();
    await settle();
  };
  return { fake, events, received, score, ref, flush, destroy: () => injector.destroy() };
}

describe('widget', () => {
  it('shows the app state on the widget, and follows the signal', async () => {
    const { fake, score, flush } = setup();
    await flush();
    assert.deepEqual(fake.snapshots.at(-1), { us: '0', them: '0' });
    score.set({ us: '15', them: '0' });
    await flush();
    assert.deepEqual(fake.snapshots.at(-1), { us: '15', them: '0' });
  });

  it('hands over taps made while the app was not running before it writes anything', async () => {
    const { fake, received, flush } = setup({ us: '0', them: '0', taps: ['point-us', 'point-us'] });
    await flush();
    assert.deepEqual(received, [['point-us', 'point-us']]);
    assert.equal(fake.snapshots[0]?.us, '0', 'the first write comes after the taps were read');
    assert.equal('taps' in fake.snapshots.at(-1)!, false, 'and clears them');
  });

  it('collects taps when the app comes back to the foreground', async () => {
    const { fake, events, received, flush } = setup();
    await flush();
    fake.tapInWidget('point-them');
    events.foreground();
    await flush();
    assert.deepEqual(received, [['point-them']]);
  });

  it('collects taps at once while the app is running', async () => {
    const { fake, events, received, flush } = setup();
    await flush();
    fake.tapInWidget('point-us');
    events.tap();
    await flush();
    assert.deepEqual(received, [['point-us']]);
    events.foreground();
    await flush();
    assert.deepEqual(received, [['point-us']], 'a tap is handed over once');
  });

  it('hands a failing tap handler to the ErrorHandler and still clears the taps', async () => {
    const handled: unknown[] = [];
    const fake = fakeWidget({ us: '0', them: '0', taps: ['point-us'] });
    const events = fakeEvents();
    const injector = createEnvironmentInjector(
      [
        { provide: WIDGET_EVENTS, useValue: events.events },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => handled.push(error) },
        },
      ],
      root,
    );
    runInInjectionContext(injector, () =>
      widget(fake.native, signal<Score>({ us: '0', them: '0' }), {
        onTaps: () => {
          throw new Error('bad tap');
        },
      }),
    );
    await settle();
    await settle();
    assert.match(String(handled[0]), /bad tap/);
    assert.equal('taps' in fake.snapshots.at(-1)!, false);
    injector.destroy();
  });

  it('keeps a tap that lands while the app is reading the queue', async () => {
    const fake = fakeWidget({ us: '0', them: '0', taps: ['point-us'] });
    const read = fake.native.getTimeline;
    let reads = 0;
    fake.native.getTimeline = async () => {
      const timeline = await read();
      if (++reads === 1) fake.tapInWidget('point-them');
      return timeline;
    };
    const received: string[][] = [];
    const injector = createEnvironmentInjector(
      [{ provide: WIDGET_EVENTS, useValue: fakeEvents().events }],
      root,
    );
    runInInjectionContext(injector, () =>
      widget(fake.native, signal<Score>({ us: '0', them: '0' }), {
        onTaps: (taps) => received.push([...taps]),
      }),
    );
    for (let i = 0; i < 4; i++) await settle();
    assert.deepEqual(received, [['point-us'], ['point-them']]);
    assert.equal('taps' in fake.snapshots.at(-1)!, false);
    injector.destroy();
  });

  it('does not write over taps while it is still collecting them', async () => {
    const { fake, events, received, score, flush } = setup();
    await flush();
    fake.tapInWidget('point-us');
    const read = fake.native.getTimeline;
    let release!: () => void;
    fake.native.getTimeline = () => new Promise((resolve) => (release = () => resolve(read())));
    events.tap();
    score.set({ us: '40', them: '0' });
    root.get(ApplicationRef).tick();
    fake.native.getTimeline = read;
    release();
    await flush();
    assert.deepEqual(received, [['point-us']]);
    assert.deepEqual(fake.snapshots.at(-1), { us: '40', them: '0' });
  });

  it('asks iOS to redraw the widget as the app goes to the background', async () => {
    const { fake, events, flush } = setup();
    await flush();
    events.background();
    assert.deepEqual(fake.snapshots.at(-1), { us: 'reload', them: 'reload' });
  });

  it('stops listening when destroyed', async () => {
    const { events, destroy, flush } = setup();
    await flush();
    assert.equal(events.listening(), 3);
    destroy();
    assert.equal(events.listening(), 0);
  });
});
