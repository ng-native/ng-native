import { Router, withComponentInputBinding } from '@angular/router';
import { NativeNavigation, provideNativeRouter } from '@ng-native/router';
import {
  fireEvent,
  gestureOf,
  render,
  screen,
  settle,
  userEvent,
  waitFor,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { registerExpoUiViews } from '@ng-native/expo';
import { App } from '../app.ts';
import { routes } from '../app.routes.ts';
import { INBOX_SWIPES } from './inbox.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const visible = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) =>
    // A row the list has parked for reuse is a view kept, out of the flow and unseen.
    node.props['opacity'] === 0 && node.props['pointerEvents'] === 'none'
      ? []
      : [node, ...visible(node.children)],
  );

/** Each row's front, by message id, in the order the inbox's list shows them. */
function fronts(fabric: FakeFabric): Map<string, FakeFabricNode> {
  const found = new Map<string, FakeFabricNode>();
  for (const node of visible(fabric.committed)) {
    const id = node.props['nativeID'];
    if (typeof id === 'string' && id.startsWith('front-')) found.set(id.slice(6), node);
  }
  return found;
}

const front = (fabric: FakeFabric, id: string) => fronts(fabric).get(id)!;
const offsetOf = (node: FakeFabricNode) =>
  (node.props['transform'] as { translateX: number }[] | undefined)?.[0]?.translateX ?? 0;

async function boot(swipes: 'native' | 'drawn' = 'drawn') {
  const app = await render(App, {
    providers: [
      provideNativeRouter(routes, withComponentInputBinding()),
      { provide: INBOX_SWIPES, useValue: swipes },
    ],
  });
  const injector = app.componentRef.injector;
  await injector.get(NativeNavigation).push('/inbox');
  await waitFor(() => expect(screen.getByRole('tab', { name: /^Inbox/ })).toBeTruthy());
  const scrolls = () => flatten(app.fabric.committed).filter((n) => n.viewName === 'ScrollView');
  if (swipes === 'drawn') {
    // The pager, then a list per folder; the home screen's list is below them.
    const [pager, inboxList] = scrolls().slice(-3);
    await fireEvent(pager!, 'layout', { layout: { width: 402, height: 700 } });
    await fireEvent(inboxList!, 'layout', { layout: { width: 402, height: 700 } });
  }
  const list = () => scrolls().at(-2)!;
  return { ...app, list, router: injector.get(Router) };
}

/** Drag a row's front sideways by `dx` and let go. */
async function swipe(fabric: FakeFabric, id: string, dx: number, velocityX = 0) {
  const pan = gestureOf(front(fabric, id), 'Pan');
  pan.callbacks['onChange']!({ changeX: dx } as never);
  pan.callbacks['onEnd']!({ velocityX } as never);
  await settle();
}

