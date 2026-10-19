import type { Engine, EngineNode } from '@ng-native/fabric';
import { domError } from './dom-error.ts';
import { parseUrl, type UrlRecord } from './parse-url.ts';

/**
 * The page's address, which is the app's own URL: the address the app opens itself at, and the
 * route it is on. `document.URL`, `baseURI` and `window.location` say it, and a relative link
 * resolves against it, as one does against the address of the page a browser shows.
 *
 * The app's address is the one `provideWebCompat({ url })` is given, or Expo's: the deep link
 * Expo Go opens the app with (`exp://127.0.0.1:8081/--/`), or the scheme of the app config in a
 * build (`canary://`). Asked of the native module itself, so an app without `expo-constants` is
 * not made to bundle it. With neither, it is `app://`, the protocol the router's history says.
 * The route is Angular's `PlatformLocation`'s, the router's history, read as it is asked for.
 */

/** What an app's page is made of. */
export interface PageOptions {
  /** The app's address, the route on it: `canary://`, `https://shop.example/`. */
  readonly root: string;
  /** The route the app is on, `/orders?tab=2#paid`. */
  route(): string;
  /** Show a route of the app, as a link to it that arrived from outside is shown. */
  follow(route: string): void;
  /** Hand a URL that is not the app's to whatever on the device opens it. */
  open(url: string): void;
}

interface Page extends PageOptions {
  readonly location: PageLocation;
}

const pages = new WeakMap<Engine, Page>();
/** The engines of the apps up, oldest first: the newest is the one `window.location` speaks for. */
const opened: Engine[] = [];

/** The app's address, with the route on it, as a URL says it. */
function addressOf(root: string): string {
  return root.endsWith('/') && !root.endsWith('//') ? root.slice(0, -1) : root;
}

/** An app that asked for the package has started. Answers what closes its page. */
export function openPage(engine: Engine, options: PageOptions): () => void {
  // The app's first page, as a URL says it, without the `/` the route starts with.
  const root = (parseUrl(`${addressOf(options.root)}/`)?.href ?? options.root).replace(/\/$/, '');
  pages.set(engine, { ...options, root, location: new PageLocation(engine) });
  opened.push(engine);
  return () => {
    pages.delete(engine);
    opened.splice(opened.indexOf(engine), 1);
  };
}

/** Whether the route is being read: a history that reads `window.location` itself asks again. */
let reading = false;

/** The page's URL: `document.URL`. `about:blank` for an engine whose app has no page. */
export function pageUrl(engine: Engine): string {
  const page = pages.get(engine);
  if (!page) return 'about:blank';
  if (reading) return `${page.root}/`;
  reading = true;
  let route: string;
  try {
    route = page.route();
  } finally {
    reading = false;
  }
  return page.root + (route.startsWith('/') ? route : `/${route}`);
}

/**
 * The page's base URL, `document.baseURI`: what the first `<base href>` in the head says, or the
 * page's URL.
 *
 * ponytail: the head's own children only, where a `<base>` goes, and not the rest of the page.
 */
export function baseUrl(engine: Engine, head: EngineNode | null): string {
  const url = pageUrl(engine);
  const base = head?.childList.find(
    (node) => node.tag === 'base' && (node as { getAttribute?: unknown }).getAttribute,
  ) as { getAttribute(name: string): string | null } | undefined;
  const href = base?.getAttribute('href');
  return (href != null && parseUrl(href, url)?.href) || url;
}

/** `document.location` and `window.location` of an app's page, or null for one with none. */
export const locationOf = (engine: Engine): PageLocation | null =>
  pages.get(engine)?.location ?? null;

/** The route of the app a URL is at, or null for one that is not the app's. */
function routeIn(page: Page, url: string): string | null {
  if (!url.startsWith(page.root)) return null;
  const rest = url.slice(page.root.length);
  if (rest && !'/?#'.includes(rest[0]!)) return null;
  return rest.startsWith('/') ? rest : `/${rest}`;
}

type Part = 'protocol' | 'host' | 'hostname' | 'port' | 'pathname' | 'search' | 'hash';

/**
 * `Location`: the page's URL by its parts, and what goes somewhere else. A URL of the app is
 * followed as a link to it is, by whatever follows those, which is the router's navigation; any
 * other is handed to the device, a browser or another app, with `Linking`.
 *
 * ponytail: `replace` follows a URL as `assign` does, since the router keeps the history, and
 * `reload` does nothing: an app is not reloaded under a library. A change of the fragment
 * alone is followed too, where a browser scrolls, and no `hashchange` or `popstate` is sent.
 */
export class PageLocation {
  readonly #engine: Engine;

  constructor(engine: Engine) {
    this.#engine = engine;
  }

