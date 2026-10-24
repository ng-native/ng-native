/**
 * A setting that changes while the startup read is still on its way.
 *
 * React Native reports the accessibility settings asynchronously, and the change events are
 * subscribed before the answer arrives. An event in that gap is the newer value; the startup
 * answer was read before it and must not put the old one back.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Injector } from '@angular/core';
import { Accessibility, type AccessibilitySettings, watchConditions } from '@ng-native/device';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A source whose startup read resolves only when the test says so. */
function lateSource(startup: AccessibilitySettings) {
  let listener: (change: Partial<AccessibilitySettings>) => void = () => {};
  let answer: () => void = () => {};
  return {
    change: (value: Partial<AccessibilitySettings>) => listener(value),
    answer: () => answer(),
    value: {
      current: () =>
        new Promise<AccessibilitySettings>((resolve) => (answer = () => resolve(startup))),
      subscribe: (fn: typeof listener) => ((listener = fn), () => {}),
      announce: () => {},
    },
  };
}

/**
 * Runs `watchConditions` over a fake `react-native` whose `isReduceMotionEnabled` resolves
 * `startup` only when the test says so, and returns the reduced motion the engine was last told.
 */
async function watchReducedMotion(
  startup: boolean | Error,
  run: (control: {
    change: (value: boolean) => void;
    answer: () => void;
    stop: () => void;
  }) => void,
): Promise<boolean | undefined> {
  let reduceMotionChanged: (value: boolean) => void = () => {};
  let answer: () => void = () => {};
  const subscription = { remove: () => {} };
  const native = {
    AccessibilityInfo: {
      isScreenReaderEnabled: () => Promise.resolve(false),
      isReduceMotionEnabled: () =>
        new Promise<boolean>(
          (resolve, reject) =>
            (answer = () => (startup instanceof Error ? reject(startup) : resolve(startup))),
        ),
      isBoldTextEnabled: () => Promise.resolve(false),
      addEventListener: (event: string, handler: (value: boolean) => void) => {
        if (event === 'reduceMotionChanged') reduceMotionChanged = handler;
        return subscription;
      },
    },
    AppState: { currentState: 'active', addEventListener: () => subscription },
    Appearance: { getColorScheme: () => 'light', addChangeListener: () => subscription },
    Dimensions: {
      get: () => ({ width: 390, height: 844 }),
      addEventListener: () => subscription,
    },
    I18nManager: { isRTL: false },
    PixelRatio: { get: () => 3, getFontScale: () => 1 },
  };
  const updates: { reducedMotion?: boolean }[] = [];
  const engine = {
    root: 'root',
    updateConditions: (conditions: { reducedMotion?: boolean }) => updates.push(conditions),
    addClass: () => {},
    removeClass: () => {},
  };

  const host = globalThis as Record<string, unknown>;
  host['require'] = (id: string) => (id === 'react-native' ? native : undefined);
  host['nativeFabricUIManager'] = {};
  let stop = () => {};
  try {
    stop = watchConditions(engine);
    // Past the screen reader's read, so the reduced motion read has begun.
    await settle();
    run({ change: (value) => reduceMotionChanged(value), answer: () => answer(), stop });
    await settle();
    return updates.at(-1)?.reducedMotion;
  } finally {
    stop();
    delete host['require'];
    delete host['nativeFabricUIManager'];
  }
}

/** Runs `body` and returns the promise rejections nothing handled while it ran. */
async function unhandledDuring(body: () => Promise<unknown>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const listen = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  try {
    await body();
    await settle();
    await settle();
  } finally {
    process.off('unhandledRejection', listen);
  }
  return unhandled;
}

describe('an accessibility change before the startup read answers', () => {
  it('keeps the change, and takes the startup answer for the settings that did not change', async () => {
    const source = lateSource({
      screenReader: true,
      reduceMotion: true,
      boldText: false,
      fontScale: 1.5,
    });
    const settings = Injector.create({
      providers: [
        { provide: Accessibility.SOURCE, useValue: source.value },
        { provide: Accessibility, useClass: Accessibility, deps: [] },
      ],
    }).get(Accessibility);

    source.change({ reduceMotion: false });
    source.change({ screenReader: false });
    source.answer();
    await settle();

    assert.equal(settings.reduceMotion(), false, 'the event came after the read began');
    assert.equal(settings.screenReader(), false, 'a second event keeps the first');
    assert.equal(settings.boldText(), false);
    assert.equal(settings.fontScale(), 1.5);
  });

  it("keeps the engine's reduced motion at the change", async () => {
    const reducedMotion = await watchReducedMotion(true, ({ change, answer }) => {
      change(false);
      answer();
    });
    assert.equal(reducedMotion, false, 'the event came after the read began');
  });

  it("takes the startup answer for the engine's reduced motion when no event came", async () => {
    const reducedMotion = await watchReducedMotion(true, ({ answer }) => answer());
    assert.equal(reducedMotion, true);
  });

  it("leaves the engine's reduced motion alone when the startup answer comes after unsubscribe", async () => {
    const reducedMotion = await watchReducedMotion(true, ({ answer, stop }) => {
      stop();
      answer();
    });
    assert.equal(reducedMotion, undefined, 'nothing told the engine after it unsubscribed');
  });
});

describe('a startup read that fails', () => {
  it('keeps the neutral settings and still takes the changes', async () => {
    let listener: (change: Partial<AccessibilitySettings>) => void = () => {};
    const unhandled = await unhandledDuring(async () => {
      const settings = Injector.create({
        providers: [
          {
            provide: Accessibility.SOURCE,
            useValue: {
              current: () => Promise.reject(new Error('no answer')),
              subscribe: (fn: typeof listener) => ((listener = fn), () => {}),
              announce: () => {},
            },
          },
          { provide: Accessibility, useClass: Accessibility, deps: [] },
        ],
      }).get(Accessibility);
      await settle();
      assert.equal(settings.reduceMotion(), false);
      assert.equal(settings.fontScale(), 1);
      listener({ reduceMotion: true });
      assert.equal(settings.reduceMotion(), true);
    });
    assert.deepEqual(unhandled, []);
  });

  it("leaves the engine's reduced motion as it was", async () => {
    let reducedMotion: boolean | undefined;
    const unhandled = await unhandledDuring(async () => {
      reducedMotion = await watchReducedMotion(new Error('no answer'), ({ answer }) => answer());
    });
    assert.deepEqual(unhandled, []);
    assert.equal(reducedMotion, undefined);
  });
});
