import { provideNativeRouter } from '@ng-native/router';
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
import { FeedBackend } from './feed-backend.ts';
import { FeedGallery } from './feed-post.ts';
import { FeedPage } from './feed.ts';
import { FeedStore } from './feed-store.ts';

const VIEWPORT = 800;

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

async function boot() {
  const backend = new FeedBackend();
  backend.latency = 0;
  const rendered = await render(FeedPage, {
    providers: [provideNativeRouter([]), { provide: FeedBackend, useValue: backend }],
  });
  const fabric = rendered.fabric;
  const store = rendered.componentRef.injector.get(FeedStore);
  const list = () => fabric.find('ScrollView')!;
  await waitFor(() => expect(list()).toBeTruthy());
  await fireEvent(list(), 'layout', { layout: { width: 400, height: VIEWPORT } });
  const scroll = (y: number) => fireEvent.scroll(list(), { contentOffset: { y } });
  const texts = () =>
    flatten(fabric.committed)
      .map((node) => node.props['text'])
      .filter((text): text is string => typeof text === 'string');
  /** The post ids currently rendered, in order. */
  const shown = () => texts().filter((text) => /^p\d+$/.test(text));
  return { ...rendered, backend, store, fabric, list, scroll, shown, texts };
}

const scrolls = (fabric: FakeFabric) =>
  fabric.commands.filter(
    (command) => command.name === 'scrollTo' && command.viewName === 'ScrollView',
  );

describe('feed', () => {
  test('shows the first page of posts', async () => {
    const { shown, store } = await boot();
    expect(store.posts()).toHaveLength(25);
    expect(shown()[0]).toBe('p100000');
  });

  test('loads each page once, however many scroll events reach the end', async () => {
    const { store, scroll, backend } = await boot();
    backend.latency = 30;
    const end = store.posts().length * 300;
    for (let i = 0; i < 20; i++) void scroll(end - i);
    await settle();
    await waitFor(() => expect(store.pageState()).toBe('idle'));
    expect(store.pageRequests).toBe(2);
    expect(store.posts()).toHaveLength(50);
  });

  test('offers a retry when a page fails, and loads the page when asked', async () => {
    const { store, backend, scroll } = await boot();
    backend.failNext = true;
    await scroll(store.posts().length * 300);
    await waitFor(() => expect(store.pageState()).toBe('failed'));
    await userEvent.press(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(store.posts()).toHaveLength(50));
  });

  test('likes at once, and rolls a like back when the server refuses it', async () => {
    const { store, backend } = await boot();
    const post = store.posts()[0]!;
    backend.failNext = true;
    // The server answers when the test says so. On a timer, a tap that took longer to settle than
    // the latency, as one does on a busy machine, found the like already rolled back.
    const setLiked = backend.setLiked.bind(backend);
    let answer = (): void => undefined;
    backend.setLiked = (id, liked) =>
      new Promise((resolve, reject) => {
        answer = () => void setLiked(id, liked).then(resolve, reject);
      });
    await userEvent.press(screen.getByRole('button', { name: `Like, ${post.likes} likes` }));
    expect(store.posts()[0]!.liked).toBe(true);
    answer();
    await waitFor(() => expect(store.posts()[0]!.liked).toBe(false));
    expect(store.posts()[0]!.likes).toBe(post.likes);
    expect(screen.getByText('Could not like the post')).toBeTruthy();
  });

  test('does not roll back a like that a later tap superseded', async () => {
    const { store, backend } = await boot();
    const id = store.posts()[0]!.id;
    backend.latency = 20;
    backend.failNext = true;
    store.toggleLike(id); // fails, late
    store.toggleLike(id); // succeeds: unliked again
    store.toggleLike(id); // succeeds: liked
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(store.posts()[0]!.liked).toBe(true);
    expect(store.notice()).toBeNull();
  });

  test('keeps a liked post liked when its row is recycled and it comes back', async () => {
    const { store, scroll, texts } = await boot();
    store.toggleLike(store.posts()[1]!.id);
    await settle();
    await scroll(20 * 300);
    await scroll(0);
    const liked = store.posts()[1]!;
    expect(texts()).toContain(`Liked ${liked.likes}`);
    // And no other post picked up the like from the recycled row.
    expect(texts().filter((text) => text.startsWith('Liked'))).toHaveLength(1);
  });

  test('holds the post being read when new posts arrive, and offers them', async () => {
    const { store, scroll, fabric } = await boot();
    await scroll(3000);
    const before = scrolls(fabric).length;
    await userEvent.press(screen.getByRole('button', { name: '3 new' }));
    await waitFor(() => expect(store.posts()).toHaveLength(28));
    const corrections = scrolls(fabric).slice(before);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.args[1]).toBeGreaterThan(3000);
    expect(screen.getByRole('button', { name: '3 new posts' })).toBeTruthy();
  });

  test('shows new posts in place when the feed is at its top', async () => {
    const { store, shown } = await boot();
    await userEvent.press(screen.getByRole('button', { name: '3 new' }));
    await waitFor(() => expect(store.posts()).toHaveLength(28));
    expect(shown()[0]).toBe('p100003');
    expect(screen.queryByRole('button', { name: /new posts/ })).toBeNull();
  });

  test('changes only the liked post when a like lands', async () => {
    const { store, fabric } = await boot();
    fabric.reset();
    store.toggleLike(store.posts()[2]!.id);
    await settle();
    // The like label's text, its pressable's accessibility, and the ancestors they sit in.
    expect(fabric.calls.createNode).toBe(0);
    expect(fabric.calls.cloneWithProps).toBeLessThanOrEqual(3);
  });

  test('reuses the views of a row of the same kind as it scrolls', async () => {
    const { store, scroll, fabric } = await boot();
    await store.loadMany(200);
    await scroll(2000);
    fabric.reset();
    for (let y = 2000; y < 30000; y += 250) await scroll(y);
    // About a hundred posts pass through the window; a row torn down and rebuilt for each would
    // be twenty-odd nodes apiece.
    expect(fabric.calls.createNode).toBeLessThan(250);
  });

  test('removes and edits a post in place', async () => {
    const { store, shown } = await boot();
    const [first, second] = store.posts();
    await userEvent.press(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(shown()[0]).toBe(second!.id);
    expect(store.posts().some((post) => post.id === first!.id)).toBe(false);
    await userEvent.press(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(screen.getByText(/\(edited 1\)$/)).toBeTruthy();
  });
});

describe('feed gallery', () => {
  test('goes to the page its post was left on when a recycled row is handed another post', async () => {
    const images = [0, 1, 2].map((i) => ({ uri: `image-${i}`, aspect: 1.5 }));
    const { fabric, rerender } = await render(FeedGallery, {
      inputs: { postId: 'a', images, initialPage: 0 },
    });
    const frame = flatten(fabric.committed).find((node) =>
      node.children.some((c) => c.viewName === 'ScrollView'),
    )!;
    await fireEvent(frame, 'layout', { layout: { width: 300, height: 200 } });
    fabric.commands.length = 0;

    await rerender({ inputs: { postId: 'b', images, initialPage: 2 } });

    expect(fabric.commands).toEqual([
      { viewName: 'ScrollView', name: 'scrollTo', args: [600, 0, false] },
    ]);
    expect(screen.getByText('3/3')).toBeTruthy();
  });
});
