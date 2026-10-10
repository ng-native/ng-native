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
import {
  createLiveActivity,
  createWidget,
  liveActivity,
  type LiveActivityFactory,
  type NativeLiveActivity,
} from '@ng-native/expo/live-activity';
import { WIDGET_EVENTS, type WidgetTap } from '@ng-native/expo/widget';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Score {
  us: string;
  them: string;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeActivities(options: { running?: number; refuse?: boolean } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const instances: NativeLiveActivity<Score>[] = [];
  const tokenListeners = new Set<(event: { pushToken: string }) => void>();
  let next = 0;
  const create = (): NativeLiveActivity<Score> => {
    const id = `activity-${next++}`;
    const activity: NativeLiveActivity<Score> = {
      getId: () => id,
      update: async (props) => void calls.push(['update', id, props]),
      end: async (dismissal, props) => {
        calls.push(['end', id, dismissal, props]);
        instances.splice(instances.indexOf(activity), 1);
      },
      getPushToken: async () => null,
      addPushTokenListener: (listener) => {
        tokenListeners.add(listener);
        return { remove: () => tokenListeners.delete(listener) };
      },
    };
    instances.push(activity);
    return activity;
  };
  for (let i = 0; i < (options.running ?? 0); i++) create();
  const factory: LiveActivityFactory<Score> = {
    start: (props, url) => {
      if (options.refuse) throw new Error('Live Activities are turned off');
      const activity = create();
      calls.push(['start', activity.getId(), props, url]);
      return activity;
    },
    getInstances: () => [...instances],
  };
  return {
    factory,
    calls,
    instances,
    pushToken: (token: string) =>
      tokenListeners.forEach((listener) => listener({ pushToken: token })),
    listening: () => tokenListeners.size,
  };
}

let root: EnvironmentInjector;
before(async () => {
  const mod = await compileFixture('fixtures/counter.ts');
  root = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector.get(
    EnvironmentInjector,
  );
});

function withActivity(
  fake: ReturnType<typeof fakeActivities>,
  initial: Score = { us: '0', them: '0' },
) {
  const injector = createEnvironmentInjector([], root);
  const score = signal(initial);
  const activity = runInInjectionContext(injector, () => liveActivity(fake.factory, score));
  const flush = async () => {
    root.get(ApplicationRef).tick();
    await settle();
  };
  return { activity, score, flush, destroy: () => injector.destroy() };
}

describe('liveActivity', () => {
  it('is not live until started, and starts with the current props', async () => {
    const fake = fakeActivities();
    const { activity } = withActivity(fake, { us: '15', them: '0' });
    assert.equal(activity.active(), false);
    assert.equal(activity.start({ url: 'padel://match' }), true);
    assert.equal(activity.active(), true);
    assert.equal(activity.id(), 'activity-0');
    assert.deepEqual(fake.calls, [
      ['start', 'activity-0', { us: '15', them: '0' }, 'padel://match'],
    ]);
  });

  it('updates the activity whenever the signal changes', async () => {
    const fake = fakeActivities();
    const { activity, score, flush } = withActivity(fake);
    activity.start();
    score.set({ us: '30', them: '15' });
    await flush();
    assert.deepEqual(fake.calls.at(-1), ['update', 'activity-0', { us: '30', them: '15' }]);
  });

  it('picks up an activity left running from before the app started, rather than starting another', async () => {
    const fake = fakeActivities({ running: 1 });
    const { activity, flush } = withActivity(fake, { us: '40', them: '30' });
    assert.equal(activity.active(), true, 'live as it starts');
    await flush();
    assert.deepEqual(fake.calls, [['update', 'activity-0', { us: '40', them: '30' }]]);
    assert.equal(activity.start(), true);
    assert.equal(
      fake.instances.length,
      1,
      'iOS caps how many an app runs; a second start would fail',
    );
  });

  it('ends every activity of its kind with the final props, and can start again', async () => {
    const fake = fakeActivities({ running: 2 });
    const { activity } = withActivity(fake, { us: 'AD', them: '40' });
    await activity.end('immediate');
    assert.equal(activity.active(), false);
    assert.equal(activity.id(), null);
    assert.deepEqual(
      fake.calls.filter(([call]) => call === 'end').map(([, id, dismissal]) => [id, dismissal]),
      [
        ['activity-0', 'immediate'],
        ['activity-1', 'immediate'],
      ],
    );
    assert.equal(fake.instances.length, 0);
    assert.equal(activity.start(), true);
    assert.equal(activity.id(), 'activity-2');
  });

  it('reports a start the system refuses, and stays not live', () => {
    const fake = fakeActivities({ refuse: true });
    const { activity } = withActivity(fake);
    assert.equal(activity.start(), false);
    assert.equal(activity.active(), false);
    assert.match(String(activity.error()), /turned off/);
  });

  it('is not live off iOS, where expo-widgets starts a stand-in with no id', () => {
    const fake = fakeActivities();
    fake.factory.start = () => ({ ...fake.factory.getInstances()[0]!, getId: () => '' }) as never;
    const { activity } = withActivity(fake);
    assert.equal(activity.start(), false);
    assert.equal(activity.active(), false);
    assert.match(String(activity.error()), /only on iOS/, 'not a version to update to on Android');
  });

  it('hands an update that fails to the ErrorHandler', async () => {
    const fake = fakeActivities();
    const handled: unknown[] = [];
    const injector = createEnvironmentInjector(
      [
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => handled.push(error) },
        },
      ],
      root,
    );
    const score = signal<Score>({ us: '0', them: '0' });
    const activity = runInInjectionContext(injector, () => liveActivity(fake.factory, score));
    activity.start();
    fake.instances[0]!.update = async () => {
      throw new Error('update rejected');
    };
    score.set({ us: '15', them: '0' });
    root.get(ApplicationRef).tick();
    await settle();
    assert.match(String(handled[0]), /update rejected/);
    assert.match(String(activity.error()), /update rejected/);
    injector.destroy();
  });

  it('keeps the push token, and stops listening when destroyed without ending the activity', async () => {
    const fake = fakeActivities();
    const { activity, destroy } = withActivity(fake);
    activity.start();
    fake.pushToken('token-1');
    assert.equal(activity.pushToken(), 'token-1');
    destroy();
    assert.equal(fake.listening(), 0);
    assert.equal(fake.instances.length, 1, 'a Live Activity outlives the app that started it');
  });
});

