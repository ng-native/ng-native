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
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { MARKDOWN_PAGE, markdownModuleOf, markdownPageFile } from './content.ts';

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

export interface PageRoutesOptions {
  /**
   * The component a `.md` page is drawn with. It reads its file with `injectMarkdownPage()` and
   * draws `tokens` with `<markdown>` from `@ng-native/components/markdown`. Required when the
   * pages include a `.md` file.
   */
  markdownPage?: Type<unknown>;
}

/**
 * The routes for an app's pages, as `createRoutes` makes them in an Analog app.
 *
 * `pages` is the `require.context` of the pages directory in an app, or in a Vitest test, which
 * has no `require.context`, the files of an `import.meta.glob` such as
 * `import.meta.glob('./pages/**\/*.page.ts')`.
 *
 * A `.md` file among them is a page too, at the URL its name gives it, as in Analog: its front
 * matter `title` is the route's title and `meta` its `routeMeta.meta`, and it is drawn by
 * `options.markdownPage`.
 */
export function pageRoutes(
  pages: PageContext | PageFiles,
  options: PageRoutesOptions = {},
): Routes {
  defineImportMetaEnv();
  const files = typeof pages === 'function' ? filesOf(pages) : pages;
  return createRoutes(withMarkdownPages(files, options.markdownPage) as Files);
}

/**
 * The files with each `.md` page renamed to the `.page.ts` it routes as, loading `markdownPage`
 * with the file in its route data. Analog's own Markdown pages render with `@analogjs/content`,
 * which draws HTML, so `createRoutes` is never handed one.
 */
function withMarkdownPages(files: PageFiles, markdownPage: Type<unknown> | undefined): PageFiles {
  const markdown = Object.keys(files).filter((name) => name.endsWith('.md'));
  if (!markdown.length) return files;
  if (!markdownPage) {
    throw new Error(
      `${markdown[0]} is a Markdown page, and pageRoutes has no component to draw it with. Pass ` +
        'one: pageRoutes(pages, { markdownPage }). See injectMarkdownPage.',
    );
  }
  const routed: PageFiles = {};
  for (const [name, load] of Object.entries(files)) {
    if (!name.endsWith('.md')) {
      routed[name] = load;
      continue;
    }
    const page = name.replace(/\.md$/, '.page.ts');
    if (page in files) {
      throw new Error(`${name} and ${page} are the same page. Keep one of them.`);
    }
    routed[page] = async () => {
      const filename = name.replace(/^.*?\/pages\//, '/src/app/pages/');
      const file = markdownPageFile(filename, markdownModuleOf(await load(), filename));
      const { title, meta } = file.attributes;
      return {
        default: markdownPage,
        routeMeta: {
          ...(typeof title === 'string' ? { title } : {}),
          ...(Array.isArray(meta) ? { meta } : {}),
          data: { [MARKDOWN_PAGE]: file },
        },
      };
    };
  }
  return routed;
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
