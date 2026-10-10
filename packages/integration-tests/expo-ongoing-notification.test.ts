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
  ONGOING_NOTIFICATIONS,
  ongoingNotification,
  type NativeOngoingNotifications,
  type OngoingNotificationContent,
  type OngoingNotificationOptions,
} from '@ng-native/expo/ongoing-notification';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Stands in for the native module: what is shown, the taps it has stored, and its one event. */
function fakeNative(options: { showing?: string[]; refuse?: boolean; promoted?: boolean } = {}) {
  const calls: [string, ...unknown[]][] = [];
  const showing = new Set(options.showing ?? []);
  const stored = new Map<string, string[]>();
  const listeners = new Set<() => void>();
  const native: NativeOngoingNotifications = {
    show: async (id, content, shown) => {
      if (options.refuse) throw new Error('Notifications are turned off');
      calls.push(['show', id, content, shown]);
      showing.add(id);
      return { promoted: options.promoted ?? false };
    },
    cancel: (id) => {
      calls.push(['cancel', id]);
      showing.delete(id);
    },
    isActive: (id) => showing.has(id),
    takeTaps: (id) => stored.get(id)?.splice(0) ?? [],
    openPromotionSettings: () => void calls.push(['settings']),
    onChange: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
  const change = () => listeners.forEach((listener) => listener());
  return {
    native,
    calls,
    listening: () => listeners.size,
    /** A tap on an action, as the receiver stores it and then says so. */
    tap: (id: string, target: string, announce = true) => {
      stored.set(id, [...(stored.get(id) ?? []), target]);
      if (announce) change();
    },
    /** The user swiping the notification away. */
    dismiss: (id: string) => {
      showing.delete(id);
      change();
    },
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
  fake: ReturnType<typeof fakeNative> | null,
  options: Partial<OngoingNotificationOptions> = {},
  initial: OngoingNotificationContent = { title: 'Us 0 - 0 Them' },
) {
  const handled: unknown[] = [];
  const received: string[][] = [];
  const injector = createEnvironmentInjector(
    [
      { provide: ONGOING_NOTIFICATIONS, useValue: fake?.native ?? null },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => handled.push(error) } },
    ],
    root,
  );
  const content = signal(initial);
  const ref = runInInjectionContext(injector, () =>
    ongoingNotification(content, {
      channel: { id: 'match', name: 'Match' },
      onTaps: (taps) => received.push([...taps]),
      ...options,
    }),
  );
  const flush = async () => {
    root.get(ApplicationRef).tick();
    await settle();
  };
  return { ref, content, flush, handled, received, destroy: () => injector.destroy() };
}

