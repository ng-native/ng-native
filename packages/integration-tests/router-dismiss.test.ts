/**
 * A presented screen that must not be swiped away while it holds unsaved changes, and has to hear
 * the attempt to ask about them. The page's host element is its screen, so it says so itself.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import type { Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { HardwareBack } from '@ng-native/device';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(
    fileURLToPath(new URL('./fixtures/guarded-sheet.ts', import.meta.url)),
  );
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

it('refuses a swipe down while dirty, and hears it', async () => {
  const app = await render(mod['GuardShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['guardRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  await nav.present('/editor', { as: 'formSheet' });
  await settle();
  const editor = () =>
    flatten(app.fabric.committed)
      .filter((node) => node.viewName === 'RNSScreen')
      .at(-1)!;
  const page = (mod['editors'] as Editor[]).at(-1)!;

  assert.notEqual(
    editor().props['preventNativeDismiss'],
    true,
    'a clean editor can be swiped away',
  );
  page.dirty.set(true);
  await settle();
  assert.equal(editor().props['preventNativeDismiss'], true);

  await fireEvent(editor(), 'nativeDismissCancelled', { dismissCount: 1 });
  assert.equal(page.attempts(), 1, 'the page heard the attempt');
});

/**
 * Android's Back button is the platform's own dismissal there, and react-native-screens leaves it
 * to JS: its Android screen ignores `preventNativeDismiss`. So the stack refuses it, as iOS
 * refuses a swipe, and says so the same way. `NativeNavigation.back()` is how the page leaves
 * once it has asked, so that still goes.
 */
describe("Android's Back on a screen that refuses a native dismissal", () => {
  async function presentEditor() {
    const handlers: (() => boolean)[] = [];
    const app = await render(mod['GuardShell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['guardRoutes'] as Routes),
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (handler: () => boolean) => {
              handlers.push(handler);
              return () => handlers.splice(handlers.indexOf(handler), 1);
            },
          },
        },
      ],
    });
    const nav = app.componentRef.injector.get(NativeNavigation);
    await nav.present('/editor', { as: 'formSheet' });
    await settle();
    const screens = () =>
      flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
    const pressBack = async () => {
      const taken = [...handlers].reverse().some((handler) => handler());
      for (let turn = 0; turn < 5; turn++) await settle();
      return taken;
    };
    return { nav, screens, pressBack, page: (mod['editors'] as Editor[]).at(-1)! };
  }

  it('keeps the screen and reports the attempt while it refuses', async () => {
    const { screens, pressBack, page } = await presentEditor();
    page.dirty.set(true);
    await settle();
    assert.equal(await pressBack(), true, 'the press is taken, not passed to the platform');
    assert.equal(screens().length, 2, 'the sheet is still there');
    assert.equal(page.attempts(), 1, 'the page heard the attempt');
  });

  it('goes back as usual once the screen stops refusing', async () => {
    const { screens, pressBack, page } = await presentEditor();
    assert.equal(await pressBack(), true);
    assert.equal(screens().length, 1);
    assert.equal(page.attempts(), 0);
  });

  it('still lets the page leave through NativeNavigation.back()', async () => {
    const { nav, screens, page } = await presentEditor();
    page.dirty.set(true);
    await settle();
    nav.back();
    for (let turn = 0; turn < 5; turn++) await settle();
    assert.equal(screens().length, 1);
    assert.equal(page.attempts(), 0);
  });
});

/**
 * A presented screen that wants a header is a stack of its own, so the page that knows about the
 * unsaved changes is the first screen inside it, and the screen a swipe dismisses is the one the
 * stack sits on. The stack passes its top screen's refusal down to that screen.
 */
