/**
 * Analog's file-based pages on a native stack: `pageRoutes` hands the files under
 * `src/app/pages` to `createRoutes` from `@analogjs/router`, so `index.page.ts`, `[id].page.ts`,
 * `(group)` folders, layouts and each page's `routeMeta` route as they do in an Analog app, and
 * `provideNativeRouter` takes the routes it returns.
 *
 * ```ts
 * const pages = require.context('./pages', true, /\.page\.ts$/, 'lazy');
 *
 * mount(rootTag, App, fabric, { providers: [provideNativeRouter(pageRoutes(pages))] });
 * ```
 *
 * The routing is Analog's own, not a copy of it. What this adds is the two things Metro does not
 * do as Vite does: it finds the pages with `require.context` rather than `import.meta.glob`, and
 * it leaves `import.meta.env` undefined.
 */
import { createRoutes, type Files } from '@analogjs/router';
import type { Routes } from '@angular/router';

/**
 * What Metro's `require.context(directory, true, pattern, 'lazy')` returns: the files it found,
 * each keyed by its path from that directory (`./users/[id].page.ts`), and a call that loads one.
 */
export interface PageContext {
  keys(): string[];
  (key: string): Promise<unknown>;
}

/**
 * Each page's file name, with a call that loads it: what `import.meta.glob` returns, and what
 * `createRoutes` takes.
 */
export type PageFiles = Record<string, () => Promise<unknown>>;

/**
 * The routes for an app's pages, as `createRoutes` makes them in an Analog app.
 *
 * `pages` is the `require.context` of the pages directory in an app, or in a Vitest test, which
 * has no `require.context`, the files of an `import.meta.glob` such as
 * `import.meta.glob('./pages/**\/*.page.ts')`.
 */
export function pageRoutes(pages: PageContext | PageFiles): Routes {
  defineImportMetaEnv();
  return createRoutes((typeof pages === 'function' ? filesOf(pages) : pages) as Files);
}

/**
 * The context's files as Analog's own glob names them, from the project root: `createRoutes`
 * finds each page's route from what follows `/pages/` in its name.
 */
function filesOf(pages: PageContext): PageFiles {
  return Object.fromEntries(
    pages.keys().map((key) => [`/src/app/pages/${key.replace(/^\.\//, '')}`, () => pages(key)]),
  );
}

declare const __DEV__: boolean | undefined;

interface ImportMetaRegistry {
  env?: Record<string, unknown>;
}

/**
 * `import.meta.env` as Vite defines it, on the object Expo's Babel preset turns `import.meta` into.
 *
 * Analog reads `import.meta.env.DEV` as it loads every page, and Expo defines only
 * `import.meta.url`, so without this the first navigation fails with a TypeError. The registry
 * exists once `expo` is imported, which an app's `main.ts` does first, and nothing reads `env`
 * until a page loads, which is after this has run. An `env` already there is left as it is.
 */
function defineImportMetaEnv(): void {
  const registry = (globalThis as { __ExpoImportMetaRegistry?: ImportMetaRegistry })
    .__ExpoImportMetaRegistry;
  if (!registry || registry.env) return;
  const dev = typeof __DEV__ === 'boolean' && __DEV__;
  registry.env = {
    DEV: dev,
    PROD: !dev,
    SSR: false,
    MODE: dev ? 'development' : 'production',
    BASE_URL: '/',
  };
}
