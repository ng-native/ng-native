import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ApplicationInitStatus,
  ApplicationRef,
  ErrorHandler,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { installJsdomEnvironment } from './jsdom-env.ts';
import type { MountResult } from './mount.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mount() runs the app initializers', () => {
  let mounted: MountResult | undefined;

  afterEach(() => {
    mounted?.destroy();
    mounted = undefined;
  });

  async function boot() {
    const { document } = installJsdomEnvironment();
    const [{ mount }, { Greeting, InitializedApp }] = await Promise.all([
      import('./mount.ts'),
      import('./app-initializers-app.ts'),
    ]);
    const root = document.createElement('app-root');
    document.body.appendChild(root);
    return { root, mount, Greeting, InitializedApp };
  }

  it('before the root component renders', async () => {
    const { root, mount, Greeting, InitializedApp } = await boot();
    const seen: number[] = [];
    mounted = mount(root, InitializedApp, {
      providers: [
        provideAppInitializer(() => {
          seen.push(inject(ApplicationRef).components.length);
          inject(Greeting).text.set('loaded');
        }),
      ],
    });

    assert.deepEqual(seen, [0], 'ran once, before the root component');
    const app = mounted.componentRef.instance as InstanceType<typeof InitializedApp>;
    assert.equal(app.textAtCreation, 'loaded', 'ran before the root component was created');
    assert.equal(root.textContent?.trim(), 'loaded');
    assert.equal(mounted.componentRef.injector.get(ApplicationInitStatus).done, true);
  });

  it('starts one that returns a promise without holding up the first render', async () => {
    const { root, mount, InitializedApp } = await boot();
    let finish!: () => void;
    mounted = mount(root, InitializedApp, {
      providers: [provideAppInitializer(() => new Promise<void>((r) => (finish = r)))],
    });
    const status = mounted.componentRef.injector.get(ApplicationInitStatus);

    assert.equal(root.textContent?.trim(), 'not loaded', 'the root rendered meanwhile');
    assert.equal(status.done, false);
    finish();
    await status.donePromise;
    assert.equal(status.done, true);
  });

  it('hands a failed one to the ErrorHandler', async () => {
    const { root, mount, InitializedApp } = await boot();
    const errors: unknown[] = [];
    mounted = mount(root, InitializedApp, {
      providers: [
        { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
        provideAppInitializer(() => Promise.reject(new Error('no config'))),
      ],
    });
    await settle();

    assert.deepEqual(
      errors.map((e) => (e as Error).message),
      ['no config'],
    );
  });
});
