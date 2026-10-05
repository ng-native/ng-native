/**
 * `fileRoutes` from `@ng-native/router`: an app's pages, found by Metro's `require.context` or
 * Vite's `import.meta.glob`, routed by their paths with Analog's file names, with no Analog.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inject, type Provider, type Type } from '@angular/core';
import { Router, withComponentInputBinding, type Route, type Routes } from '@angular/router';
import {
  cleanup,
  fireEvent,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { fileRoutes, type FileRoutesOptions } from '../router/src/file-routes.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { of } from 'rxjs';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
const component = (name: string) => mod[name] as Type<unknown>;
const page = (name: string, routeMeta?: object) => ({ default: component(name), routeMeta });

before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/file-routes.ts', import.meta.url)));
});

afterEach(() => cleanup());

/** What `require.context('./pages', true, pattern, 'lazy')` returns over `files`. */
function context(files: Record<string, unknown>) {
  const asked: string[] = [];
  const load = (key: string) => {
    asked.push(key);
    return Promise.resolve(files[key]);
  };
  return Object.assign(load, { keys: () => Object.keys(files), asked });
}

/** A lazy `import.meta.glob` of `files`, keyed from the project as Vite keys it. */
function glob(files: Record<string, unknown>, prefix = '/src/app/pages/') {
  return Object.fromEntries(
    Object.entries(files).map(([file, module]) => [`${prefix}${file}`, async () => module]),
  );
}

/** An eager `import.meta.glob` of `files`. */
function eager(files: Record<string, unknown>, prefix = '/src/app/pages/') {
  return Object.fromEntries(Object.entries(files).map(([file, module]) => [prefix + file, module]));
}

/** A route tree without its functions: each path, matcher, page and lazy load. */
function shape(routes: Routes): unknown[] {
  return routes.map((route) => ({
    ...(route.matcher ? { matcher: true } : { path: route.path }),
    ...(route.component ? { component: route.component.name } : {}),
    ...(route.loadChildren ? { lazy: true } : {}),
    ...(route.children ? { children: shape(route.children) } : {}),
  }));
}

/** The paths at one level, `**` for a catch-all. */
const paths = (routes: Routes) => routes.map((route) => (route.matcher ? '**' : route.path));

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await settle();
}

/** Renders the shell over `routes`, and reads what the screen on top says. */
async function start(routes: Routes, providers: Provider[] = []) {
  const app = await render(component('Shell'), {
    providers: [provideNativeRouter(routes, withComponentInputBinding()), ...providers],
  });
  const router = app.componentRef.injector.get(Router);
  const fabric: FakeFabric = app.fabric;
  const top = () => {
    const screens = flatten(fabric.committed).filter((node) => node.viewName === 'RNSScreen');
    return flatten(screens.at(-1)?.children ?? [])
      .map((node) => node.props['text'])
      .filter((text) => typeof text === 'string')
      .join(' ');
  };
  const go = async (url: string) => {
    const done = await router.navigateByUrl(url);
    await idle();
    return done;
  };
  await idle();
  return { router, fabric, top, go };
}

