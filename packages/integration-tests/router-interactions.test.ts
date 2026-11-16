/**
 * Interaction observers hear the router's native controls: a tab tapped in the native tab bar, a
 * native header bar button, and an action of a bar button's menu. Each is a `click` labelled with
 * the item's or the action's title. The navigation a tab tap starts is not an interaction, and is
 * not reported.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  settle,
  type FakeFabricNode,
} from '@ng-native/testing';
import { provideInteractionObserver, type InteractionEvent } from '@ng-native/components';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { registerScreenComponents } from '../router/src/screens.ts';
import { compileFixture } from './compile.ts';

const all = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...all(node.children)]);

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

/** Everything but the time and the tag, which change from run to run. */
const stable = ({ timestamp, nativeTag, ...rest }: InteractionEvent) => {
  assert.equal(typeof timestamp, 'number');
  return rest;
};

afterEach(() => cleanup());

describe('a control on a routed page', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/router-interactions.ts');
  });

  /** Open `url`, tap the pressable `id` on the page there, and answer what was heard. */
  async function tapOn(url: string, id: string): Promise<InteractionEvent[]> {
    const heard: InteractionEvent[] = [];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes),
        provideInteractionObserver((event) => heard.push(event)),
      ],
    });
    await idle();
    await app.componentRef.injector.get(Router).navigateByUrl(url);
    await idle();
    const point = { pageX: 1, pageY: 1, locationX: 1, locationY: 1 };
    const node = screen.getByTestId(id);
    app.fabric.emit(node, 'topTouchStart', { touches: [point], changedTouches: [point], ...point });
    app.fabric.emit(node, 'topTouchEnd', { touches: [], changedTouches: [point], ...point });
    await idle();
    return heard;
  }

  it('reports the page a native stack shows', async () => {
    const heard = await tapOn('/detail', 'detail-action');
    assert.deepEqual(
      heard.map((event) => [event.testID, event.component]),
      [['detail-action', 'x-detail']],
    );
  });

  it('reports the page a native tab shows', async () => {
    const heard = await tapOn('/home', 'home-action');
    assert.deepEqual(
      heard.map((event) => [event.testID, event.component]),
      [['home-action', 'x-home']],
    );
  });

  it('reports the name a page with no selector gives its host', async () => {
    const heard = await tapOn('/welcome', 'welcome-action');
    assert.deepEqual(
      heard.map((event) => [event.testID, event.component]),
      [['welcome-action', 'Welcome page']],
    );
  });

  it('reports no component for a page with no selector', async () => {
    const heard = await tapOn('/unnamed', 'unnamed-action');
    assert.equal(heard.length, 1);
    assert.equal('component' in heard[0]!, false);
  });
});

