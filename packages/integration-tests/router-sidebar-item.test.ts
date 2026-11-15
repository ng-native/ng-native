/**
 * `<sidebar-item path>` from `@ng-native/router`: the route selects the item, with `<native-tab>`'s
 * matching, and choosing the item navigates to it. The router reaches the item through
 * `SIDEBAR_SELECTION`, since it cannot import the components package.
 */
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { registerPlatformComponents } from '@ng-native/fabric';
import { cleanup, render, settle, type FakeFabric, type FakeFabricNode } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { selectedPath } from '../router/src/sidebar-item-path.ts';
import { compileFixture } from './compile.ts';

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('selectedPath', () => {
  const paths = ['', 'inbox', 'mail', 'mail/sent'];

  it('picks the item with the longest path that starts the url', () => {
    assert.equal(selectedPath([], ['inbox'], paths), 1);
    assert.equal(selectedPath([], ['inbox', '42'], paths), 1, 'a page inside the item');
    assert.equal(selectedPath([], ['mail'], paths), 2);
    assert.equal(selectedPath([], ['mail', 'sent', 'today'], paths), 3);
    assert.equal(selectedPath([], ['mail', 'drafts'], paths), 2);
  });

  it("gives the item at '' the parent's url, and any url no other item takes", () => {
    assert.equal(selectedPath([], [], paths), 0);
    assert.equal(selectedPath([], ['elsewhere'], paths), 0);
    assert.equal(selectedPath([], ['elsewhere'], ['inbox']), -1);
  });

  it("selects nothing outside the parent route's url", () => {
    assert.equal(selectedPath(['app'], ['other', 'inbox'], paths), -1);
    assert.equal(selectedPath(['app', 'x'], ['app'], paths), -1);
    assert.equal(selectedPath(['app'], ['app', 'inbox'], paths), 1);
  });

  it('matches whole segments, not a prefix of one', () => {
    assert.equal(selectedPath([], ['inboxes'], ['inbox']), -1);
  });
});

describe('a sidebar item with a path', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let fabric: FakeFabric;
  let getByTestId: (id: string) => FakeFabricNode;
  /** The items the host is told are selected. */
  const selected = () =>
    ['home', 'inbox', 'mail', 'sent', 'locked'].filter(
      (id) => getByTestId(id).props['selected'] === true,
    );

  before(async () => {
    registerPlatformComponents('macos');
    mod = await compileFixture('fixtures/sidebar-routes.ts');
  });
  after(() => registerPlatformComponents('ios'));

  beforeEach(async () => {
    (mod['refuse'] as { now: boolean }).now = false;
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    fabric = app.fabric;
    getByTestId = app.getByTestId;
    router = app.componentRef.injector.get(Router);
    await idle();
  });

  afterEach(() => cleanup());

  it('is selected by the url, the longest path winning', async () => {
    assert.deepEqual(selected(), ['home']);
    await router.navigateByUrl('/inbox');
    await idle();
    assert.deepEqual(selected(), ['inbox']);
    await router.navigateByUrl('/mail/sent/today');
    await idle();
    assert.deepEqual(selected(), ['sent']);
    await router.navigateByUrl('/mail');
    await idle();
    assert.deepEqual(selected(), ['mail']);
  });

  it('navigates when the user chooses it', async () => {
    fabric.emit(getByTestId('inbox'), 'topSidebarSelect', {});
    await idle();
    assert.equal(router.url, '/inbox');
    assert.deepEqual(selected(), ['inbox']);
  });

  it('goes back to the route that is showing when a guard refuses the navigation', async () => {
    (mod['refuse'] as { now: boolean }).now = true;
    fabric.emit(getByTestId('locked'), 'topSidebarSelect', {});
    await idle();
    assert.equal(router.url, '/');
    assert.deepEqual(selected(), ['home']);
  });
});