  #url(): UrlRecord | null {
    return parseUrl(pageUrl(this.#engine));
  }

  #part(name: Part): string {
    return this.#url()?.[name] ?? '';
  }

  #set(name: Part, value: unknown): void {
    const url = this.#url();
    if (!url) return;
    url[name] = String(value);
    this.assign(url.href);
  }

  get href(): string {
    return pageUrl(this.#engine);
  }
  set href(value: string) {
    this.assign(value);
  }

  /**
   * The scheme and the host, as a browser gives a page at a scheme the app registers, as a web
   * view gives `capacitor://localhost`. The URL Standard gives any but `http` and the rest
   * `null`, which a library that builds a URL from `location.origin` would build on.
   */
  get origin(): string {
    const url = this.#url();
    if (!url) return 'null';
    if (url.origin !== 'null') return url.origin;
    return url.href.startsWith(`${url.protocol}//`) ? `${url.protocol}//${url.host}` : 'null';
  }

  get protocol(): string {
    return this.#part('protocol');
  }
  set protocol(value: string) {
    this.#set('protocol', value);
  }
  get host(): string {
    return this.#part('host');
  }
  set host(value: string) {
    this.#set('host', value);
  }
  get hostname(): string {
    return this.#part('hostname');
  }
  set hostname(value: string) {
    this.#set('hostname', value);
  }
  get port(): string {
    return this.#part('port');
  }
  set port(value: string) {
    this.#set('port', value);
  }
  get pathname(): string {
    return this.#part('pathname');
  }
  set pathname(value: string) {
    this.#set('pathname', value);
  }
  get search(): string {
    return this.#part('search');
  }
  set search(value: string) {
    this.#set('search', value);
  }
  get hash(): string {
    return this.#part('hash');
  }
  set hash(value: string) {
    this.#set('hash', value);
  }

  assign(url: unknown): void {
    const page = pages.get(this.#engine);
    if (!page) return;
    const target = parseUrl(String(url), pageUrl(this.#engine));
    if (!target) throw domError(`'${String(url)}' is not a valid URL.`, 'SyntaxError');
    const route = routeIn(page, target.href);
    if (route === null) page.open(target.href);
    else page.follow(route);
  }

  replace(url: unknown): void {
    this.assign(url);
  }

  reload(): void {}

  toString(): string {
    return this.href;
  }
}

/**
 * Put `location` on the global while an app is up, the newest app's, where the runtime has none.
 * A test's jsdom or a browser has its own. Answers what takes it away.
 */
export function installLocation(): () => void {
  const scope = globalThis as { location?: unknown };
  if (typeof scope.location !== 'undefined') return () => {};
  Object.defineProperty(scope, 'location', {
    configurable: true,
    get: () => {
      const newest = opened.at(-1);
      return newest && locationOf(newest);
    },
    set: (value: unknown) => {
      const newest = opened.at(-1);
      const location = newest && locationOf(newest);
      if (location) location.href = String(value);
    },
  });
  return () => {
    delete scope.location;
  };
}

/** What `expo-constants` reads, as its native module has it. */
interface ExpoConstants {
  /** Expo Go's: `exp://127.0.0.1:8081/--/`. */
  linkingUri?: unknown;
  /** The app config, as JSON on Android. */
  manifest?: unknown;
}

type Scheme = string | string[] | undefined;

interface Manifest {
  scheme?: Scheme;
  ios?: { scheme?: Scheme };
  android?: { scheme?: Scheme };
}

const schemeOf = (scheme: Scheme): string | undefined =>
  Array.isArray(scheme) ? scheme[0] : scheme;

/** The scheme the app config says, where it says one a URL can have. */
function schemeIn(manifest: Manifest | undefined): string | null {
  const scheme =
    schemeOf(manifest?.scheme) ??
    schemeOf(manifest?.ios?.scheme) ??
    schemeOf(manifest?.android?.scheme);
  return typeof scheme === 'string' && /^[a-z][a-z\d+.-]*$/i.test(scheme) ? scheme : null;
}

/** The app's address as Expo has it, or `app://` where there is no Expo to ask. */
export function detectedRoot(): string {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  const constants = modules?.['ExponentConstants'] as ExpoConstants | undefined;
  if (typeof constants?.linkingUri === 'string' && constants.linkingUri) {
    return constants.linkingUri;
  }
  let manifest = constants?.manifest;
  try {
    if (typeof manifest === 'string') manifest = JSON.parse(manifest);
  } catch {
    // A config that does not parse is no address.
    return 'app://';
  }
  const scheme = schemeIn(manifest as Manifest | undefined);
  return scheme ? `${scheme}://` : 'app://';
}