describe('ongoingNotification', () => {
  it('shows nothing until started, then shows the content on its channel', async () => {
    const fake = fakeNative();
    const { ref, flush } = setup(fake, { url: 'padel://match' });
    await flush();
    assert.equal(ref.active(), false);
    assert.deepEqual(fake.calls, []);
    assert.equal(await ref.start(), true);
    assert.equal(ref.active(), true);
    assert.deepEqual(fake.calls, [
      [
        'show',
        'match',
        { title: 'Us 0 - 0 Them' },
        { channel: { id: 'match', name: 'Match' }, url: 'padel://match' },
      ],
    ]);
  });

  it('shows each change to the signal while it is live, under the same id', async () => {
    const fake = fakeNative();
    const { ref, content, flush } = setup(fake, { id: 'court-1' });
    await ref.start();
    content.set({ title: 'Us 15 - 0 Them', text: 'First set' });
    await flush();
    assert.deepEqual(
      fake.calls.map(([call, id, shown]) => [call, id, shown]),
      [
        ['show', 'court-1', { title: 'Us 0 - 0 Them' }],
        ['show', 'court-1', { title: 'Us 15 - 0 Them', text: 'First set' }],
      ],
    );
  });

  it('shows what the signal holds by the time Android has answered the permission', async () => {
    const fake = fakeNative();
    const { ref, content } = setup(fake);
    const started = ref.start();
    content.set({ title: 'Us 15 - 0 Them' });
    await started;
    assert.deepEqual(fake.calls.at(-1)![2], { title: 'Us 15 - 0 Them' });
  });

  it('hands Android a timer as milliseconds, whether it is a Date or a number', async () => {
    const fake = fakeNative();
    const { ref } = setup(fake, {}, { title: 'Rest', timer: { until: new Date(60000) } });
    await ref.start();
    assert.deepEqual(fake.calls[0]![2], { title: 'Rest', timer: { until: 60000 } });

    const counting = fakeNative();
    const second = setup(counting, {}, { title: 'Match', timer: { since: 1000 } });
    await second.ref.start();
    assert.deepEqual(counting.calls[0]![2], { title: 'Match', timer: { since: 1000 } });
  });

  it('picks up a notification left showing from before the app started, and updates it', async () => {
    const fake = fakeNative({ showing: ['match'] });
    const { ref, content, flush } = setup(fake);
    assert.equal(ref.active(), true);
    content.set({ title: 'Us 30 - 0 Them' });
    await flush();
    assert.deepEqual(fake.calls.at(-1)!.slice(0, 3), [
      'show',
      'match',
      { title: 'Us 30 - 0 Them' },
    ]);
  });

  it('says whether Android promoted it to a Live Update', async () => {
    const { ref } = setup(fakeNative({ promoted: true }));
    assert.equal(ref.promoted(), false);
    await ref.start();
    assert.equal(ref.promoted(), true);
  });

  it('ends it, and stops following the signal', async () => {
    const fake = fakeNative();
    const { ref, content, flush } = setup(fake);
    await ref.start();
    ref.end();
    assert.equal(ref.active(), false);
    assert.equal(ref.promoted(), false);
    content.set({ title: 'Us 15 - 0 Them' });
    await flush();
    assert.deepEqual(
      fake.calls.map(([call]) => call),
      ['show', 'cancel'],
    );
  });

  it('keeps why a start was refused, and stays not live', async () => {
    const { ref, handled } = setup(fakeNative({ refuse: true }));
    assert.equal(await ref.start(), false);
    assert.equal(ref.active(), false);
    assert.match(String(ref.error()), /turned off/);
    assert.deepEqual(handled, [], 'a refusal is the user’s choice, not a fault');
  });

  it('does not start off Android, where the module is absent', async () => {
    const { ref } = setup(null);
    assert.equal(await ref.start(), false);
    assert.match(String(ref.error()), /only on Android/);
    ref.end();
    ref.openPromotionSettings();
  });

  it('is no longer live once the user swipes it away, and is not shown again by a change', async () => {
    const fake = fakeNative();
    const { ref, content, flush } = setup(fake);
    await ref.start();
    fake.dismiss('match');
    assert.equal(ref.active(), false);
    content.set({ title: 'Us 15 - 0 Them' });
    await flush();
    assert.equal(fake.calls.length, 1);
  });
});

describe("ongoingNotification's actions", () => {
  it('hands a tap to onTaps once, when Android says there is one', async () => {
    const fake = fakeNative();
    const { ref, received } = setup(fake);
    await ref.start();
    fake.tap('match', 'us');
    fake.tap('match', 'them');
    assert.deepEqual(received, [['us'], ['them']]);
  });

  it('hands over the taps stored while the app was not running, once it is', async () => {
    const fake = fakeNative({ showing: ['match'] });
    fake.tap('match', 'us', false);
    fake.tap('match', 'us', false);
    const { received } = setup(fake);
    assert.deepEqual(received, [], 'not while the caller is still being built');
    await settle();
    assert.deepEqual(received, [['us', 'us']]);
  });

  it("leaves another notification's taps where they are", async () => {
    const fake = fakeNative();
    const { ref, received } = setup(fake);
    await ref.start();
    fake.tap('court-2', 'us');
    assert.deepEqual(received, []);
    assert.deepEqual(fake.native.takeTaps('court-2'), ['us']);
  });

  it('hands an onTaps that throws to the ErrorHandler, and keeps listening', async () => {
    const fake = fakeNative();
    const seen: string[] = [];
    const { ref, handled } = setup(fake, {
      onTaps: ([target]) => {
        seen.push(target!);
        if (target === 'bad') throw new Error('bad tap');
      },
    });
    await ref.start();
    fake.tap('match', 'bad');
    fake.tap('match', 'us');
    assert.match(String(handled[0]), /bad tap/);
    assert.deepEqual(seen, ['bad', 'us']);
  });

  it('stops listening when destroyed, and leaves the notification showing', async () => {
    const fake = fakeNative();
    const { ref, destroy } = setup(fake);
    await ref.start();
    assert.equal(fake.listening(), 1);
    destroy();
    assert.equal(fake.listening(), 0);
    assert.equal(fake.native.isActive('match'), true);
  });
});
