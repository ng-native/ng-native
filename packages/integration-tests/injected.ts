/**
 * Building a service outside an app.
 *
 * Every service in `@ng-native/device` and `@ng-native/expo` reaches its platform
 * through an injected source token, so a fake stands in for the platform by being provided rather
 * than passed. That is also the only way to construct one: `inject()` needs an injection context,
 * and `new Keyboard()` on its own throws.
 *
 * This is the two lines that gives you one, so a test reads as `serviceWith(SOURCE, fake, () =>
 * new Thing())` rather than restating the injector each time.
 */
import { Injector, runInInjectionContext, type InjectionToken } from '@angular/core';

/**
 * A service, built with its platform source replaced.
 *
 * The token is typed, so an inline fake is checked against what the service expects rather than
 * being an `any` that agrees with everything - which is the whole reason these seams are worth
 * having.
 */
export function serviceWith<S, T>(token: InjectionToken<S>, source: NoInfer<S>, make: () => T): T {
  return servicesWith([[token, source]], make);
}

/** The same, for the few services that reach the platform through more than one token. */
export function servicesWith<T>(
  sources: readonly (readonly [unknown, unknown])[],
  make: () => T,
): T {
  const providers = sources.map(([provide, useValue]) => ({ provide, useValue }));
  return runInInjectionContext(Injector.create({ providers: providers as never }), make);
}

/**
 * A service in an app of its own, and the function that destroys the app: for a service that
 * outlives one app, or is shared by several on one platform source.
 */
export function inAppWith<S, T>(
  token: InjectionToken<S>,
  source: NoInfer<S>,
  make: () => T,
): { service: T; destroy: () => void } {
  const injector = Injector.create({ providers: [{ provide: token, useValue: source }] });
  return { service: runInInjectionContext(injector, make), destroy: () => injector.destroy() };
}
