/**
 * `PlatformLocation` over an in-memory history.
 *
 * Angular's `Location` reads and writes the URL through this. On the web the browser owns the
 * history stack; here nothing does, so we keep it ourselves and the URL tree stays the source of
 * truth in both directions: `router.navigate()` pushes an entry, and a swipe-back reaches the
 * outlet as the screen's `dismissed` event, which usually calls `historyGo(-1)` here and emits
 * `popstate` so the router follows. Not always: see the stack outlet's `popBy` for when the entry
 * behind is another tab.
 *
 * No decorators, so tests can import it at runtime and so it can be provided with `useClass`.
 */
import type { LocationChangeListener, PlatformLocation } from '@angular/common';
/**
 * What the history needs of a deep-link source, which `DeepLinks` from
 * `@ng-native/device` satisfies. Structural rather than the class itself: the router has no
 * use for the rest of it, and a test has no use for a real one.
 */
export interface LinkSource {
  /** The path the app was launched with, or null for a normal launch. */
  initialUrl(): string | null;
  /** Links that arrive while the app is running. Returns an unsubscribe. */
  subscribe(listener: (url: string) => void): () => void;
}

interface HistoryEntry {
  url: string;
  state: unknown;
}

/** Split a url into its path, `?search` and `#hash` parts. */
function parse(url: string): { pathname: string; search: string; hash: string } {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);

  const searchAt = withoutHash.indexOf('?');
  const search = searchAt === -1 ? '' : withoutHash.slice(searchAt);
  const pathname = searchAt === -1 ? withoutHash : withoutHash.slice(0, searchAt);

  return { pathname: pathname || '/', search, hash };
}

export class NativePlatformLocation implements PlatformLocation {
  private readonly entries: HistoryEntry[] = [{ url: '/', state: null }];
  private cursor = 0;

  private readonly popStateListeners = new Set<LocationChangeListener>();
  private readonly hashChangeListeners = new Set<LocationChangeListener>();

  /**
   * A deep link is history, not a navigation of its own: the launch url *is* the first entry,
   * and one that arrives later is pushed and announced as a popstate, which is the only thing
   * the router listens to. `links` is null in a test that has no interest in either.
   */
  constructor(links: LinkSource | null = null) {
    const initial = links?.initialUrl();
    if (initial) this.entries[0] = { url: initial, state: null };
    links?.subscribe((url) => this.open(url));
  }

  /** Follow a link that arrived while the app was running. */
  open(url: string): void {
    if (url === this.current.url) return;
    this.pushState(null, '', url);
    this.emitPopState();
  }

  /**
   * The url of the entry `offset` away from the current one, or null past either end. For the
   * stack outlet, which has to know whether going back reaches the screen a native pop revealed.
   */
  ɵurlAt(offset: number): string | null {
    return this.entries[this.cursor + offset]?.url ?? null;
  }

  /** The history up to the page showing, oldest first. For parking it across a reload. */
  ɵpages(): readonly { readonly url: string; readonly state: unknown }[] {
    return this.entries.slice(0, this.cursor + 1);
  }

  private get current(): HistoryEntry {
    return this.entries[this.cursor]!;
  }

  // --- PlatformLocation ---------------------------------------------------

  getBaseHrefFromDOM(): string {
    return '/';
  }

  getState(): unknown {
    return this.current.state;
  }

  onPopState(fn: LocationChangeListener): VoidFunction {
    this.popStateListeners.add(fn);
    return () => this.popStateListeners.delete(fn);
  }

  onHashChange(fn: LocationChangeListener): VoidFunction {
    this.hashChangeListeners.add(fn);
    return () => this.hashChangeListeners.delete(fn);
  }

  get href(): string {
    return this.current.url;
  }

  /** There is no origin on a device. Angular only ever compares these, never resolves them. */
  get protocol(): string {
    return 'app:';
  }

  get hostname(): string {
    return '';
  }

  get port(): string {
    return '';
  }

  get pathname(): string {
    return parse(this.current.url).pathname;
  }

  get search(): string {
    return parse(this.current.url).search;
  }

  get hash(): string {
    return parse(this.current.url).hash;
  }

  pushState(state: unknown, _title: string, url: string): void {
    // A push after going back discards the forward entries, as a browser does.
    this.entries.length = this.cursor + 1;
    this.entries.push({ url, state });
    this.cursor++;
  }

  replaceState(state: unknown, _title: string, url: string): void {
    this.entries[this.cursor] = { url, state };
  }

  forward(): void {
    this.historyGo(1);
  }

  back(): void {
    this.historyGo(-1);
  }

  historyGo(relativePosition = 0): void {
    const target = this.cursor + relativePosition;
    // Out of range is a no-op, matching the browser rather than throwing.
    if (target < 0 || target >= this.entries.length) return;
    this.cursor = target;
    this.emitPopState();
  }

  private emitPopState(): void {
    const event = { type: 'popstate', state: this.current.state };
    for (const listener of [...this.popStateListeners]) listener(event);
  }
}