describe('mail', () => {
  test('a swipe all the way deletes the message', async () => {
    const { fabric } = await boot();
    expect(fronts(fabric).has('m0')).toBe(true);
    await swipe(fabric, 'm0', -300);
    expect(fronts(fabric).has('m0')).toBe(false);
    expect(screen.getByRole('tab', { name: 'Inbox (102)' })).toBeTruthy();
  });

  test('a fast flick deletes too, however short', async () => {
    const { fabric } = await boot();
    await swipe(fabric, 'm1', -60, -2000);
    expect(fronts(fabric).has('m1')).toBe(false);
  });

  test('a partial swipe opens the row on its actions, and Archive moves it', async () => {
    const { fabric } = await boot();
    await swipe(fabric, 'm2', -120);
    expect(offsetOf(front(fabric, 'm2'))).toBe(-160);
    await userEvent.press(screen.getByRole('button', { name: /^Archive Re: the release notes 2/ }));
    expect(screen.getByRole('tab', { name: 'Archive (18)' })).toBeTruthy();
  });

  test('a short swipe springs back closed', async () => {
    const { fabric } = await boot();
    await swipe(fabric, 'm2', -40);
    expect(offsetOf(front(fabric, 'm2'))).toBe(0);
  });

  test('a tap on an open row closes it instead of opening the message', async () => {
    const { fabric, router } = await boot();
    await swipe(fabric, 'm3', -120);
    gestureOf(front(fabric, 'm3'), 'Tap').callbacks['onEnd']!();
    await settle();
    expect(offsetOf(front(fabric, 'm3'))).toBe(0);
    expect(router.url).toBe('/inbox');
  });

  test('a tap opens the message', async () => {
    const { fabric, router } = await boot();
    gestureOf(front(fabric, 'm3'), 'Tap').callbacks['onEnd']!();
    await waitFor(() => expect(router.url).toBe('/search-demo/m3'));
  });

  test('a row recycled for another message arrives closed', async () => {
    const { fabric, list } = await boot();
    await swipe(fabric, 'm0', -120);
    const tag = front(fabric, 'm0').reactTag;
    await fireEvent(list(), 'scroll', { contentOffset: { x: 0, y: 84 * 40 } });
    await settle();
    const reused = [...fronts(fabric).entries()].find(([, node]) => node.reactTag === tag);
    expect(reused, 'the open row s view was reused').toBeTruthy();
    expect(reused![0]).not.toBe('m0');
    expect(offsetOf(reused![1])).toBe(0);
  });

  test('press and hold starts selecting; taps add to it; Archive moves them all', async () => {
    const { fabric } = await boot();
    gestureOf(front(fabric, 'm0'), 'LongPress').callbacks['onStart']!();
    await settle();
    expect(screen.getByText('1 selected')).toBeTruthy();
    gestureOf(front(fabric, 'm1'), 'Tap').callbacks['onEnd']!();
    await settle();
    expect(screen.getByText('2 selected')).toBeTruthy();
    await userEvent.press(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('tab', { name: 'Archive (19)' })).toBeTruthy();
  });

  test('the actions a swipe shows are there for a screen reader too', async () => {
    const { fabric } = await boot();
    await fireEvent(front(fabric, 'm4'), 'accessibilityAction', { actionName: 'delete' });
    expect(fronts(fabric).has('m4')).toBe(false);
  });

  describe('on iOS, as a SwiftUI list', () => {
    const rows = (fabric: FakeFabric) =>
      flatten(fabric.committed).filter((node) => /ExpoUI_SwipeActionsView$/.test(node.viewName));
    const button = (row: FakeFabricNode, label?: string) =>
      flatten([row]).find(
        (node) => /ExpoUI_Button$/.test(node.viewName) && node.props['label'] === label,
      )!;

    test('swipes with the system s own actions, Archive and Delete from the trailing edge', async () => {
      registerExpoUiViews('ios');
      const { fabric } = await boot('native');
      const first = rows(fabric)[0]!;
      const actions = flatten([first]).find((node) => /ExpoUI_SlotView$/.test(node.viewName))!;
      expect(actions.props['extraProps']).toEqual({ edge: 'trailing', allowsFullSwipe: true });
      expect(button(first, 'Delete').props['role']).toBe('destructive');
      expect(button(first, 'Archive')).toBeTruthy();
    });

    test('archives, deletes and opens from the row', async () => {
      registerExpoUiViews('ios');
      const { fabric, router } = await boot('native');
      fabric.emit(button(rows(fabric)[0]!, 'Archive'), 'topButtonPress');
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: /^Archive \(18\)/ })).toBeTruthy(),
      );
      expect(screen.getByRole('tab', { name: /^Inbox \(102\)/ })).toBeTruthy();
      fabric.emit(button(rows(fabric)[0]!, 'Delete'), 'topButtonPress');
      await waitFor(() => expect(screen.getByRole('tab', { name: /^Inbox \(101\)/ })).toBeTruthy());
      fabric.emit(button(rows(fabric)[0]!), 'topButtonPress');
      await waitFor(() => expect(router.url).toMatch(/^\/search-demo\//));
    });
  });
});
