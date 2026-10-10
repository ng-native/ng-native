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
  pushToStartToken,
  type LiveActivityFactory,
  type LiveActivityOptions,
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
  /** The stale date each start and update was given, in order. */
  const stale: (Date | undefined)[] = [];
  let next = 0;
  const create = (): NativeLiveActivity<Score> => {
    const id = `activity-${next++}`;
    const activity: NativeLiveActivity<Score> = {
      getId: () => id,
      update: async (props, staleDate) => {
        calls.push(['update', id, props]);
        stale.push(staleDate);
      },
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
    start: (props, url, staleDate) => {
      if (options.refuse) throw new Error('Live Activities are turned off');
      const activity = create();
      calls.push(['start', activity.getId(), props, url]);
      stale.push(staleDate);
      return activity;
    },
    getInstances: () => [...instances],
  };
  return {
    factory,
    calls,
    stale,
    instances,
    pushToken: (token: string) =>
      tokenListeners.forEach((listener) => listener({ pushToken: token })),
    listening: () => tokenListeners.size,
  };
}

let root: EnvironmentInjector;
let counter: Type<unknown>;
before(async () => {
  const mod = await compileFixture('fixtures/counter.ts');
  counter = mod['Counter'] as Type<unknown>;
  root = mount(1, counter, createFakeFabric()).componentRef.injector.get(EnvironmentInjector);
});