describe('fileRoutes, from file names', () => {
  it("routes each of Analog's file names to its route", () => {
    const routes = fileRoutes(
      eager({
        'index.page.ts': page('Home'),
        'about.page.ts': page('About'),
        'users/[id].page.ts': page('User'),
        '(auth)/login.page.ts': page('Login'),
        'products.page.ts': page('Products'),
        'products/index.page.ts': page('ProductList'),
        'products/[productId].page.ts': page('Product'),
        'docs/[...slug].page.ts': page('Docs'),
        'blog.[slug].page.ts': page('Post'),
      }),
    );
    const own = (name: string, children?: unknown[]) => [
      { path: '', component: name, ...(children ? { children } : {}) },
    ];
    assert.deepEqual(shape(routes), [
      { path: '', children: own('Home') },
      { path: 'about', children: own('About') },
      { path: 'docs', children: [{ matcher: true, children: own('Docs') }] },
      { path: 'login', children: own('Login') },
      {
        path: 'products',
        children: own('Products', [
          { path: '', children: own('ProductList') },
          { path: ':productId', children: own('Product') },
        ]),
      },
      { path: 'users', children: [{ path: ':id', children: own('User') }] },
      { path: 'blog/:slug', children: own('Post') },
    ]);
  });

  it('puts a static path before a group layout, a parameter and a catch-all, in any key order', () => {
    const files = {
      '[...missing].page.ts': page('Missing'),
      '[id].page.ts': page('User'),
      'zebra.page.ts': page('About'),
      '(shop).page.ts': page('Products'),
      '(shop)/cart.page.ts': page('ProductList'),
      'about.page.ts': page('About'),
      'index.page.ts': page('Home'),
    };
    const expected = ['', 'about', 'zebra', '', ':id', '**'];
    assert.deepEqual(paths(fileRoutes(eager(files))), expected);
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    assert.deepEqual(paths(fileRoutes(eager(reversed))), expected);
  });

  it('reads the same pages from context keys and from glob keys of any root', () => {
    const files = { 'index.page.ts': {}, 'users/[id].page.ts': {}, '(auth)/login.page.ts': {} };
    const fromContext = shape(fileRoutes(context(eager(files, './'))));
    assert.deepEqual(shape(fileRoutes(glob(files))), fromContext);
    assert.deepEqual(shape(fileRoutes(glob(files, './pages/'))), fromContext);
    assert.deepEqual(shape(fileRoutes(glob(files, '../app/pages/'))), fromContext);
    assert.deepEqual(shape(fileRoutes(glob(files, './'))), fromContext);
    assert.deepEqual(paths(fileRoutes(glob(files))), ['', 'login', 'users']);
  });

  it('loads nothing until a page is navigated to, then only that page, by its own key', async () => {
    const pages = context({
      './index.page.ts': page('Home'),
      './about.page.ts': page('About'),
      './users/[id].page.ts': page('User'),
    });
    const routes = fileRoutes(pages);
    assert.deepEqual(pages.asked, []);
    assert.deepEqual(shape(routes)[0], { path: '', lazy: true });

    const { go, top } = await start(routes);
    assert.deepEqual(pages.asked, ['./index.page.ts']);
    await go('/users/7');
    assert.equal(top(), 'user 7');
    assert.deepEqual(pages.asked, ['./index.page.ts', './users/[id].page.ts']);
  });

  it('routes the pages of an eager glob without a load', () => {
    const routes = fileRoutes(eager({ 'about.page.ts': page('About') }));
    assert.deepEqual(shape(routes), [
      { path: 'about', children: [{ path: '', component: 'About' }] },
    ]);
  });

  it('has no routes for no pages', () => {
    assert.deepEqual(fileRoutes(context({})), []);
  });
});

describe('fileRoutes, navigated', () => {
  const PAGES = () =>
    context({
      './index.page.ts': page('Home'),
      './about.page.ts': page('About'),
      './users/[id].page.ts': page('User'),
      './(auth)/login.page.ts': page('Login'),
      './products.page.ts': page('Products'),
      './products/index.page.ts': page('ProductList'),
      './products/[productId].page.ts': page('Product'),
      './docs/[...slug].page.ts': page('Docs'),
      './blog.[slug].page.ts': page('Post'),
      './[...missing].page.ts': page('Missing'),
    });

  it('opens each page at the url its file names', async () => {
    const { go, top, router } = await start(fileRoutes(PAGES()));
    assert.equal(top(), 'home');
    for (const [url, says] of [
      ['/about', 'about'],
      ['/users/7', 'user 7'],
      ['/login', 'login'],
      ['/blog/hello', 'post hello'],
      ['/products', 'product list'],
      ['/products/3', 'product 3'],
      ['/nowhere/at/all', 'missing'],
    ]) {
      assert.equal(await go(url!), true, url);
      assert.equal(router.url, url);
      assert.equal(top(), says, url);
    }
  });

  it('hands a catch-all the rest of the url as its parameter, none included', async () => {
    const { go, top } = await start(fileRoutes(PAGES()));
    await go('/docs/guide/install');
    assert.equal(top(), 'docs [guide/install]');
    await go('/docs');
    assert.equal(top(), 'docs []');
  });

  it("draws a layout around its folder's pages, in the stack it holds", async () => {
    const { go, fabric } = await start(fileRoutes(PAGES()));
    await go('/products/3');
    const texts = flatten(fabric.committed)
      .map((node) => node.props['text'])
      .filter((text) => typeof text === 'string');
    assert.deepEqual(
      texts.filter((text) => /product/.test(text)),
      ['products layout', 'product 3'],
    );
  });

  it('routes the same from an eager glob', async () => {
    const { go, top } = await start(
      fileRoutes(
        eager({
          'index.page.ts': page('Home'),
          'users/[id].page.ts': page('User'),
          'docs/[...slug].page.ts': page('Docs'),
        }),
      ),
    );
    assert.equal(top(), 'home');
    await go('/users/9');
    assert.equal(top(), 'user 9');
    await go('/docs/a/b');
    assert.equal(top(), 'docs [a/b]');
  });
});

