import { Router, withComponentInputBinding } from '@angular/router';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import {
  fireEvent,
  render,
  screen,
  settle,
  userEvent,
  waitFor,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';

// Lazy screen imports are compiled on first navigation under Vitest.
const asyncWait = { timeout: 10_000 };

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const visible = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) =>
    // A row the list has parked for reuse is a view kept, out of the flow and unseen.
    node.props['opacity'] === 0 && node.props['pointerEvents'] === 'none'
      ? []
      : [node, ...visible(node.children)],
  );

const scrollViews = (fabric: FakeFabric) =>
  flatten(fabric.committed).filter((node) => node.viewName === 'ScrollView');

/** The shelf rows on screen, by shelf id, with their horizontal list. */
function shelfLists(fabric: FakeFabric): Map<string, FakeFabricNode> {
  const found = new Map<string, FakeFabricNode>();
  for (const node of visible(fabric.committed)) {
    const id = node.props['nativeID'];
    if (typeof id !== 'string' || !id.startsWith('row-shelf-')) continue;
    const list = flatten(node.children).find((n) => n.viewName === 'ScrollView');
    if (list) found.set(id.slice('row-shelf-'.length), list);
  }
  return found;
}

/** The album ids a horizontal list shows. */
const cardsOf = (list: FakeFabricNode) =>
  visible(list.children)
    .map((node) => node.props['nativeID'])
    .filter((id): id is string => typeof id === 'string' && id.startsWith('card-'))
    .map((id) => id.slice('card-'.length));