/** Stands in for `expo-widgets`' interaction events, which carry every widget's and activity's taps. */
function fakeTaps() {
  const listeners = new Set<(tap: WidgetTap) => void>();
  const none = () => () => {};
  return {
    events: {
      onTap: (listener: (tap: WidgetTap) => void) => (
        listeners.add(listener),
        () => listeners.delete(listener)
      ),
      onForeground: none,
      onBackground: none,
    },
    tap: (source: string, target: string) =>
      listeners.forEach((listener) => listener({ source, target })),
    listening: () => listeners.size,
  };
}

describe("liveActivity's buttons", () => {
  function withTaps(
    fake: ReturnType<typeof fakeActivities>,
    onTaps: (taps: readonly string[]) => void,
  ) {
    const taps = fakeTaps();
    const handled: unknown[] = [];
    const injector = createEnvironmentInjector(
      [
        { provide: WIDGET_EVENTS, useValue: taps.events },
        {
          provide: ErrorHandler,
          useValue: { handleError: (error: unknown) => handled.push(error) },
        },
      ],
      root,
    );
    const activity = runInInjectionContext(injector, () =>
      liveActivity(fake.factory, signal<Score>({ us: '0', them: '0' }), { onTaps }),
    );
    return { activity, taps, handled, destroy: () => injector.destroy() };
  }

  it('hands a tap on one of its buttons to onTaps, by its target', () => {
    const received: string[][] = [];
    const { activity, taps } = withTaps(fakeActivities(), (targets) => received.push([...targets]));
    activity.start();
    taps.tap('activity-0', 'us');
    taps.tap('activity-0', 'them');
    assert.deepEqual(received, [['us'], ['them']]);
  });

  it('hands over a tap on any running activity of its kind, started here or not', () => {
    const received: string[][] = [];
    const { taps } = withTaps(fakeActivities({ running: 2 }), (targets) =>
      received.push([...targets]),
    );
    taps.tap('activity-1', 'us');
    assert.deepEqual(received, [['us']]);
  });

  it("leaves a widget's tap, and another kind of activity's, to whoever it belongs to", () => {
    const received: string[][] = [];
    const { activity, taps } = withTaps(fakeActivities(), (targets) => received.push([...targets]));
    activity.start();
    taps.tap('ScoreWidget', 'us');
    taps.tap('activity-of-another-kind', 'us');
    assert.deepEqual(received, []);
  });

  it('leaves a tap on an activity that has ended', async () => {
    const received: string[][] = [];
    const { activity, taps } = withTaps(fakeActivities(), (targets) => received.push([...targets]));
    activity.start();
    await activity.end('immediate');
    taps.tap('activity-0', 'us');
    assert.deepEqual(received, []);
  });

  it('hands an onTaps that throws to the ErrorHandler, and keeps listening', () => {
    const received: string[] = [];
    const { activity, taps, handled } = withTaps(fakeActivities(), ([target]) => {
      received.push(target!);
      if (target === 'bad') throw new Error('bad tap');
    });
    activity.start();
    taps.tap('activity-0', 'bad');
    taps.tap('activity-0', 'us');
    assert.match(String(handled[0]), /bad tap/);
    assert.deepEqual(received, ['bad', 'us']);
  });

  it('hands an asynchronous onTaps that rejects to the ErrorHandler', async () => {
    const { activity, taps, handled } = withTaps(fakeActivities(), async () => {
      throw new Error('bad tap, later');
    });
    activity.start();
    taps.tap('activity-0', 'us');
    await Promise.resolve();
    assert.match(String(handled[0]), /bad tap, later/);
  });

  it('stops listening when destroyed, and never listens with no onTaps', () => {
    const { taps, destroy } = withTaps(fakeActivities(), () => {});
    assert.equal(taps.listening(), 1);
    destroy();
    assert.equal(taps.listening(), 0);

    const unused = fakeTaps();
    const injector = createEnvironmentInjector(
      [{ provide: WIDGET_EVENTS, useValue: unused.events }],
      root,
    );
    runInInjectionContext(injector, () =>
      liveActivity(fakeActivities().factory, signal<Score>({ us: '0', them: '0' })),
    );
    assert.equal(unused.listening(), 0);
    injector.destroy();
  });
});

