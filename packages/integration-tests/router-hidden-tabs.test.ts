/**
 * What a query finds under a native tab bar, and what a press reaches: the selected tab, as on a
 * device. The tabs host keeps every tab it has opened mounted and shows the selected one; UIKit's
 * tab bar controller and Android's fragment container take the others out of the window, and the
 * desktop host neither draws nor hits them. A query found the tabs behind too.
 *
 * A screen nobody can see cannot be tapped either, so a press on a node in a tab behind, or on a
 * screen a push covers, found with `includeHiddenElements`, does nothing.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, screen, settle, userEvent, within } from '@ng-native/testing';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

async function idle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await settle();
}

const all = { includeHiddenElements: true };

let mod: Record<string, unknown>;
const pressed = () => (mod['pressed'] as { count: number }).count;

before(async () => {
  mod = await compileFixture('fixtures/covered-tabs.ts');
});

afterEach(() => cleanup());

async function open(os: 'ios' | 'android' | 'macos'): Promise<Router> {
  const app = await render(mod['Shell'] as Type<unknown>, {
    os,
    providers: [provideNativeRouter(mod['routes'] as Routes)],
  });
  const router = app.componentRef.injector.get(Router);
  await idle();
  assert.equal(router.url, '/home');
  return router;
}

for (const os of ['ios', 'android', 'macos'] as const) {
  describe(`queries under a native tab bar on ${os}`, () => {
    it('find the selected tab and none of the tabs behind it', async () => {
      const router = await open(os);
      assert.ok(screen.getByText('home'));
      await router.navigateByUrl('/library');
      assert.ok(await screen.findByText('library'));
      assert.equal(screen.queryByText('home'), null);
      assert.equal(screen.queryByTestId('count'), null);
    });

    it('find a tab again once it is selected again, and not the one it replaced', async () => {
      const router = await open(os);
      await router.navigateByUrl('/library');
      await screen.findByText('library');
      await router.navigateByUrl('/home');
      assert.ok(await screen.findByText('home'));
      assert.equal(screen.queryByText('library'), null);
    });

    it('find the tabs behind with includeHiddenElements, and nothing within them without it', async () => {
      const router = await open(os);
      await router.navigateByUrl('/library');
      await screen.findByText('library');
      const home = screen.getByText('home', all);
      assert.equal(within(home).queryByText('home'), null);
      assert.ok(within(home).getByText('home', all));
    });

    it('find the bar item of a tab behind, and nothing it holds', async () => {
      const router = await open(os);
      await router.navigateByUrl('/library');
      await screen.findByText('library');
      const item = screen.getByTestId('home-tab');
      assert.equal(item.props['title'], 'Home');
      assert.equal(within(item).queryByText('home'), null);
      assert.ok(within(item).getByText('home', all));
    });
  });
}

describe('a press on a screen nobody can see', () => {
  it('reaches the button on the selected tab', async () => {
    await open('ios');
    const before = pressed();
    await userEvent.press(screen.getByTestId('count'));
    assert.equal(pressed(), before + 1);
  });

  it('does nothing on a tab behind the selected one', async () => {
    for (const os of ['ios', 'android'] as const) {
      const router = await open(os);
      const button = screen.getByTestId('count');
      await router.navigateByUrl('/library');
      await screen.findByText('library');
      const before = pressed();
      await userEvent.press(button);
      await fireEvent.press(screen.getByTestId('count', all));
      await userEvent.longPress(button, { duration: 0 });
      assert.equal(pressed(), before, os);
      cleanup();
    }
  });

  it('types into nothing and clears nothing on a tab behind the selected one', async () => {
    const typed = mod['typed'] as string[];
    const router = await open('ios');
    const field = screen.getByTestId('note');
    await router.navigateByUrl('/library');
    await screen.findByText('library');
    const before = typed.length;
    await userEvent.type(field, 'hi');
    await userEvent.clear(field);
    assert.equal(typed.length, before);
  });

  it('does nothing on a screen a push covers, and reaches it again once the push is popped', async () => {
    const router = await open('ios');
    const button = screen.getByTestId('count');
    await router.navigateByUrl('/detail/1');
    assert.ok(await screen.findByText('detail'));
    const before = pressed();
    await userEvent.press(button);
    assert.equal(pressed(), before);
    await router.navigateByUrl('/home');
    await screen.findByTestId('count');
    await userEvent.press(button);
    assert.equal(pressed(), before + 1);
  });
});