describe('a native tab tapped', () => {
  let mod: Record<string, unknown>;
  let provenance = 0;

  before(async () => {
    mod = await compileFixture('fixtures/router-interactions.ts');
  });

  async function boot(observe = true) {
    const heard: InteractionEvent[] = [];
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['routes'] as Routes),
        ...(observe ? [provideInteractionObserver((event) => heard.push(event))] : []),
      ],
    });
    await idle();
    const router = app.componentRef.injector.get(Router);
    const host = () => all(app.fabric.committed).find((n) => n.viewName === 'RNSTabsHostIOS')!;
    const tap = async (key: string, actionOrigin = 'user', isRepeated = false) => {
      await fireEvent(host(), 'tabSelected', {
        selectedScreenKey: key,
        provenance: ++provenance,
        actionOrigin,
        isRepeated,
      });
      await idle();
    };
    return { app, heard, router, tap };
  }

  it('is reported as a click with the tab identity and its title', async () => {
    const { heard, tap, router } = await boot();
    assert.equal(router.url, '/home');
    await tap('search');
    await tap('home');
    assert.equal(router.url, '/home');
    assert.deepEqual(heard.map(stable), [
      {
        type: 'click',
        element: 'native-tab',
        component: 'x-bar',
        label: 'Search',
        source: 'click',
      },
      {
        type: 'click',
        element: 'native-tab',
        component: 'x-bar',
        label: 'Home',
        testID: 'home-tab',
        source: 'click',
      },
    ]);
  });

  it('is reported for a tap on the tab in front, which navigates nowhere', async () => {
    const { heard, tap } = await boot();
    await tap('home', 'user', true);
    assert.deepEqual(
      heard.map((event) => event.label),
      ['Home'],
    );
  });

  it('is reported for a tap on a tab native was told not to select', async () => {
    const { app, heard } = await boot();
    const host = all(app.fabric.committed).find((n) => n.viewName === 'RNSTabsHostIOS')!;
    await fireEvent(host, 'tabSelectionPrevented', {
      preventedScreenKey: 'search',
      provenance: ++provenance,
    });
    await idle();
    assert.deepEqual(
      heard.map((event) => event.label),
      ['Search'],
    );
  });

  it('is not reported for a switch native makes because the router asked', async () => {
    const { heard, tap, router } = await boot();
    await tap('search', 'programmatic-js');
    await tap('search', 'implicit');
    await router.navigateByUrl('/search');
    await idle();
    assert.deepEqual(heard, []);
  });

  it('reports a tap nothing observes as nothing, and still navigates', async () => {
    const { heard, tap, router } = await boot(false);
    await tap('search');
    assert.equal(router.url, '/search');
    assert.deepEqual(heard, []);
  });
});

describe('a native header bar button tapped', () => {
  let HostType: Type<{ closed: number; saved: number }>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/header-item.ts');
    HostType = mod['HeaderBarButtonsHost'] as typeof HostType;
  });

  async function boot() {
    const heard: InteractionEvent[] = [];
    const logged: number[][] = [];
    const app = await render(HostType, {
      providers: [
        provideInteractionObserver((event) => {
          heard.push(event);
          logged.push([app.instance.closed, app.instance.saved]);
        }),
      ],
    });
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const items = (side: 'Left' | 'Right') =>
      config().props[`header${side}BarButtonItems`] as Record<string, unknown>[];
    const press = (buttonId: unknown) =>
      fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId });
    return { ...app, heard, logged, items, press };
  }

  it('is reported as a click with its title, after its own (press)', async () => {
    const { heard, logged, items, press } = await boot();
    await press(items('Right').at(-1)!['buttonId']);
    assert.deepEqual(heard.map(stable), [
      {
        type: 'click',
        element: 'native-header-item',
        label: 'Save',
        role: 'button',
        source: 'click',
      },
    ]);
    assert.deepEqual(logged, [[0, 1]], 'after the item has run its own (press)');
  });

  it('is labelled by its spoken label when it has a symbol and no title', async () => {
    const { heard, items, press } = await boot();
    await press(items('Left')[0]!['buttonId']);
    assert.deepEqual(
      heard.map((event) => [event.type, event.label]),
      [['click', 'Close']],
    );
  });

  it('reports nothing for a press that names no item', async () => {
    const { heard, press } = await boot();
    await press('someone-else');
    await press(undefined);
    assert.deepEqual(heard, []);
  });

  it('keeps working when an observer throws', async () => {
    let saved = 0;
    const app = await render(HostType, {
      providers: [
        provideInteractionObserver(() => {
          throw new Error('broken observer');
        }),
      ],
    });
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const save = (config().props['headerRightBarButtonItems'] as Record<string, unknown>[]).at(-1)!;
    const warn = console.warn;
    console.warn = () => {};
    try {
      await fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId: save['buttonId'] });
      await fireEvent(config(), 'pressHeaderBarButtonItem', { buttonId: save['buttonId'] });
      saved = app.instance.saved;
    } finally {
      console.warn = warn;
    }
    assert.equal(saved, 2);
  });
});

