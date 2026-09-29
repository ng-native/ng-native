/**
 * Links that arrive from outside the app: a `canary://` url, a universal link, a notification.
 */
import { ErrorHandler, InjectionToken, Injector, Service, inject } from '@angular/core';
import { reactNative } from './react-native.ts';

export interface DeepLinkSource {
  /** The url the app was launched with. A promise, and nothing says it settles before mount. */
  launchUrl(): Promise<string | null>;
  subscribe(listener: (url: string) => void): () => void;
  open(url: string): void;
}

export function deepLinkSource(): DeepLinkSource {
  const native = reactNative();
  if (!native) {
    return { launchUrl: () => Promise.resolve(null), subscribe: () => () => {}, open: () => {} };
  }

  return {
    launchUrl: () => native.Linking.getInitialURL(),
    subscribe: (listener) => {
      const subscription = native.Linking.addEventListener('url', ({ url }) => listener(url));
      return () => subscription.remove();
    },
    open: (url) => void native.Linking.openURL(url).catch(() => {}),
  };
}

/**
 * The path a url means to this app: everything after the scheme and host.
 *
 * Prefixes are app configuration and every app's are different, but stripping one is not: what a
 * router can navigate to is a path. `canary://primitives` and `https://example.com/primitives`
 * both mean `/primitives` - which takes noticing that only the second one has a host.
 *
 * Expo Go is the exception worth handling here rather than in every app: it serves every project
 * from one development url, puts the app's own path after `/--`, and has a host like a web url
 * rather than a path like an app's own scheme.
 *
 * The development client is the other. `expo run:ios` launches the app through
 * `<scheme>://expo-development-client/?url=...`, which is Expo telling its own launcher which
 * bundle to load and means nothing to the app. Left alone it reaches the router as a path, matches
 * no route, and the app shows a blank screen on every launch during development - which looks
 * exactly like a bug in the app.
 */

/** Expo's own launch hosts. Not paths: instructions to the launcher, which the app never routes. */
const EXPO_INTERNAL = new Set(['expo-development-client']);

/** Whether the first segment names one of Expo's launchers rather than something in the app. */
function isLauncher(rest: string): boolean {
  return EXPO_INTERNAL.has(rest.split(/[/?#]/, 1)[0] ?? '');
}

/** Schemes that carry a host to skip before the path starts. */
const HAS_HOST = new Set(['http', 'https', 'exp', 'exps']);

export function pathOf(url: string | null): string | null {
  if (!url) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url);
  const rest = scheme ? url.slice(scheme[0].length) : url;

  const expoGo = rest.indexOf('/--/');
  if (expoGo !== -1) return rest.slice(expoGo + 3);
  if (isLauncher(rest)) return null;

  // A url with a host has one to skip. A custom scheme does not: `canary://settings` names a
  // path, not a machine, and treating the two alike is how it quietly becomes `/`.
  if (HAS_HOST.has(scheme?.[1]?.toLowerCase() ?? '')) {
    // The host ends at the path, or at a query or fragment when there is no path.
    const end = rest.search(/[/?#]/);
    if (end === -1) return '/';
    return rest[end] === '/' ? rest.slice(end) : `/${rest.slice(end)}`;
  }
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/**
 * The launch url is delivered whichever way is true at the time: as the initial url if it is
 * known before anything asks, and as an ordinary link if the app is already up. Both happen -
 * the promise races the first navigation and neither order is guaranteed - and a link that
 * arrives late is still a link, so nothing is dropped either way.
 */
@Service()
export class DeepLinks {
  /** Overridden in a test to deliver a link with no platform under it. */
  static readonly SOURCE = new InjectionToken<DeepLinkSource>('angular-native.deepLinkSource', {
    factory: deepLinkSource,
  });

  private readonly source = inject(DeepLinks.SOURCE);
  private readonly injector = inject(Injector);
  private launch: string | null = null;
  private readonly listeners = new Set<(path: string) => void>();

  constructor() {
    void this.source.launchUrl().then((url) => {
      const path = pathOf(url);
      if (!path || path === '/') return;
      if (this.listeners.size) this.listeners.forEach((listener) => this.deliver(listener, path));
      else this.launch = path;
    });
  }

  /** The path the app was launched with, if it is known yet. */
  initialUrl(): string | null {
    return this.launch;
  }

  /** Links that arrive while the app is running, as paths. Returns an unsubscribe. */
  subscribe(listener: (path: string) => void): () => void {
    // Each subscription is its own entry, so the same function subscribed twice stops once.
    const subscription = (path: string) => listener(path);
    this.listeners.add(subscription);
    const unsubscribe = this.source.subscribe((url) => {
      const path = pathOf(url);
      if (path) listener(path);
    });
    return () => {
      this.listeners.delete(subscription);
      unsubscribe();
    };
  }

  /**
   * One listener throwing is reported, and does not keep the launch url from the rest. The
   * `ErrorHandler` is looked up when that happens rather than when this is made: an app's handler
   * that injects the router reaches `DeepLinks` through the location, and would be a cycle at boot.
   */
  private deliver(listener: (path: string) => void, path: string): void {
    try {
      listener(path);
    } catch (error) {
      const errors = this.injector.get(ErrorHandler, null);
      if (errors) errors.handleError(error);
      else console.error(error);
    }
  }

  /** Hand a url to whatever else on the device handles it: a browser, Maps, another app. */
  open(url: string): void {
    this.source.open(url);
  }
}