const failing = { unsubscribed: false };

for (const lazy of [true, false]) {
  describe(`fileRoutes, routeMeta of ${lazy ? 'a lazy' : 'an eager'} page`, () => {
    async function withMeta() {
      const { GREETING, resolved } = mod as {
        GREETING: unknown;
        resolved: { runs: number };
      };
      resolved.runs = 0;
      failing.unsubscribed = false;
      const files = {
        'index.page.ts': page('Home'),
        'about.page.ts': page('About'),
        'titled.page.ts': page('Titled', {
          title: 'The title',
          data: { kind: 'kind-data' },
          providers: [{ provide: GREETING, useValue: 'hello' }],
          resolve: { count: () => ++resolved.runs },
          meta: [{ name: 'description', content: 'a page' }],
        }),
        'closed.page.ts': page('Secret', { canActivate: [() => false] }),
        'draft.page.ts': page('Draft', { canDeactivate: [() => false] }),
        'secret.page.ts': page('Secret', { canMatch: [() => true, () => false] }),
        'observed.page.ts': page('Secret', { canMatch: [() => of(false)] }),
        'open.page.ts': page('About', { canMatch: [async () => true, () => of(true)] }),
        'failing.page.ts': page('Secret', {
          canMatch: [
            () => ({
              subscribe(observer: { error(error: unknown): void }) {
                observer.error(new Error('refused'));
                return { unsubscribe: () => void (failing.unsubscribed = true) };
              },
            }),
          ],
        }),
        'old-home.page.ts': { routeMeta: { redirectTo: '/about' } },
        '[...missing].page.ts': page('Missing'),
      };
      const pages = lazy ? context(eager(files, './')) : eager(files);
      return { ...(await start(fileRoutes(pages))), resolved };
    }

    it('gives the page its title, data, providers and resolved data, and leaves out meta', async () => {
      const { go, top, router } = await withMeta();
      await go('/titled');
      assert.equal(top(), 'titled The title kind-data hello');
      let leaf = router.routerState.snapshot.root;
      while (leaf.firstChild) leaf = leaf.firstChild;
      assert.equal(leaf.data['count'], 1);
      assert.equal('meta' in leaf.routeConfig!, false);
    });

    it("runs a page's resolvers again when its query changes, as Analog does", async () => {
      const { go, resolved } = await withMeta();
      await go('/titled');
      await go('/titled?tab=2');
      assert.equal(resolved.runs, 2);
    });

    it('stops at canActivate and at canDeactivate', async () => {
      const { go, router } = await withMeta();
      assert.equal(await go('/closed'), false);
      assert.equal(router.url, '/');

      await go('/draft');
      assert.equal(await go('/about'), false);
      assert.equal(router.url, '/draft');
    });

    it('passes a page over at canMatch, to the next route that matches', async () => {
      const { go, top } = await withMeta();
      await go('/secret');
      assert.equal(top(), 'missing');
      await go('/observed');
      assert.equal(top(), 'missing');
      await go('/open');
      assert.equal(top(), 'about');
    });

    it('lets go of a lazy canMatch that fails as it subscribes', async (t) => {
      if (!lazy) return t.skip('an eager page hands its canMatch to Angular');
      const { go, top } = await withMeta();
      await go('/failing').catch(() => false);
      assert.equal(top(), 'home');
      assert.equal(failing.unsubscribed, true);
    });

    it('redirects from a page with redirectTo and no component, matching its whole path', async () => {
      const { go, top, router } = await withMeta();
      assert.equal(await go('/old-home'), true);
      assert.equal(router.url, '/about');
      assert.equal(top(), 'about');
    });
  });
}

