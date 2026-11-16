/**
 * Interaction observers hear the router's native controls: a tab tapped in the native tab bar, and
 * a native header bar button. Each is a `click` labelled with the item's title. The navigation a
 * tab tap starts is not an interaction, and is not reported.
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
