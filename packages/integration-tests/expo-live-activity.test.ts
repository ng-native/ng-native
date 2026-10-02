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
import {
  liveActivity,
  type LiveActivityFactory,
  type NativeLiveActivity,
} from '@ng-native/expo/live-activity';
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
  const mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/counter.ts', import.meta.url)),
  );
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
