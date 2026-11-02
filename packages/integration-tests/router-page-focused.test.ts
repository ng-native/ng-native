/**
 * `injectPageFocused()` for work that only matters while its page shows: true while the page's tab
 * is selected and nothing is stacked over it, whichever way it went behind.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Signal, Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { injectPageFocused } from '@ng-native/router';
import { cleanup, render, settle } from '@ng-native/testing';
import { injectPageFocused as ownFile } from '../router/src/page-focused.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

interface Poll {
  focused: Signal<boolean>;
  running: number;
}

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/page-focused.ts');
});

async function boot(url: string) {
  const poll = mod['poll'] as Poll;
  poll.running = 0;
  const app = await render(mod['Shell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  await settle();
  const router = app.componentRef.injector.get(Router);
  const go = async (to: string) => {
    await router.navigateByUrl(to);
    await settle();
    await settle();
  };
  await go(url);
  return { go, poll };
}

/** The signal, and the poll a plain `effect()` on the page starts and stops with it. */
function assertFocused(poll: Poll, focused: boolean, when: string): void {
  assert.equal(poll.focused(), focused, when);
  assert.equal(poll.running, focused ? 1 : 0, `the poll, ${when}`);
}

describe('injectPageFocused', () => {
  it('is exported by the package', () => {
    assert.equal(injectPageFocused, ownFile);
  });

  it('follows a page pushed over it in its own stack', async () => {
    const { go, poll } = await boot('/home');
    assertFocused(poll, true, 'at the root of the stack');
    await go('/home/detail');
    assertFocused(poll, false, 'with a page pushed over it');
    await go('/home');
    assertFocused(poll, true, 'once that page is popped');
  });

  it('follows the tab of a page in a stack', async () => {
    const { go, poll } = await boot('/home');
    await go('/other');
    assertFocused(poll, false, 'with another tab selected');
    await go('/home');
    assertFocused(poll, true, 'back on its tab');
  });

  it('follows the tab of a page with no stack of its own', async () => {
    const { go, poll } = await boot('/plain');
    assertFocused(poll, true, 'on its tab');
    await go('/other');
    assertFocused(poll, false, 'with another tab selected');
    await go('/plain');
    assertFocused(poll, true, 'back on its tab');
  });

  it('follows a screen pushed over the whole tab bar', async () => {
    const { go, poll } = await boot('/home');
    await go('/cover');
    assertFocused(poll, false, 'with the bar covered');
    await go('/home');
    assertFocused(poll, true, 'once the bar is back');
  });

  it('stays false on a covered page when its tab is left and comes back', async () => {
    const { go, poll } = await boot('/home');
    await go('/home/detail');
    await go('/other');
    assertFocused(poll, false, 'covered, and in a tab behind');
    await go('/home/detail');
    assertFocused(poll, false, 'covered, in the tab in front');
  });

  it('reads true outside any outlet', async () => {
    const poll = mod['poll'] as Poll;
    poll.running = 0;
    await render(mod['Polling'] as Type<unknown>);
    await settle();
    assertFocused(poll, true, 'with no outlet');
  });
});