describe('createLiveActivity and createWidget', () => {
  it('say the transformer did not run, where a layout reaches them as a class', () => {
    class ScoreLayout {
      readonly props = null as never;
    }
    // In Node there is no expo-widgets to hand the layout to, so this stands in for the platform.
    const expo = { createLiveActivity: () => ({}), createWidget: () => ({}) };
    const require = (globalThis as { require?: unknown }).require;
    (globalThis as { require?: unknown }).require = () => expo;
    try {
      assert.throws(
        () => createLiveActivity('Score', ScoreLayout),
        /createLiveActivity\('Score', \.\.\.\).*@ng-native\/metro/,
      );
      assert.throws(
        () => createWidget('Score', ScoreLayout),
        /createWidget\('Score', \.\.\.\).*@ng-native\/metro/,
      );
    } finally {
      (globalThis as { require?: unknown }).require = require;
    }
  });

  it('answer an activity that never starts in Node, where there is no expo-widgets', () => {
    const factory = createLiveActivity('Score', 'function(){}' as never);
    assert.equal(factory.start({}).getId(), '');
    assert.deepEqual(factory.getInstances(), []);
  });

  it('answer a widget that draws nothing in Node, which widget() can still keep in step', async () => {
    const widget = createWidget('Score', 'function(){}' as never);
    widget.updateSnapshot({});
    widget.reload();
    assert.deepEqual(await widget.getTimeline(), []);
  });
});
