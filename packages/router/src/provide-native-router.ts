/**
 * Angular's Router, on native navigation: `provideRouter` and the native pieces under it, in one
 * call.
 *
 * `provideNativeRouter(routes, withComponentInputBinding())` takes the same routes and the same
 * router features as `provideRouter` - it calls it - and adds what native needs on top: a
 * `PlatformLocation` over an in-memory history, a `RouteReuseStrategy` that detaches a pushed-away
 * screen instead of destroying it, and `NativeNavigation`. Those come after `provideRouter`'s own
 * providers, so they win over the web defaults without the app having to order anything.
 *
 * Deep links and Android's back button come from `@ng-native/device` and need no wiring: off a
 * device both report nothing, and navigation works either way. The native options - `withLinkParent`,
 * `withHeaderDefaults` and `withTabDefaults` - are passed like any other feature.
 */
import { PlatformLocation } from '@angular/common';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  RouteReuseStrategy,
  Router,
  provideRouter,
  type RouterFeatures,
  type Routes,
} from '@angular/router';
import {
  DestroyRef,
  ErrorHandler,
  computed,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
  type InjectionToken,
  type Provider,
  type Signal,
} from '@angular/core';
import { ColorScheme, DeepLinks, type Scheme } from '@ng-native/device';
import {
  NATIVE_HEADER_DEFAULTS,
  NATIVE_TAB_DEFAULTS,
  type HeaderDefaults,
  type SchemeDefaults,
  type TabDefaults,
} from './native-bar-defaults.ts';
import { followLink, linkAncestry, type LinkParent } from './native-links.ts';
import { NATIVE_INTENT, NativeNavigation, intentOf } from './native-navigation.ts';
import { NativePlatformLocation } from './native-platform-location.ts';
import { NativeStackReuseStrategy } from './native-stack-reuse-strategy.ts';
import { ROUTE_PARKING, type ParkedPage } from './route-parking.ts';
import { registerScreenComponents } from './screens.ts';

/** A native-only router option, passed to `provideNativeRouter` beside Angular's own features. */
export interface NativeRouterFeature {
  readonly ɵnativeRouter: { readonly linkParent?: LinkParent; readonly providers?: Provider[] };
}

/**
 * The page a deep link opens on top of, or null to open it alone. Without it a link to
 * `/settings/notifications` opens that page with no Back. See native-links.ts.
 */
export function withLinkParent(parentOf: LinkParent): NativeRouterFeature {
  return { ɵnativeRouter: { linkParent: parentOf } };
}

/**
 * How every `<native-header>` looks when it does not say: its colours, blur, shadow, fonts and
 * light or dark style. A header's own binding always wins.
 *
 * ```ts
 * provideNativeRouter(
 *   routes,
 *   withHeaderDefaults((scheme) => ({
 *     backgroundColor: scheme === 'dark' ? '#101014' : '#f4f4f7',
 *     titleColor: scheme === 'dark' ? '#ffffff' : '#101014',
 *     color: '#3b6ef5',
 *   })),
 * );
 * ```
 *
 * Colours it leaves out still come from `NATIVE_HEADER_PALETTE`.
 */
export function withHeaderDefaults(defaults: SchemeDefaults<HeaderDefaults>): NativeRouterFeature {
  return { ɵnativeRouter: { providers: [bySchemeProvider(NATIVE_HEADER_DEFAULTS, defaults)] } };
}

/**
 * How every `<native-tabs-outlet>` and `<native-tab>` looks when it does not say: the tint, the
 * background behind the tabs, the light or dark style, and each tab's bar appearance. An outlet's
 * or a tab's own binding always wins.
 */
export function withTabDefaults(defaults: SchemeDefaults<TabDefaults>): NativeRouterFeature {
  return { ɵnativeRouter: { providers: [bySchemeProvider(NATIVE_TAB_DEFAULTS, defaults)] } };
}

/** One signal for the whole app, rather than every bar calling the function again. */
function bySchemeProvider<T>(
  token: InjectionToken<Signal<T>>,
  defaults: SchemeDefaults<T>,
): Provider {
  return {
    provide: token,
    useFactory: () => {
      if (typeof defaults !== 'function') return computed(() => defaults);
      const scheme = inject(ColorScheme);
      return computed(() => (defaults as (scheme: Scheme) => T)(scheme.current()));
    },
  };
}

function isNative(feature: RouterFeatures | NativeRouterFeature): feature is NativeRouterFeature {
  return 'ɵnativeRouter' in feature;
}

export function provideNativeRouter(
  routes: Routes,
  ...features: (RouterFeatures | NativeRouterFeature)[]
): EnvironmentProviders {
  const angular = features.filter((feature): feature is RouterFeatures => !isNative(feature));
  const native = features.filter(isNative).map((feature) => feature.ɵnativeRouter);
  const parentOf = native.find((feature) => feature.linkParent)?.linkParent;
  return makeEnvironmentProviders([
    provideRouter(routes, ...angular),
    ...nativeProviders(parentOf),
    ...native.flatMap((feature) => feature.providers ?? []),
  ]);
}

