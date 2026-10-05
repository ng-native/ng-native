/**
 * File-based routing: each page is a file in `src/app/pages`, and its path there is its URL.
 *
 * ```ts
 * const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');
 *
 * mount(rootTag, App, fabric, { providers: [provideNativeRouter(fileRoutes(pages))] });
 * ```
 *
 * The file names are Analog's (`index.page.ts`, `[id].page.ts`, `[...slug].page.ts`, `(group)`
 * folders, `products.page.ts` beside `products/` as a layout) and so is a page module's shape (a
 * default export and an optional `routeMeta`), so a page moves between an app routed by
 * `fileRoutes` and one routed by `@ng-native/analog` without being renamed. Nothing here imports
 * Analog: the routes are made here, as plain `@angular/router` routes.
 */
import { EnvironmentInjector, inject, runInInjectionContext, type Type } from '@angular/core';
import {
  UrlSegment,
  type CanMatchFn,
  type GuardResult,
  type Route,
  type Routes,
  type UrlMatcher,
} from '@angular/router';
import { MARKDOWN_PAGE, markdownPageFile } from './markdown-page.ts';

/**
 * What Metro's `require.context(directory, true, pattern, mode)` returns: the files it found, each
 * keyed by its path from that directory (`./users/[id].page.ts`), and a call that loads one, which
 * returns a promise in `'lazy'` mode and the module itself in `'sync'` mode.
 */
export interface PageContext {
  keys(): string[];
  (key: string): unknown;
}

/**
 * The files of an `import.meta.glob`, as Vite and Vitest make it: each file's path, with a call
 * that loads it (`import.meta.glob('./pages/**\/*.page.ts')`) or the module itself
 * (`{ eager: true }`).
 */
export type PageFiles = Readonly<Record<string, unknown>>;

export interface FileRoutesOptions {
  /**
   * The component a `.md` page is drawn with. It reads its file with `injectMarkdownPage()` and
   * draws `tokens` with `<markdown>` from `@ng-native/components/markdown`. Required when the
   * pages include a `.md` file.
   */
  markdownPage?: Type<unknown>;
}

/** What a page's file sets about its route by being where it is, so `routeMeta` does not. */
const SET_BY_THE_FILE = [
  'path',
  'matcher',
  'component',
  'loadComponent',
  'children',
  'loadChildren',
  'canLoad',
  'outlet',
] as const;

/**
 * A page's `export const routeMeta`, as Analog has it: the page's route config, less what the
 * file's place sets. `meta`, the page's HTML meta tags in Analog, is accepted and left out, since
 * there is no document head on a device. A page that only redirects has `redirectTo` and no
 * component; its `pathMatch` is `'full'` unless it says otherwise.
 */
export type RouteMeta =
  | (Omit<Route, (typeof SET_BY_THE_FILE)[number] | 'redirectTo' | 'pathMatch' | 'canMatch'> & {
      canMatch?: CanMatchFn[];
      meta?: unknown;
      redirectTo?: never;
    })
  | { redirectTo: NonNullable<Route['redirectTo']>; pathMatch?: Route['pathMatch'] };

/** A page module: its component as the default export, and its `routeMeta`. */
interface PageModule {
  default?: unknown;
  routeMeta?: RouteMeta;
}

/** One part of a URL a file or folder name makes. */
type Part =
  | { kind: 'static'; path: string }
  | { kind: 'group' }
  | { kind: 'param'; name: string }
  | { kind: 'rest'; name: string };

/** A file found, by the key it was listed under and its path from the pages folder. */
interface Page {
  readonly key: string;
  /** Its path from the pages folder: `users/[id].page.ts`. */
  readonly file: string;
  readonly markdown: boolean;
  /** The module, or a promise of it. Called on navigation for a lazy page, at once otherwise. */
  readonly load: () => unknown;
  readonly lazy: boolean;
}

/** A file or folder name in the pages folder, with the file it names and what is under it. */
interface Entry {
  readonly parts: Part[];
  readonly pages: Page[];
  readonly children: Map<string, Entry>;
}

/** A route at one level, with what it sorts by. */
interface Ranked {
  readonly rank: number;
  readonly path: string;
  readonly key: string;
  readonly route: Route;
}