describe('fileRoutes, an index page', () => {
  for (const lazy of [true, false]) {
    it(`redirects from its canMatch without running it again for the target, ${lazy ? 'lazy' : 'eager'}`, async () => {
      let runs = 0;
      const files = {
        'index.page.ts': page('Home', {
          canMatch: [() => (++runs > 20 ? true : inject(Router).parseUrl('/login'))],
        }),
        'login.page.ts': page('Login'),
      };
      const { top, router } = await start(
        fileRoutes(lazy ? context(eager(files, './')) : eager(files)),
      );
      assert.equal(runs, 1);
      assert.equal(router.url, '/login');
      assert.equal(top(), 'login');
    });
  }

  it('is not loaded by a navigation to another page beside it', async () => {
    const pages = context({
      './index.page.ts': page('Home'),
      './blog/index.page.ts': page('ProductList'),
      './blog/[slug].page.ts': page('Post'),
    });
    const { go, top } = await start(fileRoutes(pages));
    await go('/blog/first');
    assert.equal(top(), 'post first');
    assert.deepEqual(pages.asked, ['./index.page.ts', './blog/[slug].page.ts']);
  });
});

describe('fileRoutes, a lazy page whose load fails', () => {
  it('loads it again on the next navigation', async () => {
    let fails = true;
    const asked: string[] = [];
    const pages = Object.assign(
      (key: string) => {
        asked.push(key);
        if (key === './about.page.ts' && fails) return Promise.reject(new Error('offline'));
        return Promise.resolve(key === './about.page.ts' ? page('About') : page('Home'));
      },
      { keys: () => ['./index.page.ts', './about.page.ts'] },
    );
    const { go, top, router } = await start(fileRoutes(pages));
    await assert.rejects(router.navigateByUrl('/about'), /offline/);
    await idle();
    assert.equal(top(), 'home');

    fails = false;
    assert.equal(await go('/about'), true);
    assert.equal(top(), 'about');
    assert.deepEqual(
      asked.filter((key) => key === './about.page.ts'),
      ['./about.page.ts', './about.page.ts'],
    );
  });
});

describe('fileRoutes, Markdown pages', () => {
  const md = (title: string, content: string) => ({
    default: { attributes: { title }, content, tokens: [{ type: 'paragraph', raw: content }] },
  });

  it('draws a .md page with markdownPage, titled by its front matter, lazy or eager', async () => {
    const options: FileRoutesOptions = { markdownPage: component('MarkdownPage') };
    const lazy = await start(
      fileRoutes(
        context({ './index.page.ts': page('Home'), './guides/index.md': md('Guides', 'All') }),
        options,
      ),
    );
    await lazy.go('/guides');
    assert.equal(lazy.top(), 'markdown guides/index.md [] Guides: All');
    cleanup();

    const eagerly = await start(
      fileRoutes(eager({ 'index.page.ts': page('Home'), 'about.md': md('About', 'Hi') }), options),
    );
    await eagerly.go('/about');
    assert.equal(eagerly.top(), 'markdown about.md [about] About: Hi');
  });
});

