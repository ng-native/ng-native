/**
 * A bar under a parameter, `city/:name`: each tab's url is the parameter's segment as the router
 * writes it, escaped and with its matrix parameters, so a url inside a tab is found in it.
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
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

function flatten(nodes: FakeFabricNode[]): FakeFabricNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('a bar under a parameter', () => {
  let mod: Record<string, unknown>;

  before(async () => {
    mod = await compileFixture('fixtures/tab-param-parent.ts');
  });

  afterEach(() => cleanup());

  async function cityAt(url: string) {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    const router = app.componentRef.injector.get(Router);
    await router.navigateByUrl(url);
    await idle();
    let provenance = 0;
    const host = () =>
      flatten(app.fabric.committed).find((node) => node.viewName === 'RNSTabsHostIOS')!;
    const tap = async (key: string) => {
      await fireEvent(host(), 'tabSelected', { selectedScreenKey: key, provenance: ++provenance });
      await idle();
    };
    const navigation = app.componentRef.injector.get(NativeNavigation);
    return { router, navigation, tap };
  }

  for (const name of ['rio', 'são-paulo', 'new york']) {
    it(`returns a tab to the page it was on, in a city written ${JSON.stringify(name)}`, async () => {
      const { router, tap } = await cityAt(`/city/${encodeURIComponent(name)}/library/7`);
      const at = router.url;
      await tap('home');
      assert.equal(router.url, `/city/${encodeURIComponent(name)}/home`);
      await tap('library');
      assert.equal(router.url, at, 'back on the album, not on the tab root');
    });
  }

  it("puts a tab's first screen under a page pushed into it, in a city with an accent", async () => {
    const { router, navigation } = await cityAt('/city/s%C3%A3o-paulo/home');
    assert.equal(await navigation.push('/city/s%C3%A3o-paulo/library/7'), true);
    await idle();
    assert.ok(screen.getByText('album'));
    assert.ok(
      screen.getByText('library', { includeHiddenElements: true }),
      'the list is mounted under it',
    );
    navigation.back();
    await idle();
    assert.equal(router.url, '/city/s%C3%A3o-paulo/library');
  });

  it('keeps the matrix parameters of the parameter it is under', async () => {
    const { router, tap } = await cityAt('/city/rio;lang=pt/home');
    await tap('library');
    assert.equal(router.url, '/city/rio;lang=pt/library');
    await tap('home');
    assert.equal(router.url, '/city/rio;lang=pt/home');
  });

  it("returns a tab to the page it was on, with matrix parameters on the tab's own segment", async () => {
    const { router, tap } = await cityAt('/city/rio/library;sort=a/7');
    await tap('home');
    assert.equal(router.url, '/city/rio/home');
    await tap('library');
    assert.equal(
      router.url,
      '/city/rio/library;sort=a/7',
      'back on the album, not on the tab root',
    );
  });

  it("puts nothing under a tab's first screen pushed with matrix parameters", async () => {
    const { router, navigation } = await cityAt('/city/rio/home');
    assert.equal(await navigation.push('/city/rio/library;sort=a'), true);
    await idle();
    assert.equal(router.url, '/city/rio/library;sort=a');
    assert.equal(screen.queryAllByText('library').length, 1, 'one list, not one under another');
  });

  it('returns a tab to the page it was on, with a named outlet open beside it', async () => {
    const { router, tap } = await cityAt('/city/rio/library/7');
    await router.navigateByUrl('/city/rio/library(popup:compose)');
    await idle();
    await tap('home');
    assert.equal(router.url, '/city/rio/home');
    await tap('library');
    assert.equal(router.url, '/city/rio/library(popup:compose)', 'where the tab was left');
  });

  it("returns a tab to the page it was on, with the presented outlet's name in its query", async () => {
    const { router, tap } = await cityAt('/city/rio/library/7?q=presented:x');
    const at = router.url;
    await tap('home');
    await tap('library');
    assert.equal(router.url, at, 'back on the album, not on the tab root');
  });
});
