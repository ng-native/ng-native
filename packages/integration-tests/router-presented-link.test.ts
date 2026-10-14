/**
 * A `nativeRouterLink` inside a page presented over another tab: pressing it leaves the page, as
 * a push from it does, and goes where the link leads.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, screen, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

describe('a link inside a page presented over another tab', () => {
  let mod: Record<string, unknown>;
  let router: Router;
  let navigation: NativeNavigation;

  before(async () => {
    mod = await compileFixture('fixtures/presented-link.ts');
  });

  beforeEach(async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes)],
    });
    router = app.componentRef.injector.get(Router);
    navigation = app.componentRef.injector.get(NativeNavigation);
    await settle();
    await navigation.present('/library/7', { as: 'formSheet' });
    await settle();
    assert.equal(router.url, '/home(presented:library/7)');
  });

  afterEach(() => cleanup());

  for (const link of ['absolute', 'relative']) {
    it(`dismisses the page and goes where an ${link} link leads`, async () => {
      await fireEvent.press(screen.getByTestId(link));
      await settle();
      await settle();
      assert.equal(router.url, '/library/9');
    });
  }
});