function withActivity(
  fake: ReturnType<typeof fakeActivities>,
  initial: Score = { us: '0', them: '0' },
  options?: LiveActivityOptions,
) {
  const injector = createEnvironmentInjector([], root);
  const score = signal(initial);
  const activity = runInInjectionContext(injector, () =>
    liveActivity(fake.factory, score, options),
  );
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

  it('does nothing when started while it is live', () => {
    const fake = fakeActivities();
    const { activity } = withActivity(fake);
    activity.start();
    assert.equal(activity.start(), true);
    assert.deepEqual(
      fake.calls.map(([call]) => call),
      ['start'],
    );
    assert.equal(fake.listening(), 1, 'one listener for the push token, not one a start');
  });

  it('forgets the push token when it ends', async () => {
    const fake = fakeActivities();
    const { activity } = withActivity(fake);
    activity.start();
    fake.pushToken('abc');
    assert.equal(activity.pushToken(), 'abc');
    await activity.end();
    assert.equal(activity.pushToken(), null);
  });

  it('forgets why a start was refused once one works', () => {
    const allowed = { refuse: true };
    const fake = fakeActivities(allowed);
    const { activity } = withActivity(fake);
    assert.equal(activity.start(), false);
    assert.match(String(activity.error()), /turned off/);
    allowed.refuse = false;
    assert.equal(activity.start(), true);
    assert.equal(activity.error(), null);
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

describe("liveActivity's stale date", () => {
  const first = new Date('2026-01-01T10:00:00Z');
  const second = new Date('2026-01-01T10:05:00Z');

  it('gives the start, and each update, the date the option answers then', async () => {
    const fake = fakeActivities();
    const dates = [first, second];
    const { activity, score, flush } = withActivity(fake, undefined, {
      staleDate: () => dates.shift(),
    });
    await flush();
    activity.start();
    score.set({ us: '15', them: '0' });
    await flush();
    assert.deepEqual(fake.stale, [first, second]);
  });

  it('gives an activity it picks up the date, with the props it writes it', async () => {
    const fake = fakeActivities({ running: 1 });
    const { activity, flush } = withActivity(fake, undefined, { staleDate: () => first });
    await flush();
    activity.start();
    await flush();
    assert.ok(fake.stale.length);
    assert.ok(fake.stale.every((date) => date === first));
  });

  it('gives none where the option answers null, or there is no option', async () => {
    for (const options of [{ staleDate: () => null }, undefined]) {
      const fake = fakeActivities();
      const { activity, score, flush } = withActivity(fake, undefined, options);
      activity.start();
      score.set({ us: '15', them: '0' });
      await flush();
      assert.deepEqual(fake.stale, [undefined, undefined]);
    }
  });

  it('keeps a start whose date cannot be had as a refused one, and an update as a failed one', async () => {
    const fake = fakeActivities({ running: 1 });
    const handled: unknown[] = [];
    const failure = new Error('no date');
    let fail = false;
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
    const activity = runInInjectionContext(injector, () =>
      liveActivity(fake.factory, score, {
        staleDate: () => {
          if (fail) throw failure;
          return first;
        },
      }),
    );
    fail = true;
    score.set({ us: '15', them: '0' });
    root.get(ApplicationRef).tick();
    await settle();
    assert.equal(activity.error(), failure);
    assert.deepEqual(handled, [failure]);

    const none = fakeActivities();
    const refused = withActivity(none, undefined, {
      staleDate: () => {
        throw failure;
      },
    });
    assert.equal(refused.activity.start(), false);
    assert.equal(refused.activity.error(), failure);
    assert.equal(none.instances.length, 0);
  });
});

/** Stands in for `expo-widgets`' interaction events, which carry every widget's and activity's taps. */
function fakeTaps(held: WidgetTap[] = []) {
  const listeners = new Set<(tap: WidgetTap) => void>();
  const asked: string[][] = [];
  const none = () => () => {};
  return {
    events: {
      onTap: (listener: (tap: WidgetTap) => void) => (
        listeners.add(listener),
        () => listeners.delete(listener)
      ),
      takeHeld: (sources: readonly string[]) => {
        asked.push([...sources]);
        return held.splice(0).filter((tap) => sources.includes(tap.source));
      },
      onForeground: none,
      onBackground: none,
    },
    tap: (source: string, target: string, timestamp = 0) =>
      listeners.forEach((listener) => listener({ source, target, timestamp })),
    listening: () => listeners.size,
    asked,
  };
}

describe("liveActivity's buttons", () => {
  function withTaps(
    fake: ReturnType<typeof fakeActivities>,
    onTaps: (taps: readonly string[]) => void,
    held: WidgetTap[] = [],
  ) {
    const taps = fakeTaps(held);
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

  it('hands over the taps made before the app was listening, by the activities they came from', async () => {
    const received: string[][] = [];
    const { taps } = withTaps(
      fakeActivities({ running: 1 }),
      (targets) => received.push([...targets]),
      [
        { source: 'activity-0', target: 'us', timestamp: 1 },
        { source: 'activity-0', target: 'them', timestamp: 2 },
      ],
    );
    assert.deepEqual(received, [], 'not while the caller is still being built');
    await settle();
    assert.deepEqual(taps.asked, [['activity-0']]);
    assert.deepEqual(received, [['us', 'them']]);
  });

  it('hands a held tap over once when it arrives as it happens too', async () => {
    const received: string[][] = [];
    const { taps } = withTaps(
      fakeActivities({ running: 1 }),
      (targets) => received.push([...targets]),
      [{ source: 'activity-0', target: 'us', timestamp: 1 }],
    );
    taps.tap('activity-0', 'us', 1);
    await settle();
    taps.tap('activity-0', 'us', 2);
    assert.deepEqual(received, [['us'], ['us']], 'the held one, then only the later tap');
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

describe('pushToStartToken', () => {
  type TokenListener = (event: { activityPushToStartToken: string }) => void;

  /** Stands in for `expo-widgets`, which hands the token it has only to the first to listen. */
  function fakeExpoWidgets() {
    const listeners = new Set<TokenListener>();
    let issued: string | null = null;
    return {
      expo: {
        addUserInteractionListener: () => ({ remove() {} }),
        addPushToStartTokenListener: (listener: TokenListener) => {
          if (!listeners.size && issued !== null) listener({ activityPushToStartToken: issued });
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      },
      issue: (token: string) => {
        issued = token;
        listeners.forEach((listener) => listener({ activityPushToStartToken: token }));
      },
      listening: () => listeners.size,
    };
  }

  /** A new app, whose events load `expo` as an app on a device loads `expo-widgets`. */
  function withExpoWidgets(expo: unknown, run: (read: () => string | null) => void) {
    const scope = globalThis as { require?: unknown };
    const require = scope.require;
    scope.require = (name: string) => {
      if (name === 'expo-widgets') return expo;
      throw new Error(`${name} is not in Node`);
    };
    const app = mount(2, counter, createFakeFabric());
    try {
      const injector = app.componentRef.injector.get(EnvironmentInjector);
      run(() => runInInjectionContext(injector, pushToStartToken)());
    } finally {
      app.applicationRef.destroy();
      scope.require = require;
    }
  }

  it('is null until iOS issues a token, and then the latest one', () => {
    const fake = fakeExpoWidgets();
    withExpoWidgets(fake.expo, (read) => {
      assert.equal(read(), null);
      fake.issue('token-1');
      assert.equal(read(), 'token-1');
      fake.issue('token-2');
      assert.equal(read(), 'token-2');
    });
  });

  it('holds a token issued before it was asked for', () => {
    const fake = fakeExpoWidgets();
    fake.issue('token-1');
    withExpoWidgets(fake.expo, (read) => assert.equal(read(), 'token-1'));
  });

  it('listens once for all who ask, as only the first to listen is handed the token there is', () => {
    const fake = fakeExpoWidgets();
    fake.issue('token-1');
    withExpoWidgets(fake.expo, (read) => {
      assert.equal(read(), 'token-1');
      assert.equal(read(), 'token-1');
      assert.equal(fake.listening(), 1);
    });
  });

  it('does not listen until asked, and stops when the app is destroyed', () => {
    const fake = fakeExpoWidgets();
    withExpoWidgets(fake.expo, (read) => {
      assert.equal(fake.listening(), 0);
      read();
      assert.equal(fake.listening(), 1);
    });
    assert.equal(fake.listening(), 0);
  });

  it('is null where expo-widgets has no such listener', () => {
    withExpoWidgets({ addUserInteractionListener: () => ({ remove() {} }) }, (read) =>
      assert.equal(read(), null),
    );
  });

  it('is null in Node, where there is no expo-widgets', () => {
    assert.equal(runInInjectionContext(root, pushToStartToken)(), null);
  });

  it('reads the token of the events a test stands in, and is null where they have none', () => {
    const token = signal<string | null>('token-1');
    const read = (events: object) => {
      const injector = createEnvironmentInjector(
        [{ provide: WIDGET_EVENTS, useValue: events }],
        root,
      );
      return runInInjectionContext(injector, pushToStartToken)();
    };
    assert.equal(read({ ...fakeTaps().events, pushToStartToken: () => token }), 'token-1');
    assert.equal(read(fakeTaps().events), null);
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
