import { Router, type Routes } from '@angular/router';
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
import { ROUTES } from './pages/index.page.ts';
import { appConfig } from './app.config.ts';

// The same pages, found by Vite rather than by Metro's require.context. The ngNative() plugin makes
// each .md file the module Metro makes of it.
vi.mock('./pages.ts', () => ({
  pages: import.meta.glob(['./pages/**/*.page.ts', './pages/**/*.md']),
}));

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const nodes = (fabric: FakeFabric, viewName: string) =>
  flatten(fabric.committed).filter((node) => node.viewName === viewName);

/** The title of each header, bottom of the stack first. */
const titles = (fabric: FakeFabric) =>
  nodes(fabric, 'RNSScreenStackHeaderConfig').map((node) => node.props['title']);

/** Queries over the screen on top, which is what the person sees. */
const front = (fabric: FakeFabric) => within(nodes(fabric, 'RNSScreen').at(-1)!);

async function start(open = vi.fn()) {
  const deepLinks = { initialUrl: () => null, subscribe: () => () => {}, open };
  const { componentRef, fabric } = await render(App, {
    providers: [...appConfig.providers, { provide: DeepLinks, useValue: deepLinks }],
  });
  await waitFor(() => expect(titles(fabric)).toEqual(['Native Pages']));
  await screen.findByText('Welcome');
  return { fabric, router: componentRef.injector.get(Router), open };
}

async function openRow(fabric: FakeFabric, router: Router, name: string, url: string) {
  await userEvent.press(front(fabric).getByRole('button', { name }));
  await waitFor(() => expect(router.url).toBe(url));
}

afterEach(() => cleanup());

test('the library lists each .md file by the title and summary in its front matter', async () => {
  const { fabric } = await start();

  expect(
    front(fabric)
      .getAllByRole('button')
      .map((row) => row.props['accessibilityLabel']),
  ).toEqual([
    'Welcome',
    'A tour of the formatting',
    'Live editor',
    'Styled with classes',
    'A Markdown page',
  ]);
  expect(front(fabric).getByText('What this reader is, and where to go next.')).toBeTruthy();
});

test('the home screen shows each file in pages/ with the route fileRoutes made of it', async () => {
  const { fabric, router } = await start();

  const urls = (routes: Routes, base: string): string[] =>
    routes.flatMap((route) => {
      const url = [base, route.path].filter(Boolean).join('/');
      return route.children ? urls(route.children, url) : [`/${url}`];
    });
  const made = urls(router.config, '').sort();
  expect(ROUTES.map((route) => route.url).sort()).toEqual(made);
  for (const route of ROUTES) {
    expect(front(fabric).getByText(route.file)).toBeTruthy();
  }
  expect(front(fabric).getByText('notes/[slug].page.ts → /notes/welcome')).toBeTruthy();
});

test('a note is drawn from the tokens Metro lexed, and its relative links are routed', async () => {
  const { fabric, router } = await start();
  await openRow(fabric, router, 'Welcome', '/notes/welcome');

  await waitFor(() =>
    expect(front(fabric).getByRole('header', { name: 'A reader for Markdown files' })).toBeTruthy(),
  );
  expect(titles(fabric)).toEqual(['Native Pages', 'Welcome']);

  await fireEvent.press(front(fabric).getByRole('link', { name: 'the formatting tour' }));

  await waitFor(() => expect(router.url).toBe('/notes/formatting'));
  await waitFor(() => expect(titles(fabric).at(-1)).toBe('A tour of the formatting'));
  expect(front(fabric).getByRole('header', { name: 'Table' })).toBeTruthy();
  expect(nodes(fabric, 'Image').at(-1)?.props['accessibilityLabel']).toBe('The Angular logo');
});

test('a link to another site is opened outside the app', async () => {
  const { fabric, router, open } = await start();
  await openRow(fabric, router, 'Welcome', '/notes/welcome');

  await fireEvent.press(await front(fabric).findByRole('link', { name: 'Angular' }));

  expect(open).toHaveBeenCalledWith('https://angular.dev');
  expect(router.url).toBe('/notes/welcome');
});

test('the live editor parses what is typed, through [source]', async () => {
  const { fabric, router } = await start();
  await openRow(fabric, router, 'Live editor', '/editor');

  expect(await front(fabric).findByRole('header', { name: 'Try it' })).toBeTruthy();

  await userEvent.type(front(fabric).getByLabelText('Markdown source'), '\n# Typed on the device');

  await waitFor(() =>
    expect(front(fabric).getByRole('header', { name: 'Typed on the device' })).toBeTruthy(),
  );
});

test("the styled note's elements take the app's classes, and a link keeps its default", async () => {
  const { fabric, router } = await start();
  await openRow(fabric, router, 'Styled with classes', '/styled');

  const heading = await front(fabric).findByRole('header', { name: 'An evening edition' });
  expect(heading.props['fontFamily']).toBe('Georgia');
  expect(heading.props['fontSize']).toBe(32);

  const link = front(fabric).getByRole('link', { name: 'link' });
  expect(link.props['fontWeight']).toBe('700');
  expect(link.props['textDecorationLine']).toBe('underline');
});

test('a .md file in pages/ is a screen, titled by its front matter, and its links are routed', async () => {
  const { fabric, router } = await start();
  await openRow(fabric, router, 'A Markdown page', '/about');

  await waitFor(() =>
    expect(front(fabric).getByRole('header', { name: 'Routed by its file name' })).toBeTruthy(),
  );
  expect(titles(fabric)).toEqual(['Native Pages', 'About this reader']);

  await fireEvent.press(front(fabric).getByRole('link', { name: 'a note' }));

  await waitFor(() => expect(router.url).toBe('/notes/welcome'));
  await waitFor(() => expect(titles(fabric).at(-1)).toBe('Welcome'));
});
