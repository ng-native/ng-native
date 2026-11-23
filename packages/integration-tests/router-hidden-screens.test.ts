/**
 * What a query finds in a native stack: the screen in front, as on a device. The stack keeps every
 * screen mounted and shows the top one, so a screen pushed over another hides it from sight and
 * from a screen reader, and React Native Testing Library leaves out what is hidden by default.
 * A query found the screens below too, so a button on the list under a detail page matched twice.
 *
 * A presented sheet or transparent modal leaves the screen below it showing, and that screen is
 * still found. `includeHiddenElements` finds every screen.
 */
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { withComponentInputBinding, type Routes } from '@angular/router';
import { cleanup, render, screen, settle, within } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

async function idle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await settle();
}

describe('queries over a native stack', () => {
  let mod: Record<string, unknown>;
  let nav: NativeNavigation;

  before(async () => {
    mod = await compileFixture('fixtures/stack-app.ts');
  });

  beforeEach(async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      providers: [provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding())],
    });
    nav = app.componentRef.injector.get(NativeNavigation);
    await settle();
  });

  afterEach(() => cleanup());

  it('find the screen in front and none pushed under it', async () => {
    await nav.push('/user/1');
    await nav.push('/user/2');
    await idle();
    assert.ok(screen.getByText('user 2'));
    assert.equal(screen.queryByText('user 1'), null);
    assert.equal(screen.queryByText('home'), null);
  });

  it('find a screen again once the one over it is popped', async () => {
    await nav.push('/user/1');
    await idle();
    assert.equal(screen.queryByText('home'), null);
    await nav.back();
    await idle();
    assert.ok(screen.getByText('home'));
  });

  it('find the screens under it with includeHiddenElements, and in them with within', async () => {
    await nav.push('/user/1');
    await idle();
    const all = { includeHiddenElements: true };
    assert.ok(screen.getByText('home', all));
    const home = screen.getByText('home', all).parent!;
    assert.equal(within(home).queryByText('home'), null);
  });

  it('do not find a covered screen within a view inside it', async () => {
    await nav.push('/user/1');
    await idle();
    const text = screen.getByText('home', { includeHiddenElements: true });
    assert.equal(within(text).queryByText('home'), null);
    assert.ok(within(text).getByText('home', { includeHiddenElements: true }));
  });

  it('find a screen within it once the one over it is popped, and not once one is pushed over it', async () => {
    await nav.push('/user/1');
    await idle();
    const home = screen.getByText('home', { includeHiddenElements: true }).parent!;
    await nav.back();
    await idle();
    assert.ok(within(home).getByText('home'));
    await nav.push('/user/2');
    await idle();
    assert.equal(within(home).queryByText('home'), null);
  });

  it('find the screen a sheet or a transparent modal is presented over', async () => {
    await nav.present('/user/1', { as: 'formSheet' });
    await idle();
    assert.ok(screen.getByText('user 1'));
    assert.ok(screen.getByText('home'));
    await nav.present('/modal', { as: 'transparentModal' });
    await idle();
    assert.ok(screen.getByText('home'));
    assert.ok(screen.getByText('user 1'));
  });

  it('find the screen a modal or a page sheet is presented over on iOS, where both are sheets', async () => {
    for (const as of [undefined, 'pageSheet'] as const) {
      const label = as ?? 'default';
      await nav.present('/user/1', as && { as });
      await idle();
      assert.ok(screen.getByText('user 1'), label);
      assert.ok(screen.getByText('home'), label);
      nav.back();
      await idle();
    }
  });

  it('do not find the screen a full-screen modal or a contained modal covers, or one a push says it is', async () => {
    for (const as of ['fullScreenModal', 'containedModal', 'push'] as const) {
      await nav.present('/user/1', { as });
      await idle();
      assert.ok(screen.getByText('user 1'), as);
      assert.equal(screen.queryByText('home'), null, as);
      nav.back();
      await idle();
    }
  });
});

describe('queries over a native stack on Android', () => {
  let mod: Record<string, unknown>;
  let nav: NativeNavigation;

  before(async () => {
    mod = await compileFixture('fixtures/stack-app.ts');
  });

  beforeEach(async () => {
    const app = await render(mod['Shell'] as Type<unknown>, {
      os: 'android',
      providers: [provideNativeRouter(mod['routes'] as Routes, withComponentInputBinding())],
    });
    nav = app.componentRef.injector.get(NativeNavigation);
    await settle();
  });

  afterEach(() => cleanup());

  it('do not find the screen a modal or a page sheet covers, which Android shows full screen', async () => {
    for (const as of [undefined, 'pageSheet'] as const) {
      const label = as ?? 'default';
      await nav.present('/user/1', as && { as });
      await idle();
      assert.ok(screen.getByText('user 1'), label);
      assert.equal(screen.queryByText('home'), null, label);
      nav.back();
      await idle();
    }
  });

  it('find the screen a sheet or a transparent modal is presented over', async () => {
    for (const as of ['formSheet', 'transparentModal'] as const) {
      await nav.present('/user/1', { as });
      await idle();
      assert.ok(screen.getByText('user 1'), as);
      assert.ok(screen.getByText('home'), as);
      nav.back();
      await idle();
    }
  });
});
