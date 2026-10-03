/**
 * A service on its own, with no component to render.
 *
 * There is no TestBed, and `Injector.create()` is no stand-in for it: an injector made that way
 * has no root scope, so a `@Service()` or `providedIn: 'root'` class is not found in it, nor is
 * anything such a class injects. The app injector `mount()` creates is the root an app has, so
 * the service gets the same providers, `DestroyRef` and platform it gets on a device.
 */
import {
  Component,
  type ApplicationRef,
  type EnvironmentProviders,
  type Provider,
  type ProviderToken,
} from '@angular/core';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from './test-utils.ts';

export interface InjectServiceOptions {
  /** Providers for the app the service is created in: a stand-in for what it injects. */
  providers?: (Provider | EnvironmentProviders)[];
}

@Component({ selector: 'ng-native-service-host', template: '' })
class ServiceHost {}

const apps: ApplicationRef[] = [];

/**
 * What the runner's setup says about the tests: how many have finished, which tells one test from
 * the next, and how many are running now. `runner/setup.mjs` keeps it under Vitest and
 * `runner/register.mjs` under `node:test`. Undefined where neither ran.
 */
interface Tests {
  finished: number;
  running: number;
}
const TESTS = Symbol.for('ng-native.testing.tests');
const tests = (): Tests | undefined => (globalThis as Record<symbol, Tests | undefined>)[TESTS];

/** The app the calls in the running test share, and which test that is. */
let shared: { readonly app: ApplicationRef; readonly test: number } | null = null;

/**
 * The instance of `token` from an app's root injector.
 *
 * The calls in one test share an app, so a service and the services it injects are the ones a
 * later call returns, as they share a root in the app. A call with `providers` starts a new app,
 * which the calls after it use. The app ends with its test: the next test starts another, whether
 * or not `cleanup()` was called, so one test never sees another's services. `cleanup()` destroys
 * every app, which ends each service's `DestroyRef`.
 *
 * An app is shared only while exactly one test is running, since that is the only time the test
 * a call belongs to is known. Every call makes an app of its own outside a test (a `beforeAll`),
 * while tests run at once (`it.concurrent`), and where the runner's setup did not run.
 */
export function injectService<T>(token: ProviderToken<T>, options: InjectServiceOptions = {}): T {
  const state = tests();
  const test = state?.running === 1 ? state.finished : undefined;
  const reusable = options.providers === undefined && test !== undefined && shared?.test === test;
  const app = reusable ? shared!.app : appWith(options.providers);
  shared = test === undefined ? null : { app, test };
  return app.injector.get(token);
}

function appWith(providers: InjectServiceOptions['providers']): ApplicationRef {
  const { applicationRef } = mount(1, ServiceHost, createFakeFabric(), { providers });
  apps.push(applicationRef);
  return applicationRef;
}

/**
 * Destroy every app `injectService` created. Called by `cleanup()`. A teardown that throws does
 * not stop the rest: each app is destroyed, then the first error is thrown.
 */
export function destroyServiceApps(): void {
  shared = null;
  const errors: unknown[] = [];
  for (const app of apps.splice(0)) {
    try {
      app.destroy();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
}
