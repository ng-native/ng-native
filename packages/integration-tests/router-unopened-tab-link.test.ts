/**
 * A `nativeRouterLink` to a page of a tab nobody has opened: the tab's first screen goes under the
 * page, as a `push()` to the same url puts it, and a back from the page lands there.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

async function idle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await settle();
}

describe('a link into a tab nobody has opened', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;

  before(async () => {
    mod = await compileFixture('fixtures/unopened-tab-link.ts');
  });

  beforeEach(async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    router = app.componentRef.injector.get(Router);
    navigation = app.componentRef.injector.get(NativeNavigation);
    await idle();
    assert.equal(router.url, '/home');
  });

  afterEach(() => cleanup());

  it("puts the tab's first screen under the page, and a back lands on it", async () => {
    await fireEvent.press(screen.getByTestId('album'));
    await idle();
    assert.equal(router.url, '/library/7');
    assert.ok(
      screen.queryByText('library', { includeHiddenElements: true }),
      'the Library screen is under the album',
    );

    navigation.back();
    await idle();
    assert.equal(router.url, '/library');
  });

  it("puts the tab's first screen under a page a relative link leads to", async () => {
    await fireEvent.press(screen.getByTestId('relative'));
    await idle();
    assert.equal(router.url, '/library/7');
    assert.ok(
      screen.queryByText('library', { includeHiddenElements: true }),
      'the Library screen is under the album',
    );

    navigation.back();
    await idle();
    assert.equal(router.url, '/library');
  });

  it('reads a query written into the link as a query, not as part of the path', async () => {
    await fireEvent.press(screen.getByTestId('query'));
    await idle();
    assert.equal(router.url, '/library/7?from=home');
  });
});