/**
 * The routes for an app's pages, for `provideNativeRouter`.
 *
 * `pages` is the `require.context` of the pages folder, or, in a Vitest test, which has no
 * `require.context`, the files of an `import.meta.glob` such as
 * `import.meta.glob('./pages/**\/*.page.ts')`. A page from a `require.context`, or from a glob
 * that loads each file, is loaded the first time it is navigated to; a page from an eager glob is
 * routed as it is.
 *
 * | File                  | Route                                                      |
 * | --------------------- | ---------------------------------------------------------- |
 * | `index.page.ts`       | `''`, the folder's own page                                |
 * | `about.page.ts`       | `about`                                                    |
 * | `[id].page.ts`        | `:id`                                                      |
 * | `[...slug].page.ts`   | all under its folder, the rest of the URL as `slug`        |
 * | `(auth)/`             | no segment of its own                                      |
 * | `blog.[slug].page.ts` | `blog/:slug`, without a layout                             |
 * | `products.page.ts`    | a layout around `products/`, with an outlet for its pages  |
 *
 * At each level a static path comes first, then a group's layout, then a parameter, then a
 * catch-all. Two files at the same URL, a name with brackets that are not one of the above, and a
 * `.md` page with no `options.markdownPage` each throw here, naming the file. A page with no
 * default export throws here when it is eager, and on the navigation that loads it when it is
 * lazy.
 */
export function fileRoutes(
  pages: PageContext | PageFiles,
  options: FileRoutesOptions = {},
): Routes {
  const found = typeof pages === 'function' ? fromContext(pages) : fromGlob(pages);
  const root: Entry = { parts: [], pages: [], children: new Map() };
  for (const [path, page] of found) {
    if (page.markdown && !options.markdownPage) {
      throw new Error(
        `${page.key} is a Markdown page, and fileRoutes has no component to draw it with. Pass ` +
          'one: fileRoutes(pages, { markdownPage }). See injectMarkdownPage.',
      );
    }
    const names = path.split('/');
    let entry = root;
    for (const name of names) {
      let next = entry.children.get(name);
      if (!next) {
        next = { parts: partsOf(name, page.key), pages: [], children: new Map() };
        entry.children.set(name, next);
      }
      entry = next;
    }
    entry.pages.push(page);
  }
  checkPaths(root, [], new Map());
  return routesOf(root, options).map((ranked) => ranked.route);
}