function nativeProviders(parentOf: LinkParent | undefined): (Provider | EnvironmentProviders)[] {
  // The engine needs the element-to-view-name mapping before the first navigation renders.
  registerScreenComponents();

  const shared = [
    // Without this the router never detaches, so a pushed-away screen is destroyed and rebuilt.
    { provide: RouteReuseStrategy, useClass: NativeStackReuseStrategy },
    NativeNavigation,
    provideEnvironmentInitializer(keepHistoryAcrossReloads),
  ];
  if (!parentOf) {
    return [
      {
        provide: PlatformLocation,
        useFactory: () => new NativePlatformLocation(inject(DeepLinks)),
      },
      ...shared,
    ];
  }

  return [
    {
      provide: PlatformLocation,
      // The app launches on the page the link belongs under; the link follows once it is shown.
      // Links while running go through the router below rather than straight into history.
      useFactory: () => {
        const initial = inject(DeepLinks).initialUrl();
        return new NativePlatformLocation({
          initialUrl: () => (initial && linkAncestry(initial, parentOf)[0]) || initial,
          subscribe: () => () => {},
        });
      },
    },
    provideEnvironmentInitializer(() => {
      const router = inject(Router);
      const links = inject(DeepLinks);
      const errors = inject(ErrorHandler);
      // A link nobody awaits: a page that fails to load is reported, as a tab tap's is, rather
      // than left as an unhandled rejection. The app's navigation error handler hears it too.
      const follow = (url: string) =>
        followLink(router, url, parentOf).catch((error: unknown) => errors.handleError(error));
      const initial = links.initialUrl();
      if (initial && parentOf(initial)) {
        const first = router.events.subscribe((event) => {
          if (!(event instanceof NavigationEnd)) return;
          first.unsubscribe();
          void follow(initial);
        });
      }
      // A launch link arrives the way any other does, once `getInitialURL()` settles, which is
      // usually while the router's first navigation is still going: following it then cancels that
      // navigation, and the app opens with no root screen under the link. So links wait for it.
      const settled = new Promise<void>((resolve) => {
        if (router.navigated) return resolve();
        const first = router.events.subscribe((event) => {
          if (!isEnd(event)) return;
          first.unsubscribe();
          resolve();
        });
      });
      links.subscribe((url) => void settled.then(() => follow(url)));
    }),
    ...shared,
  ];
}

/**
 * A history without its round trips: each page once, reached the way it last was. An app that went
 * from one tab to another and back has a history three entries long and is one page deep, and the
 * app that comes back has no use for the detour: gone through at the speed of a reload, the tab
 * bar is still on its way to the second tab when the third navigation asks for the first.
 */
function direct(pages: ParkedPage[]): ParkedPage[] {
  const route: ParkedPage[] = [];
  for (const page of pages) {
    const before = route.findIndex((one) => one.url === page.url);
    if (before !== -1) route.length = before;
    route.push(page);
  }
  return route;
}

declare const __DEV__: boolean | undefined;

/** A push's animation, with room to spare: 350ms on iOS, about the same on Android. */
const PUSH_SETTLES = 450;

/**
 * In development, come back from a reload on the page it left: see `route-parking.ts`.
 *
 * The history a reload left is gone through again once the first navigation has ended, as a
 * launch link is and for the same reason. The hook is what `mount`'s reload waits on.
 */
function keepHistoryAcrossReloads(): void {
  // The bare identifier, so a release build folds the rest away.
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const parking = inject(ROUTE_PARKING);
  if (!parking) return;
  const router = inject(Router);
  const history = inject(PlatformLocation);
  const errors = inject(ErrorHandler);
  const scope = globalThis as {
    __angularNativePark?: () => Promise<void>;
    __angularNativeRestoring?: Promise<void>;
  };
  // A page keeps how it was presented, a sheet or a modal, and nothing else of its navigation:
  // a replace has already happened to the history, and an app's own state may not survive JSON.
  const pages = (): ParkedPage[] =>
    history instanceof NativePlatformLocation
      ? history.ɵpages().map(({ url, state }) => {
          const presentation = intentOf(state)?.presentation;
          return presentation ? { url, presentation } : { url };
        })
      : [{ url: router.url }];
  const park = () => parking.park(direct(pages()));
  scope.__angularNativePark = park;

  // `mount` keeps the app out of sight until this settles, so the pages arrive unseen.
  const restoring = parking
    .collect()
    .then(async (parked) => {
      if (!parked) return;
      await new Promise<void>((resolve) => {
        if (router.navigated) return resolve();
        const first = router.events.subscribe((event) => {
          if (!isEnd(event)) return;
          first.unsubscribe();
          resolve();
        });
      });
      let moved = false;
      for (const { url, presentation } of parked) {
        if (url === router.url) continue;
        const state = presentation && { [NATIVE_INTENT]: { stack: 'push', presentation } };
        moved = (await router.navigateByUrl(url, { state })) || moved;
      }
      // The last page is still sliding in when its navigation ends.
      if (moved) await new Promise((resolve) => setTimeout(resolve, PUSH_SETTLES));
    })
    .catch((error: unknown) => errors.handleError(error));
  scope.__angularNativeRestoring = restoring;
  inject(DestroyRef).onDestroy(() => {
    if (scope.__angularNativePark === park) delete scope.__angularNativePark;
    if (scope.__angularNativeRestoring === restoring) delete scope.__angularNativeRestoring;
  });
}

/** A navigation's last event, whichever way it went. */
function isEnd(event: unknown): boolean {
  return (
    event instanceof NavigationEnd ||
    event instanceof NavigationCancel ||
    event instanceof NavigationError
  );
}
