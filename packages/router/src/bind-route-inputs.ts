/**
 * Route params as component inputs, which is what `withComponentInputBinding()` promises.
 *
 * Angular's own binder is a service behind `INPUT_BINDER`, a token the router does not export, and
 * `RouterOutlet` is the only thing that calls it. An outlet that is not `RouterOutlet` therefore
 * has to do this itself - and both of ours advertise `supportsBindingToComponentInputs`, so until
 * now they were promising something nobody delivered: a `:album` param reached the component as
 * an empty input, with no error anywhere.
 *
 * Like Angular's, it only runs in an app that asked for it: both outlets check
 * `Router.componentInputBindingEnabled` first, which is true exactly when `RouterOutlet` would
 * find a binder behind that token. Without the feature a routed page's inputs are its own.
 *
 * The behaviour matches `RoutedComponentInputBinder`: query params first, then path params, then
 * resolved data, and every declared input is written on every change - including to `undefined`
 * when the key is gone, which is what stops a stale param from surviving a navigation. The options
 * given to `withComponentInputBinding()` hold here too: `queryParams: false` leaves query params
 * out, and `unmatchedInputBehavior: 'undefinedIfStale'` writes `undefined` only to an input whose
 * key the route has had since the page opened, so an input no key ever named keeps its default.
 */
import {
  InjectionToken,
  inject,
  reflectComponentType,
  type ComponentRef,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import type { ActivatedRoute, RouterFeatures } from '@angular/router';

type Values = Record<string, unknown>;

/** What `withComponentInputBinding()` was given, with Angular's defaults filled in. */
export interface RouteInputOptions {
  readonly queryParams: boolean;
  readonly unmatchedInputBehavior: 'alwaysUndefined' | 'undefinedIfStale';
}

const DEFAULT_OPTIONS: RouteInputOptions = {
  queryParams: true,
  unmatchedInputBehavior: 'alwaysUndefined',
};

/** The binding options the outlets read; Angular's defaults when nothing provides it. */
export const ROUTE_INPUT_OPTIONS = new InjectionToken<RouteInputOptions>('RouteInputOptions', {
  factory: () => DEFAULT_OPTIONS,
});

/** `RouterFeatureKind.ComponentInputBindingFeature`, an enum `@angular/router` does not export. */
const COMPONENT_INPUT_BINDING = 8;

/**
 * Provide `ROUTE_INPUT_OPTIONS` from the `withComponentInputBinding()` among `features`, if any.
 *
 * The options live only on the binder that feature provides, behind `INPUT_BINDER`, which the
 * router keeps private. The feature's own provider still names that token, so the binder can be
 * injected through it and its `options` read: they are what `RouterOutlet` binds by, defaults
 * already filled in by the binder's constructor.
 */
export function provideRouteInputOptions(
  features: readonly RouterFeatures[],
): (Provider | EnvironmentProviders)[] {
  const feature = features.find((each) => each.ɵkind === COMPONENT_INPUT_BINDING);
  const provider = feature?.ɵproviders.find(
    (each) => typeof each === 'object' && each !== null && 'provide' in each,
  ) as { provide: InjectionToken<unknown> } | undefined;
  const binder = provider?.provide;
  if (!binder) return [];
  return [
    {
      provide: ROUTE_INPUT_OPTIONS,
      useFactory: (): RouteInputOptions => {
        const options = (inject(binder) as { options?: Partial<RouteInputOptions> }).options;
        return {
          queryParams: options?.queryParams ?? DEFAULT_OPTIONS.queryParams,
          unmatchedInputBehavior:
            options?.unmatchedInputBehavior ?? DEFAULT_OPTIONS.unmatchedInputBehavior,
        };
      },
    },
  ];
}

export function bindRouteInputs(
  ref: ComponentRef<unknown>,
  route: ActivatedRoute,
  options: RouteInputOptions = DEFAULT_OPTIONS,
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