describe('fileRoutes, startup errors', () => {
  const files = (...names: string[]) => context(Object.fromEntries(names.map((n) => [n, {}])));

  it('names both files when two are the same page', () => {
    for (const [names, message] of [
      [
        ['./index.page.ts', './(home)/index.page.ts'],
        /\.\/index\.page\.ts and \.\/\(home\)\/index\.page\.ts are both the page at \/\./,
      ],
      [['./[id].page.ts', './[slug].page.ts'], /are both the page at \/:/],
      [['./(a)/x.page.ts', './x/index.page.ts'], /are both the page at \/x\./],
      [
        ['./about.page.ts', './about.page.js'],
        /\.\/about\.page\.ts and \.\/about\.page\.js are the same page/,
      ],
    ] as const) {
      assert.throws(() => fileRoutes(files(...names)), message, names.join(', '));
    }
    assert.throws(
      () => fileRoutes(files('./about.page.ts', './about.md'), { markdownPage: class {} }),
      /are the same page/,
    );
  });

  it('names a file whose brackets are not a parameter, a catch-all or a group', () => {
    for (const name of [
      './[id.page.ts',
      './id].page.ts',
      './[].page.ts',
      './[..slug].page.ts',
      './a[b].page.ts',
      './[a]b.page.ts',
      './(a.page.ts',
      './users/[a.b]/index.page.ts',
    ]) {
      assert.throws(() => fileRoutes(files(name)), /is not a page name fileRoutes reads/, name);
    }
  });

  it('throws for a catch-all with a path after it', () => {
    assert.throws(
      () => fileRoutes(files('./[...slug]/edit.page.ts')),
      /\[\.\.\.slug\]\/edit\.page\.ts: a catch-all .* is the last part of a path/,
    );
  });

  it('throws for a file that is not a page, and a .md page with nothing to draw it', () => {
    assert.throws(() => fileRoutes(files('./helpers.ts')), /\.\/helpers\.ts is not a page/);
    assert.throws(
      () => fileRoutes(files('./about.md')),
      /\.\/about\.md is a Markdown page, .* fileRoutes\(pages, \{ markdownPage \}\)/,
    );
    assert.throws(
      () => fileRoutes(eager({ 'about.md': {} }), { markdownPage: class {} }),
      /about\.md is not the module @ng-native\/metro makes of a \.md file/,
    );
  });

  it('throws for an eager page with no default export at once, and a lazy one as it loads', async () => {
    assert.throws(
      () => fileRoutes(eager({ 'about.page.ts': {} })),
      /\/src\/app\/pages\/about\.page\.ts has no default export/,
    );
    const [lazy] = fileRoutes(files('./about.page.ts'));
    await assert.rejects(
      async () => (lazy!.loadChildren as () => Promise<Route[]>)(),
      /\.\/about\.page\.ts has no default export/,
    );
  });

  it('throws for routeMeta that sets what the file sets, and for a layout that redirects', () => {
    assert.throws(
      () => fileRoutes(eager({ 'a.page.ts': page('About', { component: class {} }) })),
      /a\.page\.ts sets routeMeta\.component/,
    );
    assert.throws(
      () =>
        fileRoutes(
          eager({ 'a.page.ts': { routeMeta: { redirectTo: '/' } }, 'a/b.page.ts': page('About') }),
        ),
      /a\.page\.ts redirects, and a page that redirects is not a layout/,
    );
  });
});

describe('fileRoutes, a tab bar layout', () => {
  it("routes a layout's tabs to its folder's pages, its index page the tab at ''", async () => {
    const pages = context({
      './(tabs).page.ts': page('Bar'),
      './(tabs)/index.page.ts': page('Home'),
      './(tabs)/schedule.page.ts': page('Schedule'),
      './users/[id].page.ts': page('User'),
    });
    const { fabric, router, go } = await start(fileRoutes(pages));
    const host = () =>
      flatten(fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    const selected = () =>
      (host().props['navStateRequest'] as { selectedScreenKey: string }).selectedScreenKey;
    const shown = () =>
      flatten(fabric.committed)
        .map((node) => node.props['text'])
        .filter((text) => typeof text === 'string');

    assert.equal(router.url, '/');
    assert.equal(selected(), '/');
    assert.ok(shown().includes('home'));

    await fireEvent(host(), 'tabSelected', { selectedScreenKey: 'schedule', provenance: 1 });
    await idle();
    assert.equal(router.url, '/schedule');
    assert.equal(selected(), 'schedule');
    assert.ok(shown().includes('schedule'));

    await fireEvent(host(), 'tabSelected', { selectedScreenKey: '/', provenance: 2 });
    await idle();
    assert.equal(router.url, '/');

    await go('/users/4');
    assert.equal(router.url, '/users/4');
    assert.ok(shown().includes('user 4'));
  });
});
