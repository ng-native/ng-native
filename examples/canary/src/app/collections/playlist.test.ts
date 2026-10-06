import { LayoutAnimation } from '@ng-native/device';
import { provideNativeRouter } from '@ng-native/router';
import {
  fireEvent,
  render,
  settle,
  userEvent,
  screen,
  type FakeFabric,
  type FakeFabricNode,
} from '@ng-native/testing';
import { describe, expect, test } from 'vitest';
import { Playlist } from './playlist.ts';
import type { Track } from './playlist-model.ts';

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

const textOf = (node: FakeFabricNode): string =>
  flatten([node])
    .map((n) => n.props['text'])
    .filter((text) => typeof text === 'string')
    .join('');

/** Every visible track row: its key, its native view, and what it shows. */
function shown(fabric: FakeFabric): { key: string; tag: number; text: string }[] {
  const rows: { key: string; tag: number; text: string }[] = [];
  const walk = (nodes: readonly FakeFabricNode[]) => {
    for (const node of nodes) {
      // A row the list has parked for reuse: a view kept, out of the flow and unseen.
      if (node.props['opacity'] === 0 && node.props['pointerEvents'] === 'none') continue;
      const id = node.props['nativeID'];
      if (typeof id === 'string' && id.startsWith('row-k')) {
        rows.push({ key: id.slice(4), tag: node.reactTag, text: textOf(node) });
        continue;
      }
      walk(node.children);
    }
  };
  walk(fabric.committed);
  return rows;
}

async function boot() {
  const configured: object[] = [];
  const app = await render(Playlist, {
    providers: [
      provideNativeRouter([]),
      {
        provide: LayoutAnimation.SOURCE,
        useValue: {
          configureNext: (config: object, done?: () => void) => (configured.push(config), done?.()),
        },
      },
    ],
  });
  await fireEvent(app.fabric.find('ScrollView')!, 'layout', {
    layout: { width: 402, height: 900 },
  });
  const instance = app.instance as unknown as { tracks(): readonly Track[] };
  /** Every visible row shows the track its key names, and no key shows twice. */
  const consistent = () => {
    const byId = new Map(instance.tracks().map((track) => [track.id, track]));
    const rows = shown(app.fabric);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    for (const row of rows) expect(row.text).toContain(byId.get(row.key)!.title);
    return rows;
  };
  return { ...app, configured, instance, consistent };
}

const press = (name: string) => userEvent.press(screen.getByRole('button', { name }));

describe('queue', () => {
  test('keeps each track s view through a sort, a shuffle and a reverse', async () => {
    const { consistent } = await boot();
    // A row on screen before a change and after it keeps its view; one that left the window in
    // between was recycled, which is what a window is for.
    let before = new Map(consistent().map((row) => [row.key, row.tag]));
    for (const action of ['Sort', 'Shuffle', 'Reverse']) {
      await press(action);
      const after = consistent();
      for (const row of after) {
        if (before.has(row.key))
          expect(row.tag, `${row.key} after ${action}`).toBe(before.get(row.key));
      }
      before = new Map(after.map((row) => [row.key, row.tag]));
    }
  });

  test('moves a track to the other section, keeping its view, and recounts both', async () => {
    const { consistent, instance } = await boot();
    const first = instance.tracks()[0]!;
    const tag = consistent().find((row) => row.key === first.id)!.tag;
    await press(`Move ${first.title} to the other section`);
    expect(instance.tracks()[0]!.section).toBe('later');
    expect(screen.getByText('Up next (11)')).toBeTruthy();
    expect(screen.getByText('Later (49)')).toBeTruthy();
    const moved = consistent().find((row) => row.key === first.id);
    if (moved) expect(moved.tag).toBe(tag);
  });

  test('moves a track up within its section', async () => {
    const { instance } = await boot();
    const second = instance.tracks()[1]!;
    await press(`Move up ${second.title}`);
    expect(instance.tracks()[0]!.id).toBe(second.id);
  });

  test('inserts and deletes in a batch, showing every track as it is', async () => {
    const { consistent, instance } = await boot();
    await press('Insert 3');
    expect(instance.tracks()).toHaveLength(63);
    consistent();
    await press('Delete 10');
    expect(instance.tracks()).toHaveLength(53);
    consistent();
  });

  test('comes out of a burst of forty random changes with every row right', async () => {
    const { consistent } = await boot();
    await press('Burst');
    await new Promise((resolve) => setTimeout(resolve, 2400));
    await settle();
    consistent();
  });

  test('animates the layout of every change', async () => {
    const { configured } = await boot();
    await press('Shuffle');
    await press('Sort');
    expect(configured).toHaveLength(2);
  });

  test('filters, and shows the tracks again as they were', async () => {
    const { consistent } = await boot();
    const before = new Map(consistent().map((row) => [row.key, row.tag]));
    await userEvent.type(screen.getByLabelText('Filter'), 'naima');
    expect(consistent().every((row) => row.text.includes('Naima'))).toBe(true);
    await userEvent.clear(screen.getByLabelText('Filter'));
    const after = consistent();
    expect(after.length).toBe(before.size);
  });
});
