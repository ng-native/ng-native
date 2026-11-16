/**
 * Route params, data and resources as component inputs, which is what `withComponentInputBinding()`
 * promises.
 *
 * Angular's binder is `RoutedComponentInputBinder`, a service behind `INPUT_BINDER`, a token the
 * router does not export, and `RouterOutlet` is the only thing that calls it. Both native outlets
 * advertise `supportsBindingToComponentInputs`, so they call it too: the feature's own provider
 * still names that token, so the binder can be injected through it, and each page is handed to it
 * as an object shaped like the `RouterOutlet` it expects. That way a native page gets exactly what
 * a page under `RouterOutlet` gets - query params, path params, resolved data and route resources,
 * by the options given to `withComponentInputBinding()`, with a blocking resource bound to its
 * value as it loads and later changes landing a microtask after the navigation.
 *
 * Like Angular's, it only runs in an app that asked for it: both outlets check
 * `Router.componentInputBindingEnabled` first, which is true exactly when `RouterOutlet` would
 * find a binder behind that token. Without the feature a routed page's inputs are its own.
 *
 * The binder's methods are not public API. When they are missing, the outlets fall back to binding
 * query params, path params and data themselves, by the binder's `options`, merged as
 * `RoutedComponentInputBinder` merges them; route resources then do not bind.
 */
import {
  InjectionToken,
  reflectComponentType,
  type Injector,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import type { ActivatedRoute, RouterFeatures } from '@angular/router';

type Values = Record<string, unknown>;

/** What `withComponentInputBinding()` was given, with Angular's defaults filled in. */
interface RouteInputOptions {
  readonly queryParams: boolean;
  readonly unmatchedInputBehavior: 'alwaysUndefined' | 'undefinedIfStale';
}

/** The part of `RouterOutlet` that `RoutedComponentInputBinder` reads, one per page. */
interface PageOutlet {
  readonly activatedRoute: ActivatedRoute;
  readonly activatedComponentRef: ComponentRef<unknown>;
  readonly isActivated: true;
}

interface AngularBinder {
  bindActivatedRouteToOutletComponent(outlet: PageOutlet, injector?: Injector): void;
  unsubscribeFromRouteData(outlet: PageOutlet): void;
}

/** The binder `withComponentInputBinding()` provides, or null without that feature. */
export const ROUTE_INPUT_BINDER = new InjectionToken<unknown>('RouteInputBinder', {
  factory: () => null,
});

/** `RouterFeatureKind.ComponentInputBindingFeature`, an enum `@angular/router` does not export. */
const COMPONENT_INPUT_BINDING = 8;

/**
 * Provide `ROUTE_INPUT_BINDER` from the `withComponentInputBinding()` among `features`, if any:
 * the binder behind `INPUT_BINDER`, through the token that feature's own provider names.
 */
export function provideRouteInputBinder(
  features: readonly RouterFeatures[],
): (Provider | EnvironmentProviders)[] {
  const feature = features.find((each) => each.ɵkind === COMPONENT_INPUT_BINDING);
  const provider = feature?.ɵproviders.find(
    (each) => typeof each === 'object' && each !== null && 'provide' in each,
  ) as { provide: InjectionToken<unknown> } | undefined;
  const binder = provider?.provide;
  return binder ? [{ provide: ROUTE_INPUT_BINDER, useExisting: binder }] : [];
}

function isAngularBinder(binder: unknown): binder is AngularBinder {
  const candidate = binder as Partial<AngularBinder> | null;
  return (
    typeof candidate?.bindActivatedRouteToOutletComponent === 'function' &&
    typeof candidate.unsubscribeFromRouteData === 'function'
  );
}

/**
 * Bind `route` onto the page `ref`'s inputs through `binder`, until the returned function runs.
 *
 * The binder checks on every emission that its outlet is still activated with this route and
 * component, and stops binding for good when it is not. A page here is its own outlet: it stays
 * activated with the same route while it is bound, kept behind another screen or in a tab out of
 * view included, and an outlet that hands it a new route unbinds it and binds a new one.
 */
export function bindRouteInputs(
  ref: ComponentRef<unknown>,
  route: ActivatedRoute,
  binder: unknown,
): () => void {
  if (!isAngularBinder(binder)) return bindOwn(ref, route, optionsOf(binder));
  const page: PageOutlet = { activatedRoute: route, activatedComponentRef: ref, isActivated: true };
  binder.bindActivatedRouteToOutletComponent(page, ref.injector);
  // Releasing the page is what drops it from the binder's maps; nothing reads it after that.
  return () => binder.unsubscribeFromRouteData(page);
}

function optionsOf(binder: unknown): RouteInputOptions {
  const options = (binder as { options?: Partial<RouteInputOptions> } | null)?.options;
  return {
    queryParams: options?.queryParams ?? true,
    unmatchedInputBehavior: options?.unmatchedInputBehavior ?? 'alwaysUndefined',
  };
}

/**
 * The fallback: query params first, then path params, then resolved data, every declared input
 * written on every change - including to `undefined` when the key is gone, which is what stops a
 * stale param from surviving a navigation. `queryParams: false` leaves query params out, and
 * `unmatchedInputBehavior: 'undefinedIfStale'` writes `undefined` only to an input whose key the
 * route has had since the page opened, so an input no key ever named keeps its default.
 */
function bindOwn(
  ref: ComponentRef<unknown>,
  route: ActivatedRoute,
  options: RouteInputOptions,
): () => void {
  const mirror = reflectComponentType(ref.componentType);
  if (!mirror || mirror.inputs.length === 0) return () => {};

  let queryParams: Values = {};
  let params: Values = {};
  let data: Values = {};
  // Every key the route has had since the page opened, as Angular's binder keeps per activation.
  const seen = new Set<string>();
  const always = options.unmatchedInputBehavior === 'alwaysUndefined';

  const apply = () => {
    if (ref.hostView.destroyed) return;
    const merged: Values = { ...queryParams, ...params, ...data };
    for (const key of Object.keys(merged)) seen.add(key);
    for (const { templateName } of mirror.inputs) {
      const value = merged[templateName];
      if (value !== undefined || always || seen.has(templateName)) {
        ref.setInput(templateName, value);
      }
    }
  };

  // Three subscriptions rather than a `combineLatest`, so this file needs no rxjs operators. Each
  // emits synchronously on subscribe, so the inputs are set before the first change detection.
  const subscriptions = [
    ...(options.queryParams
      ? [
          route.queryParams.subscribe((value) => {
            queryParams = value;
            apply();
          }),
        ]
      : []),
    route.params.subscribe((value) => {
      params = value;
      apply();
    }),
    route.data.subscribe((value) => {
      data = value;
      apply();
    }),
  ];

  return () => subscriptions.forEach((subscription) => subscription.unsubscribe());
}