/** The context's files, each by its path from the pages folder without its extension. */
function fromContext(pages: PageContext): [string, Page][] {
  return pages.keys().map((key) => {
    const path = key.replace(/\\/g, '/').replace(/^\.?\//, '');
    return named(key, path, () => pages(key), true);
  });
}

/**
 * The glob's files, each by its path from the pages folder: what follows the first `pages/` in
 * its key (`/src/app/pages/about.page.ts`, `./pages/about.page.ts`), or the key itself when it
 * has none, for a glob made inside the pages folder.
 */
function fromGlob(pages: PageFiles): [string, Page][] {
  return Object.keys(pages).map((key) => {
    const slashed = key.replace(/\\/g, '/');
    const path = /^(?:.*?\/)?pages\/(.*)$/.exec(slashed)?.[1] ?? slashed.replace(/^\.?\//, '');
    const value = pages[key];
    return typeof value === 'function'
      ? named(key, path, value as () => unknown, true)
      : named(key, path, () => value, false);
  });
}

function named(key: string, path: string, load: () => unknown, lazy: boolean): [string, Page] {
  const markdown = path.endsWith('.md');
  const stem = path.replace(/\.page\.[cm]?[jt]s$/, '').replace(/\.md$/, '');
  if (stem === path) {
    throw new Error(
      `${key} is not a page. A page's file name ends in .page.ts, or .md for a Markdown page: ` +
        'narrow the require.context or import.meta.glob to those.',
    );
  }
  return [stem, { key, file: path, markdown, load, lazy }];
}

/**
 * The URL parts a file or folder name makes. A dot splits a name into segments, as in Analog
 * (`blog.[slug]` is `blog/:slug`), except inside brackets (`[...slug]`).
 */
function partsOf(name: string, key: string): Part[] {
  return name.split(/\.(?![^[]*\])/).map((piece): Part => {
    if (piece === 'index') return { kind: 'static', path: '' };
    if (/^\([^()[\]./]+\)$/.test(piece)) return { kind: 'group' };
    const rest = /^\[\[\.\.\.([\w$-]+)\]\]$/.exec(piece) ?? /^\[\.\.\.([\w$-]+)\]$/.exec(piece);
    if (rest) return { kind: 'rest', name: rest[1]! };
    const param = /^\[([\w$-]+)\]$/.exec(piece);
    if (param) return { kind: 'param', name: param[1]! };
    if (piece && !/[[\]():]/.test(piece)) return { kind: 'static', path: piece };
    throw new Error(
      `${key}: "${piece}" is not a page name fileRoutes reads. A name is a segment (about), a ` +
        'parameter ([id]), a catch-all ([...slug]) or a group ((auth)), and index is the ' +
        "folder's own page.",
    );
  });
}

/**
 * Throws for a catch-all with anything after it, and for two pages at one URL: two files for one
 * name (`about.page.ts` and `about.md`), or two pages whose paths differ only in groups or in
 * parameter names. A layout is not a page at its URL; its folder's `index.page.ts` is.
 */
function checkPaths(entry: Entry, above: Part[], seen: Map<string, string>): void {
  for (const child of entry.children.values()) {
    const parts = [...above, ...child.parts];
    const rest = parts.findIndex((part) => part.kind === 'rest');
    const key = child.pages[0]?.key ?? firstKey(child);
    if (rest !== -1 && (rest < parts.length - 1 || child.children.size > 0)) {
      throw new Error(
        `${key}: a catch-all ([...slug]) takes the rest of the URL, so it is the last part of a ` +
          'path, with no folder of pages under it.',
      );
    }
    if (child.pages.length > 1) {
      throw new Error(
        `${child.pages[0]!.key} and ${child.pages[1]!.key} are the same page. Keep one of them.`,
      );
    }
    if (child.pages.length === 1 && child.children.size === 0) {
      const url = urlOf(parts);
      const other = seen.get(url);
      if (other) {
        throw new Error(
          `${other} and ${key} are both the page at /${url}. Keep one of them, or move one.`,
        );
      }
      seen.set(url, key);
    }
    checkPaths(child, parts, seen);
  }
}

function firstKey(entry: Entry): string {
  for (const child of entry.children.values()) return child.pages[0]?.key ?? firstKey(child);
  return '';
}

/** A page's URL as a pattern, with every parameter alike, for telling two pages at one URL. */
function urlOf(parts: Part[]): string {
  return parts
    .flatMap((part) => {
      if (part.kind === 'param') return [':'];
      if (part.kind === 'rest') return ['**'];
      return part.kind === 'static' && part.path ? [part.path] : [];
    })
    .join('/');
}

/**
 * The routes under `entry`, in the order Angular should try them: a static path first, then a
 * group's layout, then a path with a parameter, then a catch-all, each by its path. A group with no
 * layout of its own adds nothing to the URL or the tree, so its routes join its siblings'.
 */
function routesOf(entry: Entry, options: FileRoutesOptions): Ranked[] {
  const ranked: Ranked[] = [];
  for (const child of entry.children.values()) {
    const children = routesOf(child, options);
    const path = pathOf(child.parts);
    if (!child.pages[0] && !path) ranked.push(...children);
    else ranked.push(rankedRoute(child, path, children, options));
  }
  return ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.key < b.key ? -1 : 1),
  );
}

/** The route for a file or folder name at `path`, with its routes under it. */
function rankedRoute(
  entry: Entry,
  path: string,
  children: Ranked[],
  options: FileRoutesOptions,
): Ranked {
  const page = entry.pages[0];
  const rest = entry.parts.find((part) => part.kind === 'rest');
  const nested = children.length ? children.map((child) => child.route) : undefined;
  let route: Route = page
    ? pageRoute(page, rest ? { matcher: restOf(rest.name) } : { path }, nested, options)
    : { path, children: nested };
  if (rest && path) route = { path, children: [route] };
  const rank = rest ? 3 : path.includes(':') ? 2 : !path && nested ? 1 : 0;
  return { rank, path, key: page?.key ?? firstKey(entry), route };
}

/** The path a name's parts make, without its groups, its index or its catch-all. */
function pathOf(parts: Part[]): string {
  return parts
    .flatMap((part) => (part.kind === 'static' || part.kind === 'param' ? [segmentOf(part)] : []))
    .filter(Boolean)
    .join('/');
}

function segmentOf(part: Part): string {
  if (part.kind === 'param') return `:${part.name}`;
  return part.kind === 'static' ? part.path : '';
}

/**
 * A catch-all's matcher: it takes every segment left, none included, as Analog's `**` does, and
 * hands them over as one parameter, `docs/intro` for `/docs/intro` under the catch-all's folder.
 */
function restOf(name: string): UrlMatcher {
  return (segments) => ({
    consumed: segments,
    posParams: { [name]: new UrlSegment(segments.map((segment) => segment.path).join('/'), {}) },
  });
}

