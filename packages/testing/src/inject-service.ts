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
 * The instance of `token` from a fresh app's root injector, built with `providers`. The app is
 * destroyed by `cleanup()`, which ends the service's `DestroyRef`.
 */
export function injectService<T>(token: ProviderToken<T>, options: InjectServiceOptions = {}): T {
  const { applicationRef } = mount(1, ServiceHost, createFakeFabric(), {
    providers: options.providers,
  });
  apps.push(applicationRef);
  return applicationRef.injector.get(token);
}

/**
 * Destroy every app `injectService` created. Called by `cleanup()`. A teardown that throws does
 * not stop the rest: each app is destroyed, then the first error is thrown.
 */
export function destroyServiceApps(): void {
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
