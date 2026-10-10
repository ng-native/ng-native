import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
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

/** `failing` counts the reads and writes that throw, as `expo-widgets` does on a bad entry. */
function fakeWidget(stored?: WidgetEntry<Score>['props'], failing = { reads: 0, writes: 0 }) {
  const snapshots: Score[] = [];
  let timeline: WidgetEntry<Score>[] = stored ? [{ date: new Date(0), props: stored }] : [];
  const native: NativeWidget<Score> = {
    updateSnapshot: (props) => {
      if (failing.writes-- > 0) throw new Error('write');
      snapshots.push(props);
      timeline = [{ date: new Date(), props }];
    },
    getTimeline: async () => {
      if (failing.reads-- > 0) throw new Error('read');
      return timeline;
    },
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
  const mod = await compileFixture('fixtures/counter.ts');
  root = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector.get(
    EnvironmentInjector,
  );
});

function setup(
  stored?: WidgetEntry<Score>['props'],
  handled: unknown[] = [],
  failing = { reads: 0, writes: 0 },
) {
  const fake = fakeWidget(stored, failing);
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

  it('hands an asynchronous tap handler that rejects to the ErrorHandler', async () => {
    const handled: unknown[] = [];
    const injector = createEnvironmentInjector(
      [
        { provide: WIDGET_EVENTS, useValue: fakeEvents().events },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => handled.push(error) },
        },
      ],
      root,
    );
    runInInjectionContext(injector, () =>
      widget(
        fakeWidget({ us: '0', them: '0', taps: ['point-us'] }).native,
        signal<Score>({ us: '0', them: '0' }),
        {
          onTaps: async () => {
            throw new Error('bad tap, later');
          },
        },
      ),
    );
    await settle();
    await settle();
    assert.match(String(handled[0]), /bad tap, later/);
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
    const ref = runInInjectionContext(injector, () =>
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
    assert.equal(ref.error(), null, "the app's handler failing is not the widget's");
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
    assert.deepEqual(received, [['point-us', 'point-them']], 'handed over together, once written');
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

  it('collects the taps before it writes a change to the signal', async () => {
    const { fake, events, received, score, flush } = setup();
    await flush();
    fake.tapInWidget('point-us');
    score.set({ us: '15', them: '0' });
    await flush();
    assert.deepEqual(received, [['point-us']], 'as the app woken in the background changes it');
    assert.deepEqual(fake.snapshots.at(-1), { us: '15', them: '0' });
    events.foreground();
    await flush();
    assert.deepEqual(received, [['point-us']]);
  });

  it('writes nothing while the taps cannot be read, and keeps them for the next sync', async () => {
    const handled: unknown[] = [];
    const stored = { us: '0', them: '0', taps: ['point-us'] };
    const { fake, events, received, score, ref, flush } = setup(stored, handled, {
      reads: 1,
      writes: 0,
    });
    await flush();
    assert.deepEqual(fake.snapshots, [], 'nothing is written over the taps');
    assert.match(String(ref.error()), /read/);
    assert.equal(handled.length, 1);
    score.set({ us: '15', them: '0' });
    await flush();
    assert.deepEqual(received, [['point-us']]);
    assert.deepEqual(fake.snapshots, [{ us: '15', them: '0' }]);
    assert.equal(ref.error(), null, 'a sync that works clears the error');
    events.foreground();
    await flush();
    assert.deepEqual(received, [['point-us']]);
  });

  it('hands a tap over once, after the write that clears it', async () => {
    const stored = { us: '0', them: '0', taps: ['point-us'] };
    const { events, received, ref, flush } = setup(stored, [], { reads: 0, writes: 1 });
    await flush();
    assert.deepEqual(received, [], 'not while the taps are still on the widget');
    assert.match(String(ref.error()), /write/);
    events.foreground();
    await flush();
    events.foreground();
    await flush();
    assert.deepEqual(received, [['point-us']]);
  });

  it('writes the change a tap handler makes, as the app scores the tap', async () => {
    const fake = fakeWidget({ us: '0', them: '0', taps: ['point-us'] });
    const injector = createEnvironmentInjector(
      [{ provide: WIDGET_EVENTS, useValue: fakeEvents().events }],
      root,
    );
    const score = signal<Score>({ us: '0', them: '0' });
    runInInjectionContext(injector, () =>
      widget(fake.native, score, { onTaps: () => score.set({ us: '15', them: '0' }) }),
    );
    for (let i = 0; i < 3; i++) {
      await settle();
      root.get(ApplicationRef).tick();
    }
    await settle();
    assert.deepEqual(fake.snapshots.at(-1), { us: '15', them: '0' });
    injector.destroy();
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

describe("widget's timeline", () => {
  const later = new Date('2030-01-01T12:00:00Z');

  /** A widget that keeps each timeline written, and can be tapped while it shows any entry. */
  function timelineWidget(withTimeline = true) {
    const written: WidgetEntry<Score>[][] = [];
    const snapshots: Score[] = [];
    let timeline: WidgetEntry<Score>[] = [];
    const native: NativeWidget<Score> = {
      updateSnapshot: (props) => {
        snapshots.push(props);
        timeline = [{ date: new Date(), props }];
      },
      getTimeline: async () => timeline,
      reload: () => {},
    };
    if (withTimeline) {
      native.updateTimeline = (entries) => {
        written.push([...entries]);
        timeline = [...entries];
      };
    }
    return {
      native,
      written,
      snapshots,
      tapWhileShowing: (index: number, target: string) => {
        const entry = timeline[index]!;
        timeline[index] = {
          ...entry,
          props: { ...entry.props, taps: [...(entry.props.taps ?? []), target] },
        };
      },
    };
  }

  function follow(
    fake: ReturnType<typeof timelineWidget>,
    timeline: (props: Score) => readonly WidgetEntry<Score>[],
    handled: unknown[] = [],
  ) {
    const events = fakeEvents();
    const received: string[][] = [];
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
    const score = signal<Score>({ us: '0', them: '0' });
    const ref = runInInjectionContext(injector, () =>
      widget(fake.native, score, { timeline, onTaps: (taps) => received.push([...taps]) }),
    );
    const flush = async () => {
      await settle();
      root.get(ApplicationRef).tick();
      await settle();
    };
    return { events, received, score, ref, flush };
  }

  const final = (props: Score) => [{ date: later, props: { ...props, them: 'final' } }];

  it("writes the signal's props for now, and then the entries the option answers for them", async () => {
    const fake = timelineWidget();
    const { score, flush } = follow(fake, final);
    await flush();
    score.set({ us: '15', them: '0' });
    await flush();
    const last = fake.written.at(-1)!;
    assert.deepEqual(
      last.map((entry) => entry.props),
      [
        { us: '15', them: '0' },
        { us: '15', them: 'final' },
      ],
    );
    assert.equal(last[1]!.date, later);
    assert.ok(last[0]!.date.getTime() <= Date.now());
    assert.deepEqual(fake.snapshots, [], 'a timeline is written whole, not as a snapshot');
  });

  it('collects the taps made while any entry was showing, oldest entry first', async () => {
    const fake = timelineWidget();
    const { received, events, flush } = follow(fake, final);
    await flush();
    fake.tapWhileShowing(1, 'them');
    fake.tapWhileShowing(0, 'us');
    events.foreground();
    await flush();
    assert.deepEqual(received, [['us', 'them']]);
    assert.ok(
      fake.written.at(-1)!.every((entry) => !entry.props.taps),
      'the write after it clears them',
    );
  });

  it("writes only the signal's props where the widget takes no timeline", async () => {
    const fake = timelineWidget(false);
    const { flush } = follow(fake, final);
    await flush();
    assert.deepEqual(fake.snapshots, [{ us: '0', them: '0' }]);
  });

  it('writes nothing where the option throws, and says why', async () => {
    const fake = timelineWidget();
    const handled: unknown[] = [];
    const failure = new Error('no entries');
    const { ref, flush } = follow(
      fake,
      () => {
        throw failure;
      },
      handled,
    );
    await flush();
    assert.deepEqual(fake.written, []);
    assert.equal(ref.error(), failure);
    assert.deepEqual(handled, [failure]);
  });
});