/**
 * A page's route, at `at`: one with no component that takes the page's place in the URL, and the
 * page's own route under it at `''`, as Analog makes it, so the page's `routeMeta` can wait for a
 * lazy page to load. The page's `children`, when it is a layout, go under its own route.
 *
 * `canMatch` is on the outer route, not the page's own: Angular takes a route whose children match
 * none of an empty rest of the URL as matched, so a page refused there would leave an empty screen
 * where the next route that matches should be.
 */
function pageRoute(
  page: Page,
  at: Pick<Route, 'path' | 'matcher'>,
  children: Routes | undefined,
  options: FileRoutesOptions,
): Route {
  if (!page.lazy) {
    const { canMatch, ...own } = ownRoute(page, page.load(), children, options);
    return { ...at, ...(canMatch ? { canMatch } : {}), children: [own] };
  }
  const load = loaderOf(page);
  const loadChildren = async () => {
    const { canMatch: _matchedAbove, ...own } = ownRoute(page, await load(), children, options);
    return [own];
  };
  if (page.markdown) return { ...at, loadChildren };
  const canMatch: CanMatchFn = (...args) => {
    const injector = inject(EnvironmentInjector);
    return load().then((module) => passes((module as PageModule)?.routeMeta, injector, args));
  };
  return { ...at, canMatch: [canMatch], loadChildren };
}

/**
 * Loads a lazy page once for its `canMatch` and its routes both. A load that fails is forgotten,
 * so the next navigation tries again, as Angular does with a `loadChildren` that fails.
 */
function loaderOf(page: Page): () => Promise<unknown> {
  let loading: Promise<unknown> | undefined;
  return () =>
    (loading ??= Promise.resolve()
      .then(page.load)
      .catch((error: unknown) => {
        loading = undefined;
        throw error;
      }));
}

/** Runs a loaded page's `canMatch` guards in turn, until one says other than `true`. */
async function passes(
  meta: RouteMeta | undefined,
  injector: EnvironmentInjector,
  args: Parameters<CanMatchFn>,
): Promise<GuardResult> {
  const guards = (meta as { canMatch?: CanMatchFn[] } | undefined)?.canMatch ?? [];
  for (const guard of guards) {
    const result = await firstOf(runInInjectionContext(injector, () => guard(...args)));
    if (result !== true) return result as GuardResult;
  }
  return true;
}

/** A guard's result, from an Observable's first value or a promise as from a value. */
function firstOf(result: unknown): Promise<unknown> {
  const observable = result as { subscribe?: unknown } | null;
  if (typeof observable?.subscribe !== 'function') return Promise.resolve(result);
  const source = observable as { subscribe(observer: object): { unsubscribe(): void } };
  return new Promise((resolve, reject) => {
    let done = false;
    let subscription: { unsubscribe(): void } | undefined;
    subscription = source.subscribe({
      next: (value: unknown) => {
        if (done) return;
        done = true;
        resolve(value);
        subscription?.unsubscribe();
      },
      error: reject,
      complete: () => resolve(false),
    });
    if (done) subscription.unsubscribe();
  });
}

function ownRoute(
  page: Page,
  loaded: unknown,
  children: Routes | undefined,
  options: FileRoutesOptions,
): Route {
  const module = page.markdown ? markdownModule(page, loaded, options) : (loaded as PageModule);
  const meta = (module?.routeMeta ?? {}) as Record<string, unknown>;
  const set = SET_BY_THE_FILE.find((name) => name in meta);
  if (set) {
    throw new Error(
      `${page.key} sets routeMeta.${set}, which a page's file sets by where it is. Leave it out.`,
    );
  }
  const config = { ...meta } as Route;
  delete (config as { meta?: unknown }).meta;
  if (config.redirectTo !== undefined) {
    if (children) {
      throw new Error(
        `${page.key} redirects, and a page that redirects is not a layout: its folder's pages ` +
          'would never show. Redirect from a page with no folder beside it.',
      );
    }
    return { path: '', pathMatch: 'full', ...config };
  }
  if (typeof module?.default !== 'function') {
    throw new Error(
      `${page.key} has no default export. A page exports its component as the default: ` +
        '`export default class AboutPage {}`.',
    );
  }
  return {
    path: '',
    component: module.default as Type<unknown>,
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
    ...config,
    ...(children ? { children } : {}),
  };
}

/** A `.md` page as a page module: `markdownPage`, titled by the file's front matter. */
function markdownModule(page: Page, loaded: unknown, options: FileRoutesOptions): PageModule {
  const file = markdownPageFile(page.file, loaded);
  const title = file.attributes['title'];
  return {
    default: options.markdownPage,
    routeMeta: {
      ...(typeof title === 'string' ? { title } : {}),
      data: { [MARKDOWN_PAGE]: file },
    },
  };
}
