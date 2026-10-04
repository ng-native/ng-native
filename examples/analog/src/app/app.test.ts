import { Router } from '@angular/router';
import { DeepLinks } from '@ng-native/device';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './app.ts';
import { appConfig } from './app.config.ts';

// The same pages, found by Vite rather than by Metro's require.context.
vi.mock('./pages.ts', () => ({ pages: import.meta.glob('./pages/**/*.page.ts') }));

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const nodes = (fabric: FakeFabric, viewName: string) =>
  flatten(fabric.committed).filter((node) => node.viewName === viewName);

/** The title of each header, bottom of the stack first. */
const titles = (fabric: FakeFabric) =>
  nodes(fabric, 'RNSScreenStackHeaderConfig').map((node) => node.props['title']);

/** Queries over the screen on top, which is what the person sees. */
const front = (fabric: FakeFabric) => within(nodes(fabric, 'RNSScreen').at(-1)!);

/** The key of the tab the tab bar shows. */
const selectedTab = (fabric: FakeFabric) =>
  (nodes(fabric, 'RNSTabsHostIOS')[0]!.props['navStateRequest'] as { selectedScreenKey: string })
    .selectedScreenKey;

/** The value a feature page shows under its label. */
function shown(fabric: FakeFabric, label: string): string[] {
  const card = front(fabric).getByText(label).parent!;
  return flatten(card.children.slice(1))
    .map((node) => node.props['text'])
    .filter((text): text is string => typeof text === 'string');
}

async function start() {
  const { componentRef, fabric } = await render(App, appConfig);
  await screen.findByText('Analog Showroom', { exact: false });
  return { fabric, router: componentRef.injector.get(Router) };
}

/** Starts the app the way a link that launched it would. */
async function launch(url: string) {
  const { componentRef, fabric } = await render(App, {
    providers: [
      ...appConfig.providers,
      { provide: DeepLinks, useValue: { initialUrl: () => url, subscribe: () => () => {} } },
    ],
  });
  const router = componentRef.injector.get(Router);
  await waitFor(() => expect(router.url).toBe(url));
  return { fabric, router };
}

/** Opens a feature from the home page, and waits for its page. */
async function openFeature(fabric: FakeFabric, router: Router, name: string, url: string) {
  await userEvent.press(screen.getByRole('button', { name }));
  await waitFor(() => expect(router.url).toBe(url));
  await waitFor(() => expect(front(fabric).getAllByText(/^src\/app\/pages\//)).toHaveLength(1));
}

afterEach(() => cleanup());

test('home shows the Analog logo and a row for every feature', async () => {
  const { fabric, router } = await start();

  expect(router.url).toBe('/');
  expect(titles(fabric)).toEqual(['Analog Showroom']);
  const logo = nodes(fabric, 'RNSVGSvgView')[0]!;
  expect(logo.props['vbWidth']).toBe(273);
  expect(flatten([logo]).filter((node) => node.viewName === 'RNSVGPath')).toHaveLength(4);
  expect(screen.getAllByRole('button')).toHaveLength(12);
});

test('a static page is at the URL its file name gives it', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Static page', '/about');

  expect(front(fabric).getByText('src/app/pages/about.page.ts')).toBeTruthy();
  expect(titles(fabric)).toEqual(['Analog Showroom', 'About']);
});

test('a dynamic parameter reaches the page from the file name', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Dynamic parameter', '/products/tide-kettle');

  expect(shown(fabric, 'productId')).toEqual(['tide-kettle']);
  expect(front(fabric).getByText('Tide kettle')).toBeTruthy();
});

test('a layout holds its pages on a stack of its own, in a sheet', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Nested layout', '/products');

  expect(nodes(fabric, 'RNSScreen')[1]?.props['stackPresentation']).toBe('formSheet');
  expect(nodes(fabric, 'RNSScreenStack')).toHaveLength(2);

  await userEvent.press(front(fabric).getByRole('button', { name: 'Drift chair' }));

  await waitFor(() => expect(router.url).toBe('/products/drift-chair'));
  expect(titles(fabric)).toEqual(['Analog Showroom', 'Products', 'Product']);
  expect(shown(fabric, 'productId')).toEqual(['drift-chair']);
  expect(front(fabric).getByText('Drift chair')).toBeTruthy();

  await userEvent.press(front(fabric).getByRole('button', { name: 'Done' }));

  await waitFor(() => expect(router.url).toBe('/'));
  await waitFor(() => expect(nodes(fabric, 'RNSScreenStack')).toHaveLength(1));
});

test('the products sheet closes with Done on its list', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Nested layout', '/products');
  await userEvent.press(front(fabric).getByRole('button', { name: 'Done' }));

  await waitFor(() => expect(router.url).toBe('/'));
  await waitFor(() => expect(nodes(fabric, 'RNSScreenStack')).toHaveLength(1));
});

