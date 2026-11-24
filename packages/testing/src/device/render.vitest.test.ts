import {
  Component,
  Injectable,
  ViewContainerRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Text } from '@ng-native/components';
import { mount } from '@ng-native/platform';
import { expect, it, vi } from 'vitest';
import { createFakeFabric } from '../test-utils.ts';
import { harness } from './harness.ts';
import { cleanup, render, screen, settle } from './index.ts';
import { record } from './recorder.ts';

vi.mock('./harness.ts', () => ({ harness: vi.fn() }));

@Component({ selector: 'test-host', template: '<ng-container #slot />' })
class TestHost {
  readonly slot = viewChild.required('slot', { read: ViewContainerRef });
}

@Injectable({ providedIn: 'root' })
class Counter {
  readonly source = signal(0);
  readonly runs = signal(0);

  constructor() {
    effect(() => {
      this.source();
      this.runs.update((runs) => runs + 1);
    });
  }
}

@Component({
  selector: 'effect-probe',
  imports: [Text],
  template: '<text>Root runs {{ counter.runs() }}</text>',
})
class EffectProbe {
  readonly counter = inject(Counter);
  readonly source = signal(0);
  readonly runs = signal(0);

  constructor() {
    effect(() => {
      this.source();
      this.runs.update((runs) => runs + 1);
    });
  }
}

it('runs root effects alongside component effects and destroys the root effects on cleanup', async () => {
  const recorder = record(createFakeFabric());
  const app = mount(1, TestHost, recorder.fabric);
  const host = app.componentRef.instance as TestHost;
  vi.mocked(harness).mockReturnValue({
    app,
    slot: () => host.slot(),
    recorder,
    pool: { url: '', session: '' },
  });
  try {
    const { instance } = await render(EffectProbe);
    expect(instance.runs()).toBe(1);
    expect(screen.getByText('Root runs 1')).toBeTruthy();

    instance.source.set(1);
    instance.counter.source.set(1);
    await settle();
    expect(instance.runs()).toBe(2);
    expect(screen.getByText('Root runs 2')).toBeTruthy();

    instance.counter.source.set(2);
    cleanup();
    const second = await render(EffectProbe);
    expect(second.instance.counter).not.toBe(instance.counter);
    expect(screen.getByText('Root runs 1')).toBeTruthy();
    expect(instance.counter.runs()).toBe(2);
  } finally {
    try {
      cleanup();
    } finally {
      vi.mocked(harness).mockReset();
      app.applicationRef.destroy();
    }
  }
});