describe('a page inside a presented stack that refuses a native dismissal', () => {
  async function presentStack(url = '/compose') {
    const handlers: (() => boolean)[] = [];
    const app = await render(mod['GuardShell'] as Type<unknown>, {
      providers: [
        provideNativeRouter(mod['guardRoutes'] as Routes),
        {
          provide: HardwareBack.SOURCE,
          useValue: {
            subscribe: (handler: () => boolean) => {
              handlers.push(handler);
              return () => handlers.splice(handlers.indexOf(handler), 1);
            },
          },
        },
      ],
    });
    const nav = app.componentRef.injector.get(NativeNavigation);
    await nav.present(url, { as: 'formSheet' });
    await settle();
    const screens = () =>
      flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
    const sheet = () => screens().find((node) => node.props['stackPresentation'] === 'formSheet')!;
    const pressBack = async () => {
      const taken = [...handlers].reverse().some((handler) => handler());
      for (let turn = 0; turn < 5; turn++) await settle();
      return taken;
    };
    return { nav, screens, sheet, pressBack, page: (mod['editors'] as Editor[]).at(-1)! };
  }

  it('refuses a swipe down on the sheet while the page is dirty, and no longer once clean', async () => {
    const { sheet, page } = await presentStack();
    assert.notEqual(sheet().props['preventNativeDismiss'], true, 'a clean page can be swiped away');
    page.dirty.set(true);
    await settle();
    assert.equal(sheet().props['preventNativeDismiss'], true);
    page.dirty.set(false);
    await settle();
    assert.notEqual(sheet().props['preventNativeDismiss'], true);
  });

  it('tells the page of the attempt the sheet refused', async () => {
    const { sheet, page } = await presentStack();
    page.dirty.set(true);
    await settle();
    await fireEvent(sheet(), 'nativeDismissCancelled', { dismissCount: 1 });
    assert.equal(page.attempts(), 1);
  });

  it("refuses Android's Back the same way, and tells the page", async () => {
    const { screens, pressBack, page } = await presentStack();
    page.dirty.set(true);
    await settle();
    const before = screens().length;
    assert.equal(await pressBack(), true, 'the press is taken, not passed to the platform');
    assert.equal(screens().length, before, 'the sheet is still there');
    assert.equal(page.attempts(), 1);
  });

  it('follows the screen on top of the stack, not the first one', async () => {
    const { nav, sheet, page } = await presentStack();
    page.dirty.set(true);
    await settle();
    await nav.push('/compose/more');
    for (let turn = 0; turn < 5; turn++) await settle();
    assert.notEqual(
      sheet().props['preventNativeDismiss'],
      true,
      'the screen on top does not refuse',
    );
    nav.back();
    for (let turn = 0; turn < 5; turn++) await settle();
    assert.equal(sheet().props['preventNativeDismiss'], true, 'and the editor under it does');
  });

  it('passes the refusal through a stack inside a stack, and releases it the same way', async () => {
    const { sheet, page } = await presentStack('/nested');
    page.dirty.set(true);
    await settle();
    assert.equal(sheet().props['preventNativeDismiss'], true);
    page.dirty.set(false);
    await settle();
    assert.notEqual(sheet().props['preventNativeDismiss'], true);
  });

  it("refuses Android's Back from a stack inside a stack", async () => {
    const { screens, pressBack, page } = await presentStack('/nested');
    page.dirty.set(true);
    await settle();
    const before = screens().length;
    assert.equal(await pressBack(), true);
    assert.equal(screens().length, before, 'the sheet is still there');
    assert.equal(page.attempts(), 1);
  });

  it("leaves the sheet's own refusal in place when the page stops refusing", async () => {
    const { sheet, page } = await presentStack('/locked');
    assert.equal(sheet().props['preventNativeDismiss'], true);
    page.dirty.set(true);
    await settle();
    page.dirty.set(false);
    await settle();
    assert.equal(sheet().props['preventNativeDismiss'], true);
  });
});

interface Editor {
  dirty: { set(value: boolean): void };
  attempts(): number;
}

it('presents once for a double tap, and one back closes it', async () => {
  const app = await render(mod['GuardShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['guardRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
  // Two taps before the first presentation has finished.
  const first = nav.present('/editor', { as: 'formSheet' });
  const second = nav.present('/editor', { as: 'formSheet' });
  await Promise.all([first, second]);
  await settle();
  assert.equal(screens().length, 2, 'the home screen and one sheet');
  nav.back();
  for (let turn = 0; turn < 5; turn++) await settle();
  assert.equal(screens().length, 1);
});