describe('an action of a native header bar menu tapped', () => {
  type Entry = Record<string, unknown> & { items?: Entry[] };
  let ObjectMenu: Type<{ chosen: string[] }>;
  let TemplateMenu: Type<{ chosen: string[] }>;

  before(async () => {
    registerScreenComponents();
    const mod = await compileFixture('fixtures/header-item.ts');
    ObjectMenu = mod['HeaderMenuHost'] as typeof ObjectMenu;
    TemplateMenu = mod['HeaderTemplateMenuHost'] as typeof TemplateMenu;
  });

  async function boot(host: Type<{ chosen: string[] }>, observe = true) {
    const heard: InteractionEvent[] = [];
    const logged: string[][] = [];
    const app = await render(host, {
      providers: observe
        ? [
            provideInteractionObserver((event) => {
              heard.push(event);
              logged.push([...app.instance.chosen]);
            }),
          ]
        : [],
    });
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const menu = (side: 'Left' | 'Right') =>
      (config().props[`header${side}BarButtonItems`] as Entry[])[0]!['menu'] as Entry;
    const choose = (menuId: unknown) =>
      fireEvent(config(), 'pressHeaderBarButtonMenuItem', { menuId });
    return { ...app, heard, logged, menu, choose };
  }

  it('is reported as a click with its title, after (menuSelect), at any depth', async () => {
    const { heard, logged, menu, choose } = await boot(ObjectMenu);
    await choose(menu('Left').items![0]!['menuId']);
    assert.deepEqual(heard.map(stable), [
      {
        type: 'click',
        element: 'native-header-item',
        label: 'Name',
        role: 'menuitem',
        source: 'click',
      },
    ]);
    assert.deepEqual(logged, [['name']], 'after the item has emitted (menuSelect)');
    await choose(menu('Left').items![2]!.items![1]!.items![0]!['menuId']);
    assert.deepEqual(
      heard.map((event) => event.label),
      ['Name', 'Deeper'],
    );
  });

  it('is reported for a menu written as a template, after the item s (select)', async () => {
    const { heard, logged, menu, choose } = await boot(TemplateMenu);
    await choose(menu('Right').items![1]!.items![0]!.items![0]!['menuId']);
    assert.deepEqual(
      heard.map((event) => [event.type, event.element, event.label, event.role]),
      [['click', 'native-header-item', 'Copy Link', 'menuitem']],
    );
    assert.deepEqual(logged, [['copy']]);
  });

  it('reports nothing for an action the menu no longer has, a disabled one or no action', async () => {
    const { heard, menu, choose, instance, detectChanges } = await boot(ObjectMenu);
    const host = instance as unknown as { menu: { set(value: unknown): void } };
    await choose(menu('Left').items![1]!['menuId']);
    const name = menu('Left').items![0]!['menuId'];
    host.menu.set({ items: [{ type: 'action', id: 'other', title: 'Other' }] });
    await detectChanges();
    // The engine hands what a listener throws to the error handler, which logs it.
    const error = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await choose(name);
      await choose('someone-else/name');
      await choose(undefined);
    } finally {
      console.error = error;
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(heard, []);
  });

  it('reports nothing without an observer, and still runs the action', async () => {
    const { heard, menu, choose, instance } = await boot(ObjectMenu, false);
    await choose(menu('Left').items![0]!['menuId']);
    assert.deepEqual(instance.chosen, ['name']);
    assert.deepEqual(heard, []);
  });

  it('keeps working when an observer throws', async () => {
    let calls = 0;
    const app = await render(ObjectMenu, {
      providers: [
        provideInteractionObserver(() => {
          calls++;
          throw new Error('broken observer');
        }),
      ],
    });
    const config = () => app.fabric.find('RNSScreenStackHeaderConfig')!;
    const left = config().props['headerLeftBarButtonItems'] as Entry[];
    const name = (left[0]!['menu'] as Entry).items![0]!['menuId'];
    const warn = console.warn;
    console.warn = () => {};
    try {
      await fireEvent(config(), 'pressHeaderBarButtonMenuItem', { menuId: name });
      await fireEvent(config(), 'pressHeaderBarButtonMenuItem', { menuId: name });
    } finally {
      console.warn = warn;
    }
    assert.equal(calls, 2, 'the throwing observer ran for both actions');
    assert.deepEqual(app.instance.chosen, ['name', 'name']);
  });
});