async function boot() {
  const app = await render(App, {
    providers: [provideNativeRouter(routes, withComponentInputBinding())],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  await nav.push('/browse');
  await waitFor(
    () => expect(screen.getByRole('button', { name: 'Jump to Jazz' })).toBeTruthy(),
    asyncWait,
  );
  // The page's list is the newest vertical scroll view; the home screen's is below it.
  const page = () =>
    scrollViews(app.fabric)
      .filter((n) => !n.props['horizontal'])
      .at(-1)!;
  await fireEvent(page(), 'layout', { layout: { width: 402, height: 800 } });
  for (const list of shelfLists(app.fabric).values())
    await fireEvent(list, 'layout', { layout: { width: 402, height: 170 } });
  return { ...app, nav, page, router: app.componentRef.injector.get(Router) };
}

const scrollTo = (node: FakeFabricNode, at: { x?: number; y?: number }) =>
  fireEvent(node, 'scroll', { contentOffset: { x: at.x ?? 0, y: at.y ?? 0 } });

describe('browse', () => {
  test('shelves scroll sideways as native carousels, without their own indicator', async () => {
    const { fabric } = await boot();
    const lists = shelfLists(fabric);
    expect(lists.size).toBeGreaterThan(2);
    const jazz = lists.get('g0')!;
    expect(jazz.props['horizontal']).toBe(true);
    expect(jazz.props['showsHorizontalScrollIndicator']).toBe(false);
    expect(cardsOf(jazz)[0]).toBe('g0a0');
  });

  test('a shelf scrolled sideways shows its later albums', async () => {
    const { fabric } = await boot();
    await scrollTo(shelfLists(fabric).get('g0')!, { x: 132 * 20 });
    await settle();
    expect(cardsOf(shelfLists(fabric).get('g0')!)).toContain('g0a21');
  });

  test('a shelf recycled into another row starts where that shelf was left', async () => {
    const { fabric, page } = await boot();
    await scrollTo(shelfLists(fabric).get('g0')!, { x: 132 * 10 });
    await settle();
    // Far enough down that the Jazz shelf's row is recycled into a later one.
    const before = fabric.commands.length;
    await scrollTo(page(), { y: 214 * 12 });
    await settle();
    const lists = shelfLists(fabric);
    expect(lists.has('g0')).toBe(false);
    // A newly arrived shelf is put at its own position, the start, not at Jazz's.
    const moves = fabric.commands.slice(before).filter((c) => c.name === 'scrollTo');
    const arrived = [...lists].filter(([, list]) =>
      moves.some((c) => c.node?.reactTag === list.reactTag),
    );
    expect(arrived.length).toBeGreaterThan(0);
    for (const [id, list] of arrived) {
      const last = moves.filter((c) => c.node?.reactTag === list.reactTag).at(-1)!;
      expect(last.args[0], id).toBe(0);
    }
    // And coming back puts Jazz where it was.
    const back = fabric.commands.length;
    await scrollTo(page(), { y: 0 });
    await settle();
    const jazz = shelfLists(fabric).get('g0')!;
    const restored = fabric.commands
      .slice(back)
      .filter((c) => c.name === 'scrollTo' && c.node?.reactTag === jazz.reactTag)
      .at(-1);
    expect(restored?.args[0]).toBe(132 * 10);
  });

  test('pins the heading of the genre being scrolled past', async () => {
    const { fabric, page } = await boot();
    await scrollTo(page(), { y: 214 * 3 + 60 });
    await settle();
    const pinned = visible(fabric.committed).filter(
      (node) =>
        typeof node.props['nativeID'] === 'string' &&
        (node.props['nativeID'] as string).startsWith('row-heading-') &&
        node.props['zIndex'] === 1,
    );
    expect(pinned.map((node) => node.props['nativeID'])).toEqual(['row-heading-g3']);
  });

  test('jumps to a genre, and back to the top', async () => {
    const { fabric, page } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'Jump to Vocal' }));
    const pageMoves = () =>
      fabric.commands.filter((c) => c.name === 'scrollTo' && c.node?.reactTag === page().reactTag);
    const jump = pageMoves().at(-1)!;
    expect(jump.args[1]).toBeGreaterThan(0);
    await scrollTo(page(), { y: jump.args[1] as number });
    await settle();
    expect(screen.getAllByText('Vocal').length).toBeGreaterThan(0);
    await userEvent.press(await screen.findByRole('button', { name: 'Top' }, asyncWait));
    expect(pageMoves().at(-1)!.args[1]).toBe(0);
  });

  test('shows the Top button only once far down', async () => {
    const { page } = await boot();
    expect(screen.queryByRole('button', { name: 'Top' })).toBeNull();
    await scrollTo(page(), { y: 2000 });
    await settle();
    expect(screen.getByRole('button', { name: 'Top' })).toBeTruthy();
    await scrollTo(page(), { y: 100 });
    await settle();
    expect(screen.queryByRole('button', { name: 'Top' })).toBeNull();
  });

  test('refreshes the shelves and keeps each one where it was', async () => {
    const { fabric } = await boot();
    await scrollTo(shelfLists(fabric).get('g1')!, { x: 400 });
    await settle();
    const refresh = flatten(fabric.committed).find((n) => n.viewName === 'PullToRefreshView');
    expect(refresh, 'the list has a refresh control').toBeTruthy();
    await fireEvent(refresh!, 'refresh', {});
    await new Promise((resolve) => setTimeout(resolve, 700));
    await settle();
    expect(screen.getAllByText('Jazz 1 (1)').length).toBeGreaterThan(0);
    const soul = shelfLists(fabric).get('g1')!;
    const moves = fabric.commands.filter(
      (c) => c.name === 'scrollTo' && c.node?.reactTag === soul.reactTag,
    );
    expect(moves.at(-1)?.args[0]).toBe(400);
  });

  test('opens an album and comes back to the shelves as they were', async () => {
    const { nav, router, fabric } = await boot();
    await userEvent.press(screen.getByRole('button', { name: 'Jazz 1' }));
    await waitFor(() => expect(router.url).toBe('/search-demo/g0a0'), asyncWait);
    nav.back();
    for (let turn = 0; turn < 6; turn++) await settle();
    expect(router.url).toBe('/browse');
    expect(cardsOf(shelfLists(fabric).get('g0')!)[0]).toBe('g0a0');
  });
});
