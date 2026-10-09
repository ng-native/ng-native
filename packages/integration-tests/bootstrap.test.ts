/**
 * Bootstrap: what `mount()` does in place of `bootstrapApplication`, and the private Angular APIs
 * it leans on.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  APP_BOOTSTRAP_LISTENER,
  ApplicationInitStatus,
  ApplicationRef,
  ErrorHandler,
  InjectionToken,
  inject,
  provideAppInitializer,
  type ComponentRef,
  type Type,
} from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const ROOT_TAG = 1;

/** Zoneless change detection lands on a microtask; let it settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('bootstrap registers the root component with ApplicationRef', () => {
  it('runs listeners with a ref the router will accept', async () => {
    const mod = await compileFixture('fixtures/counter.ts');
    const seen: ComponentRef<unknown>[] = [];

    const app = mount(ROOT_TAG, mod['Counter'] as Type<unknown>, createFakeFabric(), {
      providers: [
        {
          provide: APP_BOOTSTRAP_LISTENER,
          multi: true,
          useValue: (ref: ComponentRef<unknown>) => seen.push(ref),
        },
      ],
    });
    await settle();

    // The router's bootstrap listener returns early unless the ref it is handed is
    // `ApplicationRef.components[0]`, so without this the initial navigation never runs and a
    // routed app renders nothing but its outlet's host.
    assert.equal(app.applicationRef.components[0], app.componentRef);
    assert.equal(app.applicationRef.componentTypes[0], mod['Counter']);
    assert.deepEqual(seen, [app.componentRef], 'listeners ran, and with that same ref');

    app.componentRef.destroy();
    assert.deepEqual(app.applicationRef.components, [], 'and it is unregistered on destroy');
  });
});

describe('bootstrap runs the app initializers', () => {
  const GREETING = new InjectionToken<string>('greeting');
  let Counter: Type<unknown>;

  before(async () => {
    const mod = await compileFixture('fixtures/counter.ts');
    Counter = mod['Counter'] as Type<unknown>;
  });

  it('runs one before the root component exists, where it can inject', () => {
    const seen: string[] = [];

    const app = mount(ROOT_TAG, Counter, createFakeFabric(), {
      providers: [
        { provide: GREETING, useValue: 'hello' },
        provideAppInitializer(() => {
          seen.push(`${inject(GREETING)}, ${inject(ApplicationRef).components.length} components`);
        }),
      ],
    });

    // `provideAppInitializer` is what an app reaches for to start a service at boot. Under a
    // bare `createEnvironmentInjector` it registered and never ran, with nothing to say so.
    assert.deepEqual(seen, ['hello, 0 components']);
    assert.equal(app.componentRef.injector.get(ApplicationInitStatus).done, true);
  });

  it('starts one that returns a promise without holding up the first frame', async () => {
    let finish!: () => void;
    const fabric = createFakeFabric();

    const app = mount(ROOT_TAG, Counter, fabric, {
      providers: [provideAppInitializer(() => new Promise<void>((r) => (finish = r)))],
    });
    const status = app.componentRef.injector.get(ApplicationInitStatus);
    await settle();

    assert.ok(fabric.committed.length > 0, 'the root rendered while the initializer ran');
    assert.equal(status.done, false);
    finish();
    await status.donePromise;
    assert.equal(status.done, true);
  });

  it('hands a failed one to the ErrorHandler rather than dropping it', async () => {
    const errors: unknown[] = [];

    mount(ROOT_TAG, Counter, createFakeFabric(), {
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

describe('private Angular APIs used by bootstrap', () => {
  it('are still exported (fails loudly on upgrade)', async () => {
    const core = (await import('@angular/core')) as Record<string, unknown>;
    for (const name of [
      'ɵcreateOrReusePlatformInjector',
      'ɵINJECTOR_SCOPE',
      'ɵprovideZonelessChangeDetectionInternal',
    ]) {
      assert.ok(core[name], `@angular/core no longer exports ${name}`);
    }
    // Not exported but not public either: `ApplicationInitStatus.runInitializers`, which is what
    // Angular's own bootstrap calls to run the app initializers.
    assert.equal(
      typeof (ApplicationInitStatus.prototype as { runInitializers?: unknown }).runInitializers,
      'function',
      'ApplicationInitStatus no longer has runInitializers',
    );
  });
});
