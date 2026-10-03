/**
 * `@ng-native/analog`: an app's Analog pages, found by Metro's `require.context` or Vite's
 * `import.meta.glob`, routed by Analog's own `createRoutes`, and the Metro config they need.
 *
 * A page is loaded only on a navigation, and Analog reads `import.meta.env` as it loads one, which
 * Node does not define. So what a page's `routeMeta` does, and navigating between pages, are
 * tested by the example app's Vitest suite (`examples/analog`), where Vite defines it.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, describe, it } from 'node:test';
import { createRoutes } from '@analogjs/router';
import type { Routes } from '@angular/router';
import { pageRoutes } from '@ng-native/analog';

const require = createRequire(import.meta.url);

type Resolve = (context: object, name: string, platform: string | null) => unknown;

interface MetroConfig {
  transformer: { unstable_allowRequireContext?: boolean };
  resolver: { resolveRequest?: Resolve };
}

const { withAnalog } = require('@ng-native/analog/metro') as {
  withAnalog(config: MetroConfig): MetroConfig;
};

/** What Metro's `require.context('./pages', true, /\.page\.ts$/, 'lazy')` returns, over `pages`. */
function context(pages: Record<string, unknown>) {
  const asked: string[] = [];
  const load = (key: string) => {
    asked.push(key);
    return Promise.resolve(pages[key]);
  };
  return Object.assign(load, { keys: () => Object.keys(pages), asked });
}

/** A route tree without its functions: the path, and whether it loads a page. */
const shape = (routes: Routes): unknown =>
  routes.map((route) => ({
    path: route.path,
    page: typeof route.loadChildren === 'function',
    ...(route.children ? { children: shape(route.children) } : {}),
  }));

const FILES = [
  'index.page.ts',
  'users.page.ts',
  'users/index.page.ts',
  'users/[id].page.ts',
  '(auth)/login.page.ts',
  'settings/profile.page.ts',
];

describe('pageRoutes', () => {
  it('routes a require.context of pages as Analog routes the same files', () => {
    const routes = pageRoutes(context(Object.fromEntries(FILES.map((file) => [`./${file}`, {}]))));
    const analog = createRoutes(
      Object.fromEntries(
        FILES.map((file) => [`/src/app/pages/${file}`, async () => ({ default: class {} })]),
      ),
    );
    assert.deepEqual(shape(routes), shape(analog));
  });

  it('gives index the empty path, [id] a parameter, a (group) no segment, a folder its own', () => {
    const routes = pageRoutes(context(Object.fromEntries(FILES.map((file) => [`./${file}`, {}]))));
    assert.deepEqual(shape(routes), [
      { path: '', page: true },
      { path: '', page: false, children: [{ path: 'login', page: true }] },
      { path: 'settings', page: false, children: [{ path: 'profile', page: true }] },
      { path: 'users', page: true },
    ]);
  });

  it('loads a page through the context, by the key the context listed it under', async () => {
    const pages = context({ './(auth)/login.page.ts': { default: class {} } });
    const [group] = pageRoutes(pages);
    // Then Analog reads import.meta.env, which Node has not got: see the top of this file.
    await Promise.resolve(group!.children![0]!.loadChildren!()).catch(() => undefined);
    assert.deepEqual(pages.asked, ['./(auth)/login.page.ts']);
  });

  it('takes the files of an import.meta.glob as they are', () => {
    const glob = {
      './pages/index.page.ts': async () => ({}),
      './pages/users/[id].page.ts': async () => ({}),
    };
    assert.deepEqual(shape(pageRoutes(glob)), [
      { path: '', page: true },
      { path: 'users', page: false, children: [{ path: ':id', page: true }] },
    ]);
  });

  it('has no routes for no pages', () => {
    assert.deepEqual(pageRoutes(context({})), []);
  });
});

describe("pageRoutes on Expo's import.meta", () => {
  const globals = globalThis as { __ExpoImportMetaRegistry?: { env?: unknown }; __DEV__?: unknown };
  const before = { ...globals };

  afterEach(() => {
    for (const key of ['__ExpoImportMetaRegistry', '__DEV__'] as const) {
      if (key in before) globals[key] = before[key] as never;
      else delete globals[key];
    }
  });

  it('defines import.meta.env as Vite does, which Analog reads as it loads a page', () => {
    globals.__ExpoImportMetaRegistry = {};
    globals.__DEV__ = true;
    pageRoutes(context({}));
    assert.deepEqual(globals.__ExpoImportMetaRegistry.env, {
      DEV: true,
      PROD: false,
      SSR: false,
      MODE: 'development',
      BASE_URL: '/',
    });
  });

  it('says production in a release build', () => {
    globals.__ExpoImportMetaRegistry = {};
    globals.__DEV__ = false;
    pageRoutes(context({}));
    assert.deepEqual(globals.__ExpoImportMetaRegistry.env, {
      DEV: false,
      PROD: true,
      SSR: false,
      MODE: 'production',
      BASE_URL: '/',
    });
  });

  it('leaves an import.meta.env that is already there', () => {
    const env = { DEV: false, MODE: 'staging' };
    globals.__ExpoImportMetaRegistry = { env };
    pageRoutes(context({}));
    assert.equal(globals.__ExpoImportMetaRegistry.env, env);
  });

  it('defines nothing off Expo', () => {
    pageRoutes(context({}));
    assert.equal(globals.__ExpoImportMetaRegistry, undefined);
  });
});

describe('withAnalog', () => {
  const missing = (name: string) =>
    Object.assign(new Error(`Unable to resolve module ${name}`), { type: 'UnableToResolveError' });

  /** A Metro config whose resolver knows only `installed`. */
  const config = (installed: Record<string, unknown>): MetroConfig => ({
    transformer: {},
    resolver: {
      resolveRequest: (_context, name) => {
        if (name in installed) return installed[name];
        throw missing(name);
      },
    },
  });

  const resolve = (metro: MetroConfig, name: string) =>
    metro.resolver.resolveRequest!({}, name, 'ios');

  it('resolves @analogjs/content to an empty module when the app has not installed it', () => {
    assert.deepEqual(resolve(withAnalog(config({})), '@analogjs/content'), { type: 'empty' });
  });

  it('leaves an installed @analogjs/content to resolve as it does', () => {
    const content = {
      type: 'sourceFile',
      filePath: '/app/node_modules/@analogjs/content/index.mjs',
    };
    const metro = withAnalog(config({ '@analogjs/content': content }));
    assert.equal(resolve(metro, '@analogjs/content'), content);
  });

  it('leaves every other import, and its failure, alone', () => {
    const router = { type: 'sourceFile', filePath: '/router.mjs' };
    const metro = withAnalog(config({ '@analogjs/router': router }));
    assert.equal(resolve(metro, '@analogjs/router'), router);
    assert.throws(() => resolve(metro, 'not-installed'), /Unable to resolve module not-installed/);
  });

  it("falls back to Metro's own resolver when the config has none", () => {
    const metro = withAnalog({ transformer: {}, resolver: {} });
    const context = {
      resolveRequest: (_context: object, name: string) => {
        throw missing(name);
      },
    };
    assert.deepEqual(metro.resolver.resolveRequest!(context, '@analogjs/content', 'ios'), {
      type: 'empty',
    });
  });

  it('turns on require.context, which finds the pages', () => {
    assert.equal(withAnalog(config({})).transformer.unstable_allowRequireContext, true);
  });
});
