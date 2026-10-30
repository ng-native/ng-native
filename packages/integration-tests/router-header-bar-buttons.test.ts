/**
 * `<native-header-item>` as a native bar button: an item at the left or the right with a symbol or
 * a title and nothing written in it commits as an entry in the header config's
 * `headerLeftBarButtonItems` or `headerRightBarButtonItems`, as react-native-screens'
 * `HeaderBarButtonItem`, rather than as a custom view. What is pinned is what
 * `RNSScreenStackHeaderConfig.mm` and `RNSBarButtonItem.mm` read: the entry's keys, its `index`
 * among the side's items, and the `buttonId` a tap sends back.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type, WritableSignal } from '@angular/core';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, fireEvent, render, type FakeFabric } from '@ng-native/testing';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

interface Moved {
  readonly leading: WritableSignal<readonly string[]>;
  readonly trailing: WritableSignal<readonly string[]>;
  readonly label: WritableSignal<string>;
}

interface Host {
  readonly filtering: WritableSignal<boolean>;
  readonly shared: WritableSignal<boolean>;
  readonly saving: WritableSignal<boolean>;
  readonly saveHidden: WritableSignal<boolean>;
  readonly saveTitle: WritableSignal<string | undefined>;
  readonly starred: WritableSignal<boolean>;
  readonly tint: WritableSignal<string | undefined>;
  closed: number;
  edited: number;
  filtered: number;
  saved: number;
}

type Entry = Record<string, unknown>;

describe('native header bar buttons', () => {
  let HostType: Type<Host>;
  let MovedType: Type<Moved>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/header-item.ts');
    HostType = mod['HeaderBarButtonsHost'] as Type<Host>;
    MovedType = mod['HeaderMovedButtons'] as Type<Moved>;
  });

  afterEach(() => cleanup());

  async function boot(options: Parameters<typeof render>[1] = {}) {
    const app = await render(HostType, options);
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const left = () => config().props['headerLeftBarButtonItems'] as Entry[] | null | undefined;
    const right = () => config().props['headerRightBarButtonItems'] as Entry[] | null | undefined;
    const pass = async () => {
      await app.detectChanges();
    };
    return { ...app, instance: app.instance as Host, config, left, right, pass };
  }

  const views = (fabric: FakeFabric) =>
    fabric
      .find('RNSScreenStackHeaderConfig')!
      .children.map((child) => `${child.viewName}:${child.props['type']}`);

  it('commits a symbol item as an entry on its side, with what native reads', async () => {
    const { left } = await boot();
    assert.deepEqual(left()![0], {
      buttonId: left()![0]!['buttonId'],
      index: 0,
      sfSymbolName: 'xmark',
      accessibilityLabel: 'Close',
    });
    assert.equal(typeof (left() as Entry[])[0]!['buttonId'], 'string');
  });

  it('puts an item with no type on the left, where native puts one', async () => {
    const { left } = await boot();
    assert.deepEqual(
      left()!.map((entry) => [entry['index'], entry['sfSymbolName']]),
      [
        [0, 'xmark'],
        [1, 'gear'],
      ],
    );
  });

  it('places each entry among the custom views of its side as written', async () => {
    const { right } = await boot();
    const entries = right()!;
    assert.deepEqual(
      entries.map((entry) => [entry['index'], entry['sfSymbolName'] ?? entry['title']]),
      [
        [1, 'line.3.horizontal.decrease'],
        [2, 'Save'],
      ],
      'Edit, a view, is the first item of the right side',
    );
    const [filter, save] = entries;
    assert.equal(filter!['sharesBackground'], false);
    assert.equal(save!['variant'], 'prominent');
    assert.equal(save!['hidesSharedBackground'], true);
    assert.equal(save!['disabled'], false);
    assert.notEqual(filter!['buttonId'], save!['buttonId']);
  });

  it('commits no view for a bar button, and keeps the views with content', async () => {
    const { fabric } = await boot();
    assert.deepEqual(views(fabric), [
      'RNSScreenStackHeaderSubview:right',
      'RNSScreenStackHeaderSubview:right',
    ]);
  });

  it('still labels an item with content, a view, and not a bar button', async () => {
    const { fabric } = await boot();
    const edit = fabric.find('RNSScreenStackHeaderSubview')!;
    assert.equal(edit.props['accessibilityLabel'], 'Edit the property');
  });

  it('keeps an item with content behind an @if a view, symbol or not', async () => {
    const { fabric, instance, pass, right } = await boot();
    instance.starred.set(true);
    await pass();
    assert.equal(
      right()!.some((entry) => entry['sfSymbolName'] === 'star'),
      false,
    );
    assert.equal(views(fabric).length, 2);
  });

  it('reports a tap on an entry as a press on its item, and on no other', async () => {
    const { config, left, right, instance } = await boot();
    await fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId: left()![0]!['buttonId'] });
    assert.deepEqual([instance.closed, instance.filtered, instance.saved], [1, 0, 0]);
    await fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId: right()![1]!['buttonId'] });
    await fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId: 'someone-else' });
    assert.deepEqual([instance.closed, instance.filtered, instance.saved], [1, 0, 1]);
  });

  // A view's entry has no button, so its id reads as undefined too.
  it('takes an event with no id for no item, a view with a press included', async () => {
    const { config, instance } = await boot();
    await fireEvent(config(), 'pressHeaderBarButtonItem', {});
    assert.deepEqual([instance.closed, instance.edited, instance.saved], [0, 0, 0]);
  });

  it('commits a change to an entry, and keeps its id', async () => {
    const { instance, pass, right } = await boot();
    const id = right()![1]!['buttonId'];
    instance.saving.set(true);
    instance.saveTitle.set('Saving');
    await pass();
    assert.equal(right()![1]!['disabled'], true);
    assert.equal(right()![1]!['title'], 'Saving');
    assert.equal(right()![1]!['buttonId'], id);
  });

  // A colour inside a list is not one the engine converts by its prop's name, and native reads
  // the tint with RCTConvert, which takes the processed colour and not CSS text.
  it('turns a tint into the colour native reads', async () => {
    const { instance, pass, right } = await boot({
      processColor: (value) => ({ processed: value }),
    });
    assert.equal('tintColor' in right()![0]!, false, 'unset, the key is left out');
    instance.tint.set('red');
    await pass();
    assert.deepEqual(right()![0]!['tintColor'], { processed: 'red' });
  });

  it('leaves a hidden entry out, and the ones after it move up', async () => {
    const { instance, pass, right } = await boot();
    instance.filtering.set(false);
    await pass();
    assert.deepEqual(
      right()!.map((entry) => [entry['index'], entry['title']]),
      [[1, 'Save']],
    );
    instance.saveHidden.set(true);
    await pass();
    assert.equal(right() ?? null, null, 'with none left the list is cleared, not left as it was');
    instance.saveHidden.set(false);
    instance.filtering.set(true);
    await pass();
    assert.equal(right()!.length, 2);
  });

  it('counts a view a component of the header adds ahead of an entry', async () => {
    const { instance, pass, right } = await boot();
    instance.shared.set(true);
    await pass();
    assert.deepEqual(
      right()!.map((entry) => entry['index']),
      [1, 3],
    );
  });

  it('turns an entry back into a view once it has no symbol or title', async () => {
    const { fabric, instance, pass, right } = await boot();
    instance.saveTitle.set(undefined);
    await pass();
    assert.equal(right()!.length, 1);
    assert.equal(views(fabric).length, 3);
  });

  describe('moved by a @for', () => {
    async function bootMoved() {
      const app = await render(MovedType);
      const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
      const titles = (prop: string) =>
        (config().props[prop] as Entry[]).map((entry) => [entry['index'], entry['title']]);
      return { ...app, instance: app.instance as Moved, config, titles };
    }

    it('follows a move in the template the header is written in', async () => {
      const { instance, detectChanges, titles } = await bootMoved();
      instance.leading.set(['Two', 'One']);
      await detectChanges();
      assert.deepEqual(titles('headerLeftBarButtonItems'), [
        [0, 'Two'],
        [1, 'One'],
      ]);
    });

    it('follows a move inside a component of the header, which refreshes after it', async () => {
      const { instance, detectChanges, titles } = await bootMoved();
      instance.trailing.set(['Four', 'Three']);
      await detectChanges();
      assert.deepEqual(titles('headerRightBarButtonItems'), [
        [0, 'Four'],
        [1, 'Three'],
      ]);
    });

    // A new list is a new prop, and native builds the bar's items again from it.
    it('keeps the same list through a pass that moved nothing', async () => {
      const { instance, detectChanges, config } = await bootMoved();
      const list = config().props['headerRightBarButtonItems'];
      instance.label.set('Changed');
      await detectChanges();
      assert.equal(config().props['headerRightBarButtonItems'], list);
    });
  });

  it('says on Android, once, that only iOS draws them', async () => {
    registerPlatformComponents('android');
    const warn = console.warn;
    const said: unknown[] = [];
    console.warn = (...args: unknown[]) => void said.push(args[0]);
    try {
      await boot();
      cleanup();
      await boot();
      assert.equal(said.filter((text) => String(text).includes('bar button')).length, 1);
    } finally {
      console.warn = warn;
      registerPlatformComponents('ios');
    }
  });
});
