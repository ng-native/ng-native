import { DestroyRef, InjectionToken, Injector, Service, inject } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('gives each call an app of its own', () => {
    const first = injectService(Scheme, { providers: [sourceOf('dark')] });
    const second = injectService(Scheme);

    expect(second).not.toBe(first);
    expect(second.current).toBe('light');
  });

  it("ends the service's DestroyRef on cleanup", () => {
    let unsubscribed = 0;
    injectService(Scheme, { providers: [sourceOf('dark', () => unsubscribed++)] });
    expect(unsubscribed).toBe(0);

    cleanup();

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