test('a product a link launched the app on closes with Done', async () => {
  const { fabric, router } = await launch('/products/aurora-lamp');

  await waitFor(() => expect(shown(fabric, 'productId')).toEqual(['aurora-lamp']));
  expect(front(fabric).getByText('Aurora lamp')).toBeTruthy();

  await userEvent.press(front(fabric).getByRole('button', { name: 'Done' }));

  await waitFor(() => expect(router.url).toBe('/'));
  await waitFor(() => expect(titles(fabric)).toEqual(['Analog Showroom']));
});

test('a catch-all page catches every segment after /docs', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Catch-all', '/docs/getting-started/install');

  expect(shown(fabric, 'CAUGHT SEGMENTS')).toEqual(['getting-started', 'install']);

  await userEvent.press(front(fabric).getByRole('button', { name: '/docs/guides/layouts/nested' }));

  await waitFor(() => expect(router.url).toBe('/docs/guides/layouts/nested'));
  await waitFor(() =>
    expect(shown(fabric, 'CAUGHT SEGMENTS')).toEqual(['guides', 'layouts', 'nested']),
  );
});

test('the pages of a route group are at URLs without the group in them', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Route group', '/profile');

  expect(shown(fabric, 'URL')).toEqual(['/profile']);

  await userEvent.press(front(fabric).getByRole('button', { name: 'Settings' }));

  await waitFor(() => expect(router.url).toBe('/settings'));
  expect(shown(fabric, 'URL')).toEqual(['/settings']);
});

test('routeMeta.title is the native header title', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Title', '/titled');

  expect(titles(fabric)).toEqual(['Analog Showroom', 'Titled by routeMeta']);
  expect(shown(fabric, 'ROUTEMETA.TITLE')).toEqual(['Titled by routeMeta']);
});

test('routeMeta.redirectTo sends an old link home', async () => {
  const { router } = await start();

  await router.navigateByUrl('/about');
  await router.navigateByUrl('/old-home');

  expect(router.url).toBe('/');
});

test('routeMeta.canActivate lets the admin page in only while Admin access is on', async () => {
  const { fabric, router } = await start();
  expect(screen.getByText('Blocked')).toBeTruthy();

  expect(await router.navigateByUrl('/admin')).toBe(false);

  expect(router.url).toBe('/');
  expect(screen.queryByText('Let in')).toBeNull();

  await router.navigateByUrl('/settings');
  await fireEvent(await screen.findByRole('switch', { name: 'Admin access' }), 'change', {
    value: true,
  });
  expect(await router.navigateByUrl('/admin')).toBe(true);

  expect(router.url).toBe('/admin');
  expect(await screen.findByText('Let in')).toBeTruthy();
  expect(titles(fabric).at(-1)).toBe('Admin');

  await router.navigateByUrl('/settings');
  await fireEvent(await screen.findByRole('switch', { name: 'Admin access' }), 'change', {
    value: false,
  });
  expect(await router.navigateByUrl('/admin')).toBe(false);
  expect(router.url).toBe('/settings');
});

test('routeMeta.resolve loads the data before the page shows', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Resolver', '/resolved');

  expect(shown(fabric, 'RESOLVED RELEASE')).toEqual(['2.8.0']);
  expect(front(fabric).getByText('Layouts on a native stack')).toBeTruthy();
});

test('a page loads when it is first opened', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Lazy loading', '/lazy');

  expect(shown(fabric, 'LOADED')).toEqual(['On first open']);
});

test('a page reads its query parameters, and follows them as they change', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Query parameters', '/search?q=signals');

  expect(shown(fabric, 'Q')).toEqual(['signals']);

  await userEvent.press(front(fabric).getByRole('button', { name: 'Search for layouts' }));

  await waitFor(() => expect(router.url).toBe('/search?q=layouts'));
  await waitFor(() => expect(shown(fabric, 'Q')).toEqual(['layouts']));
});

test('a tab layout keeps each tab as it was left while the other is in front', async () => {
  const { fabric, router } = await start();

  await openFeature(fabric, router, 'Tabs', '/tabs');

  expect(nodes(fabric, 'RNSTabsScreenIOS')).toHaveLength(2);
  expect(titles(fabric)).toEqual(['Analog Showroom', 'Tabs']);
  expect(selectedTab(fabric)).toBe('');
  await userEvent.press(screen.getByRole('button', { name: 'Add to COUNTER' }));
  await userEvent.press(screen.getByRole('button', { name: 'Add to COUNTER' }));
  await waitFor(() => expect(shown(fabric, 'COUNTER')).toEqual(['2']));

  await router.navigateByUrl('/tabs/laps');

  await waitFor(() => expect(selectedTab(fabric)).toBe('laps'));
  await userEvent.press(await screen.findByRole('button', { name: 'Add to LAPS' }));
  await waitFor(() => expect(shown(fabric, 'LAPS')).toEqual(['1']));

  await router.navigateByUrl('/tabs');

  await waitFor(() => expect(selectedTab(fabric)).toBe(''));
  expect(router.url).toBe('/tabs');
  expect(shown(fabric, 'COUNTER')).toEqual(['2']);
  expect(shown(fabric, 'LAPS')).toEqual(['1']);
});
