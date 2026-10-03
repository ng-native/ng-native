import { DestroyRef, InjectionToken, Injector, Service, inject } from '@angular/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, injectService, render, screen } from './index.ts';

interface Source {
  current(): string;
  subscribe(listener: () => void): () => void;
}

const SOURCE = new InjectionToken<Source>('test.source', {
  factory: () => ({ current: () => 'light', subscribe: () => () => {} }),
});

@Service()
class Clock {
  readonly hour = 9;
}

@Service()
class Scheme {
  private readonly source = inject(SOURCE);
  readonly clock = inject(Clock);
  readonly current = this.source.current();

  constructor() {
    inject(DestroyRef).onDestroy(this.source.subscribe(() => {}));
  }
}

const sourceOf = (current: string, onUnsubscribe = () => {}) => ({
  provide: SOURCE,
  useValue: { current: () => current, subscribe: () => onUnsubscribe },
});

describe('injectService', () => {
  afterEach(() => cleanup());

  it('creates a root service, and the root services it injects, with no component', () => {
    const scheme = injectService(Scheme);

    expect(scheme.current).toBe('light');
    expect(scheme.clock.hour).toBe(9);
  });

  it('takes providers that replace what the service injects', () => {
    expect(injectService(Scheme, { providers: [sourceOf('dark')] }).current).toBe('dark');
  });

  it('gives a second call the app the first one made, so two services share a root', () => {
    const scheme = injectService(Scheme);
    const clock = injectService(Clock);

    expect(scheme.clock).toBe(clock);
    expect(injectService(Scheme)).toBe(scheme);
  });

  it('keeps to the app a call with providers made, for the calls after it', () => {
    const scheme = injectService(Scheme, { providers: [sourceOf('dark')] });

    expect(injectService(Scheme)).toBe(scheme);
    expect(injectService(Clock)).toBe(scheme.clock);
  });

  it('starts a new app for a call with providers, which the calls after it then use', () => {
    const light = injectService(Scheme);
    const dark = injectService(Scheme, { providers: [sourceOf('dark')] });

    expect(dark).not.toBe(light);
    expect(dark.current).toBe('dark');
    expect(injectService(Scheme)).toBe(dark);
  });

  it('starts a new app for an empty list of providers too', () => {
    const first = injectService(Scheme);

    expect(injectService(Scheme, { providers: [] })).not.toBe(first);
  });

  it('starts again after cleanup', () => {
    const before = injectService(Scheme);
    cleanup();

    expect(injectService(Scheme)).not.toBe(before);
  });

  it("ends the service's DestroyRef on cleanup", () => {
    let unsubscribed = 0;
    injectService(Scheme, { providers: [sourceOf('dark', () => unsubscribed++)] });
    expect(unsubscribed).toBe(0);

    cleanup();

    expect(unsubscribed).toBe(1);
  });

  it('destroys every app on cleanup when one throws, then throws the first error', () => {
    let unsubscribed = 0;
    const failure = new Error('teardown failed');
    injectService(Scheme, {
      providers: [
        sourceOf('dark', () => {
          throw failure;
        }),
      ],
    });
    injectService(Scheme, {
      providers: [
        sourceOf('dark', () => {
          throw new Error('a later teardown failed');
        }),
      ],
    });
    injectService(Scheme, { providers: [sourceOf('dark', () => unsubscribed++)] });

    expect(() => cleanup()).toThrow(failure);
    expect(unsubscribed).toBe(1);
  });

  it('leaves a render as the one screen queries', async () => {
    await render('<text>Shown</text>');
    injectService(Scheme);

    expect(screen.getByText('Shown')).toBeTruthy();
  });

  it('finds a service Injector.create cannot', () => {
    expect(() => Injector.create({ providers: [sourceOf('dark')] }).get(Scheme)).toThrow(/NG0201/);
    expect(injectService(Scheme, { providers: [sourceOf('dark')] }).current).toBe('dark');
  });
});

describe('injectService, in a file that never calls cleanup', () => {
  let earlier: Scheme | undefined;

  it('makes an app in one test', () => {
    earlier = injectService(Scheme);
    expect(injectService(Scheme)).toBe(earlier);
  });

  it("and another in the next, which cannot see the first one's services", () => {
    expect(earlier).toBeDefined();
    expect(injectService(Scheme)).not.toBe(earlier);
  });
});

describe('injectService, in tests that run at once', () => {
  const made: Scheme[] = [];
  let started = () => {};
  const both = new Promise<void>((resolve) => (started = resolve));

  // Each waits for the other to have started, so both are under way when either asks again.
  const run = async () => {
    made.push(injectService(Scheme));
    if (made.length === 2) started();
    await both;
    made.push(injectService(Scheme));
  };

  it.concurrent('gives one test no app of another that is still running', run);
  it.concurrent('and the other none of the first', run);

  it('so no two of their services are the same', () => {
    expect(made).toHaveLength(4);
    expect(new Set(made).size).toBe(4);
  });
});

describe('injectService, before any test', () => {
  let before: Scheme;
  beforeAll(() => {
    before = injectService(Scheme);
  });

  it("makes an app that is no test's, so the first test does not share it", () => {
    expect(injectService(Scheme)).not.toBe(before);
  });
});
