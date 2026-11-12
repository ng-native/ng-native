/**
 * A url with a page in the root's presented outlet, reached without `present()`: a launch link
 * written with the outlet, a link while the app runs, or the app's own `navigateByUrl` or
 * `navigate`. The page's copy in that outlet is made the first time it is presented, so a url that
 * comes first finds none, and the router matched no route for it.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { ErrorHandler, type Provider, type Type } from '@angular/core';
import {
  NavigationError,
  NavigationStart,
  Router,
  withRouterConfig,
  type Route,
  type RouterFeatures,
  type Routes,
} from '@angular/router';
import { DeepLinks } from '@ng-native/device';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter, withLinkParent } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let tabs: Record<string, unknown>;
before(async () => {
  tabs = await compileFixture('fixtures/tab-stacks.ts');
});

const URL = '/home(presented:library/7)';

interface Options {
  /** The url the app is launched with, as the history's first entry. */
  readonly initial?: string;
  /** The url `Linking` launches the app with, delivered as a link. */
  readonly launch?: string;
  readonly linkParent?: boolean;
  readonly routes?: Routes;
  readonly features?: RouterFeatures[];
}

async function tabApp(options: Options = {}) {
  const errors: unknown[] = [];
  let deliver: (url: string) => void = () => {};
  const links: Provider = options.initial
    ? {
        provide: DeepLinks,
        useValue: { initialUrl: () => options.initial, subscribe: () => () => {} },
      }
    : {
        provide: DeepLinks.SOURCE,
        useValue: {
          launchUrl: () => Promise.resolve(options.launch ? `myapp://${options.launch}` : null),
          subscribe: (listener: (url: string) => void) => ((deliver = listener), () => {}),
          open: () => {},
        },
      };
  const routes = options.routes ?? (tabs['routes'] as Routes);
  const features = options.features ?? [];
  const rendered = await render(tabs['Shell'] as Type<unknown>, {
    providers: [
      options.linkParent
        ? provideNativeRouter(
            routes,
            withLinkParent(() => null),
            ...features,
          )
        : provideNativeRouter(routes, ...features),
      links,
      { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
    ],
  });
  await settled();
  const injector = rendered.componentRef.injector;
  return {
    ...rendered,
    router: injector.get(Router),
    navigation: injector.get(NativeNavigation),
    errors,
    deliver: async (url: string) => {
      deliver(`myapp://${url}`);
      await settled();
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settled() {
  await wait(20);
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** The fixture's routes, with the Library tab's pages loaded lazily and slowly. */
function slowLibrary(): Routes {
  return (tabs['routes'] as Routes).map((route) => ({
    ...route,
    children: route.children?.map((child) =>
      child.path === 'library'
        ? {
            path: 'library',
            component: child.component,
            loadChildren: () => wait(30).then(() => child.children!),
          }
        : child,
    ),
  }));
}

/** The `id` of the page the router shows in the presented outlet, or null with none. */
function presentedId(router: Router): string | null {
  let page = router.routerState.snapshot.root.children.find(
    (route) => route.outlet === 'presented',
  );
  while (page?.firstChild) page = page.firstChild;
  return page?.paramMap.get('id') ?? null;
}

function assertPresented(app: { router: Router; errors: unknown[] }, url = URL, id = '7') {
  assert.deepEqual(app.errors, []);
  assert.equal(app.router.url, url);
  assert.equal(presentedId(app.router), id);
}

describe('a url that names a page in the presented outlet, before it was ever presented', () => {
  it('opens on it when the app is launched on it', async () => {
    assertPresented(await tabApp({ initial: URL }));
  });

  it('opens on it from a launch link', async () => {
    assertPresented(await tabApp({ launch: URL }));
  });

  it('opens on it from a launch link when links have a parent page', async () => {
    assertPresented(await tabApp({ launch: URL, linkParent: true }));
  });

  it('goes to it from a link while the app runs', async () => {
    const app = await tabApp();
    await app.deliver(URL);
    assertPresented(app);
  });

  it('goes to it from a link while the app runs when links have a parent page', async () => {
    const app = await tabApp({ linkParent: true });
    await app.deliver(URL);
    assertPresented(app);
  });

  it('goes to it from navigateByUrl', async () => {
    const app = await tabApp();
    assert.equal(await app.router.navigateByUrl(URL), true);
    assertPresented(app);
  });

  it('goes to it from navigateByUrl with a tree', async () => {
    const app = await tabApp();
    assert.equal(await app.router.navigateByUrl(app.router.parseUrl(URL)), true);
    assertPresented(app);
  });

  it('goes to it from navigate with the presented outlet', async () => {
    const app = await tabApp();
    const done = await app.router.navigate([{ outlets: { presented: ['library', '7'] } }]);
    assert.equal(done, true);
    assertPresented(app);
  });

  it('goes to it from a push of the whole url', async () => {
    const app = await tabApp();
    assert.equal(await app.navigation.push(URL), true);
    assertPresented(app);
  });

  it('goes to it when asked twice at once, the second superseding the first', async () => {
    const app = await tabApp();
    const first = app.router.navigateByUrl(URL);
    const second = app.router.navigateByUrl(URL);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assertPresented(app);
  });

  it('goes to it when asked again while the first is still making its copy', async () => {
    // The second navigation reaches the route that makes copies while the first is still in it,
    // and finds the copy made by the time it looks.
    const app = await tabApp({ routes: slowLibrary() });
    const first = app.router.navigateByUrl(URL);
    await wait(10);
    const second = app.router.navigateByUrl(URL);
    assert.equal(await first, false);
    assert.equal(await second, true);
    await settled();
    assertPresented(app);
  });

  it('goes to another page asked for while the first was making its copy', async () => {
    // The first finishes its copy after the second started and before the second looks for one.
    const slowRoot: Route = {
      path: 'slow',
      loadChildren: () =>
        wait(40).then(() => [{ path: '', component: tabs['Home'] as Type<unknown> }]),
    };
    const app = await tabApp({ routes: [slowRoot, ...slowLibrary()] });
    const first = app.router.navigateByUrl(URL);
    await wait(10);
    const url = '/slow(presented:search/jazz)';
    const second = app.router.navigateByUrl(url);
    assert.equal(await first, false);
    assert.equal(await second, true);
    assert.deepEqual(app.errors, []);
    assert.equal(app.router.url, url);
  });

  it('keeps an escaped segment one segment', async () => {
    const app = await tabApp();
    const url = '/home(presented:library/AC%2FDC)';
    assert.equal(await app.router.navigateByUrl(url), true);
    assertPresented(app, url, 'AC/DC');
  });

  it('keeps the navigation state it was asked with', async () => {
    const app = await tabApp();
    await app.router.navigateByUrl(URL, { state: { from: 'test' } });
    assertPresented(app);
    assert.equal(app.router.lastSuccessfulNavigation()?.extras.state?.['from'], 'test');
  });

  it('goes to a page of a lazily loaded route', async () => {
    const app = await tabApp();
    const url = '/home(presented:search/saved/jazz)';
    assert.equal(await app.router.navigateByUrl(url), true);
    assert.deepEqual(app.errors, []);
    assert.equal(app.router.url, url);
  });

  it('goes to it again after the routes are reset', async () => {
    const app = await tabApp();
    assert.equal(await app.router.navigateByUrl(URL), true);
    await app.router.navigateByUrl('/home');
    app.router.resetConfig(tabs['routes'] as Routes);
    assert.equal(await app.router.navigateByUrl(URL), true);
    assertPresented(app);
  });

  it('goes to it after the routes read back from the router are reset with them', async () => {
    const app = await tabApp();
    app.router.resetConfig([...app.router.config]);
    assert.equal(await app.router.navigateByUrl(URL), true);
    assertPresented(app);
    const last = app.router.config.filter((route) => route.outlet === 'presented').at(-1);
    assert.equal(last?.path, '**', 'one route makes the copies, after them');
    assert.equal(app.router.config.filter((route) => route.path === '**').length, 1);
  });

  it('shows it as a modal, as a url with no presentation of its own is', async () => {
    const app = await tabApp();
    await app.router.navigateByUrl(URL);
    const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
      nodes.flatMap((node) => [node, ...all(node.children)]);
    const screens = all(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
    assert.equal(screens.at(-1)!.props['stackPresentation'], 'modal');
    assert.match(JSON.stringify(screens.at(-1)), /"text":"album"/);
  });

  it('still fails as Angular does for a url with no such page', async () => {
    const app = await tabApp();
    await assert.rejects(
      app.router.navigateByUrl('/home(presented:nowhere/7)'),
      /NG04002: Cannot match any routes\. URL Segment: 'nowhere\/7'/,
    );
    assert.equal(app.router.url, '/home');
  });

  it('still fails as Angular does for a path below a page', async () => {
    const app = await tabApp();
    assert.equal(await app.router.navigateByUrl(URL), true);
    await assert.rejects(
      app.router.navigateByUrl('/home(presented:library/7/tracks)'),
      /NG04002: Cannot match any routes\. URL Segment: 'library\/7\/tracks'/,
    );
  });

  it('fails, after one more try, for a page whose route there does not take the url', async () => {
    // The app's own route in the outlet, at the page's path, stands where its copy would.
    const refuses: Route = {
      path: 'library/:id',
      outlet: 'presented',
      canMatch: [() => false],
      component: tabs['Album'] as Type<unknown>,
    };
    // A failed navigation resolves false: Angular would also reject the promise of the navigation
    // the try again starts, which nothing can catch.
    const app = await tabApp({
      routes: [...(tabs['routes'] as Routes), refuses],
      features: [withRouterConfig({ resolveNavigationPromiseOnError: true })],
    });
    const starts: number[] = [];
    const failed: unknown[] = [];
    app.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) starts.push(event.id);
      if (event instanceof NavigationError) failed.push(event.error);
    });
    assert.equal(await app.router.navigateByUrl(URL), false);
    assert.equal(failed.length, 1);
    assert.match(String(failed[0]), /NG04002: Cannot match any routes\. URL Segment: 'library\/7'/);
    assert.equal(starts.length, 2, 'the navigation, and the one try again');
  });
});
