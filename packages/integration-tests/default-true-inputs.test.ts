/**
 * A boolean input whose default is true, bound to `null` or `undefined`, reads true, as one left
 * unbound does: the usual way to bind no value is an optional field, `[enabled]="options.enabled"`.
 * `booleanAttribute` alone makes both `false`, the opposite of the default. The bottom sheet's
 * `showDragIndicator` is pinned in expo-ui-bottom-sheet.test.ts.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { cleanup, render, type FakeFabricNode } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

interface Host {
  readonly on: WritableSignal<boolean | null | undefined>;
  provider(): { reportInsets(): boolean };
  avoiding(): { enabled(): boolean };
  pressable(): { cancelable(): boolean };
  segment(): { enabled(): boolean };
  item(): { enabled(): boolean };
}

const inputs = [
  {
    name: '[reportInsets] on <safe-area-provider>',
    read: (h: Host) => h.provider().reportInsets(),
  },
  { name: '[enabled] on <keyboard-avoiding-view>', read: (h: Host) => h.avoiding().enabled() },
  { name: '[cancelable] on <pressable>', read: (h: Host) => h.pressable().cancelable() },
  {
    name: '[enabled] on <ui-segmented-button>',
    read: (h: Host) => h.segment().enabled(),
    id: 'segment',
  },
  {
    name: '[enabled] on <ui-dropdown-menu-item>',
    read: (h: Host) => h.item().enabled(),
    id: 'item',
  },
];

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

describe('a default-true boolean input', () => {
  let Fixture: Type<Host>;

  before(async () => {
    const mod = await compileFixture('fixtures/default-true-inputs.ts');
    Fixture = mod['DefaultTrueInputs'] as Type<Host>;
  });

  afterEach(() => cleanup());

  async function mount(first: boolean | null | undefined) {
    const app = await render(Fixture);
    const host = app.instance as Host;
    const set = async (value: boolean | null | undefined) => {
      host.on.set(value);
      await app.detectChanges();
    };
    await set(first);
    const committed = (id: string) =>
      all(app.fabric.committed).find((node) => node.props['nativeID'] === id)?.props['enabled'];
    return { host, set, committed };
  }

  for (const { name, read, id } of inputs) {
    describe(name, () => {
      it('reads false when bound false', async () => {
        const { host, committed } = await mount(false);
        assert.equal(read(host), false);
        if (id) assert.equal(committed(id), false);
      });

      for (const unset of [null, undefined]) {
        it(`reads true when bound ${unset} from the first pass`, async () => {
          const { host, committed } = await mount(unset);
          assert.equal(read(host), true);
          if (id)
            assert.equal(committed(id), committed('unbound'), 'committed as an unbound one is');
        });

        it(`goes back to true when a false binding turns ${unset}`, async () => {
          const { host, set, committed } = await mount(false);
          await set(unset);
          assert.equal(read(host), true);
          if (id)
            assert.equal(committed(id), committed('unbound'), 'committed as an unbound one is');
        });
      }
    });
  }
});
