/**
 * A push to a url that is already on the stack: a customer page that links to one of its jobs,
 * whose page links back to the customer. A native stack pushes a second screen for it, and Back
 * returns to where the push came from. Going back to a screen below is a pop, not a push, and it
 * goes back to the screen at that history entry: the lower one, where two at the url are still on
 * the stack.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Injector, Type } from '@angular/core';
import { PlatformLocation } from '@angular/common';
import { Router, type Routes } from '@angular/router';
import { cleanup, fireEvent, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import type { NativePlatformLocation } from '../router/src/native-platform-location.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/repeat-push.ts');
});

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);

it('pushes a second screen for a url already on the stack, and goes back through both', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['repeatRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;
  const first = (await app.findByText(/^A \d+$/)).children[0]!.props['text'] as string;

  await nav.push('/b');
  await turns();
  await nav.push('/a');
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens(), 3, 'A, B and a second A');
  const texts = () => app.getAllByText(/^A \d+$/).map((node) => node.children[0]!.props['text']);
  assert.equal(texts().length, 2);
  assert.notEqual(texts().at(-1), first, 'the one on top is a new page');

  nav.back();
  await turns();
  assert.equal(router.url, '/b', 'back returns to where the push came from');
  assert.equal(screens(), 2);

  nav.back();
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens(), 1);
  assert.deepEqual(texts(), [first], 'and the first A is the one it was');
});

it('pushes a second screen for a url already on the stack from a link too', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['linkRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;

  await fireEvent.press(await app.findByText('Customer'));
  await turns();
  await fireEvent.press(await app.findByText('Job'));
  await turns();
  assert.equal(router.url, '/customer');
  assert.equal(screens(), 3, 'Customer, Job and a second Customer');
  assert.equal(app.getAllByText('Customer').length, 2);

  nav.back();
  await turns();
  assert.equal(router.url, '/job', 'back returns to the page the link was on');
  assert.equal(screens(), 2);
});

it('still replaces the screen from a link told to replace', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['linkRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;

  await fireEvent.press(await app.findByText('Customer'));
  await turns();
  await fireEvent.press(await app.findByText('Replace with a note'));
  await turns();
  assert.equal(router.url, '/note');
  assert.equal(screens(), 2, 'Customer and the note, with no Job between');
  assert.equal(app.queryByText('Job'), null);

  nav.back();
  await turns();
  assert.equal(router.url, '/customer');
  assert.equal(screens(), 1);
});

it('replaces the screen from a link whose extras replace the url, as nav.replace does', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['linkRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;

  await fireEvent.press(await app.findByText('Customer'));
  await turns();
  await fireEvent.press(await app.findByText('Replace with the customer'));
  await turns();
  assert.equal(router.url, '/customer');
  assert.equal(screens(), 1, 'the Job its history entry no longer has is gone');
  assert.equal(app.queryByText('Job'), null);

  nav.back();
  await turns();
  assert.equal(router.url, '/customer', 'and Back has no Job to land on');
  assert.equal(screens(), 1);
});

/** The urls history holds up to the page showing, oldest first. */
const historyOf = (app: { componentRef: { injector: Injector } }) =>
  (app.componentRef.injector.get(PlatformLocation) as unknown as NativePlatformLocation)
    .ɵpages()
    .map((page) => page.url);

/** A, B, a second A and C, pushed in that order, or the urls given after A. */
async function twoAtOneUrl(urls = ['/b', '/a', '/c']) {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['repeatRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen');
  const texts = () => app.getAllByText(/^A \d+$/).map((node) => node.children[0]!.props['text']);
  const first = (await app.findByText(/^A \d+$/)).children[0]!.props['text'] as string;
  for (const url of urls) {
    await nav.push(url);
    await turns();
  }
  assert.equal(screens().length, 4, 'A, B, a second A and C');
  return { app, nav, router, turns, screens, texts, first, second: texts().at(-1) };
}

it('goes back to the lower of two screens at one url through popTo()', async () => {
  const { app, nav, router, turns, screens, texts, first } = await twoAtOneUrl();

  assert.equal(await nav.popTo('/a'), true);
  await turns();
  assert.equal(router.url, '/a');
  assert.deepEqual(historyOf(app), ['/a']);
  assert.equal(screens().length, 1, 'the screen history went back to, with none over it');
  assert.deepEqual(texts(), [first], 'the first A, not the second');
});

it('goes back to the lower of two screens at one url through a native pop of three', async () => {
  const { app, router, turns, screens, texts, first } = await twoAtOneUrl();

  await fireEvent(screens().at(-1)!, 'dismissed', { dismissCount: 3 });
  await turns();
  assert.equal(router.url, '/a');
  assert.deepEqual(historyOf(app), ['/a']);
  assert.equal(screens().length, 1, 'the screen history went back to, with none over it');
  assert.deepEqual(texts(), [first], 'the first A, not the second');
});

it('goes back to the lower of two screens at one url after a query changed it in place', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['repeatRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;
  const texts = () => app.getAllByText(/^A \d+$/).map((node) => node.children[0]!.props['text']);
  const first = (await app.findByText(/^A \d+$/)).children[0]!.props['text'] as string;

  for (const url of ['/a?tab=1', '/b', '/a', '/c']) {
    await nav.push(url);
    await turns();
  }
  assert.equal(screens(), 4, 'A, with its query in place, B, a second A and C');

  assert.equal(await nav.popTo('/a?tab=1'), true);
  await turns();
  assert.equal(router.url, '/a?tab=1');
  assert.equal(screens(), 1);
  assert.deepEqual(texts(), [first], 'the A the query was set on');
});

it('goes back to the lower of two screens at one url after a query changed it without an entry', async () => {
  const app = await render(mod['RepeatShell'] as Type<unknown>, {
    providers: [provideNativeRouter(mod['repeatRoutes'] as Routes)],
  });
  const nav = app.componentRef.injector.get(NativeNavigation);
  const router = app.componentRef.injector.get(Router);
  const location = app.componentRef.injector.get(PlatformLocation);
  const turns = async () => {
    for (let turn = 0; turn < 6; turn++) await settle();
  };
  const screens = () =>
    flatten(app.fabric.committed).filter((node) => node.viewName === 'RNSScreen').length;
  const texts = () => app.getAllByText(/^A \d+$/).map((node) => node.children[0]!.props['text']);
  const first = (await app.findByText(/^A \d+$/)).children[0]!.props['text'] as string;

  await router.navigateByUrl('/a?tab=1', { skipLocationChange: true });
  await turns();
  for (const url of ['/b', '/a', '/c']) {
    await nav.push(url);
    await turns();
  }
  assert.equal(screens(), 4, 'A, B, a second A and C');

  location.historyGo!(-3);
  await turns();
  assert.deepEqual(historyOf(app), ['/a']);
  assert.equal(screens(), 1);
  assert.deepEqual(texts(), [first], 'the A whose entry the query left as it was');
});

it('goes back through two live screens at one url one at a time', async () => {
  const { nav, router, turns, screens, texts, first, second } = await twoAtOneUrl();

  nav.back();
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens().length, 3);
  assert.deepEqual(texts(), [first, second], 'back from C is the second A');

  nav.back();
  await turns();
  assert.equal(router.url, '/b');
  assert.equal(screens().length, 2);

  nav.back();
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens().length, 1);
  assert.deepEqual(texts(), [first]);
});

it('goes back to the lower of two screens at one url through popTo(), with history not matching the stack', async () => {
  // The query change on B adds an entry but no screen, so the entry three back is B's, not A's,
  // and popTo() goes there by a navigation instead of through history.
  const { app, nav, router, turns, screens, texts, first } = await twoAtOneUrl([
    '/b',
    '/b?x=1',
    '/a',
    '/c',
  ]);
  assert.deepEqual(historyOf(app), ['/a', '/b', '/b?x=1', '/a', '/c']);

  assert.equal(await nav.popTo('/a'), true);
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens().length, 1, 'the screen asked for, with none over it');
  assert.deepEqual(texts(), [first], 'the first A, not the second');
});

it('goes back to the lower of two screens at one url through a native pop of three, with history not matching the stack', async () => {
  const { app, router, turns, screens, texts, first } = await twoAtOneUrl([
    '/b',
    '/b?x=1',
    '/a',
    '/c',
  ]);
  assert.deepEqual(historyOf(app), ['/a', '/b', '/b?x=1', '/a', '/c']);

  await fireEvent(screens().at(-1)!, 'dismissed', { dismissCount: 3 });
  await turns();
  assert.equal(router.url, '/a');
  assert.equal(screens().length, 1, 'the screen native popped to, with none over it');
  assert.deepEqual(texts(), [first], 'the first A, not the second');
});

it('goes back to the newer of two screens at one url by a plain navigation after a pop to the lower one', async () => {
  // The pop's choice of screen lasts only as long as the pop's own navigation.
  const { nav, router, turns, screens, texts, first } = await twoAtOneUrl([
    '/b',
    '/b?x=1',
    '/a',
    '/c',
  ]);
  assert.equal(await nav.popTo('/a'), true);
  await turns();
  assert.deepEqual(texts(), [first]);
  for (const url of ['/b', '/a', '/c']) {
    await nav.push(url);
    await turns();
  }
  assert.equal(screens().length, 4, 'A, B, a third A and C');
  const third = texts().at(-1);

  assert.equal(await router.navigateByUrl('/a'), true);
  await turns();
  assert.equal(screens().length, 3);
  assert.deepEqual(texts(), [first, third], 'the newest A, as #481 has it');
});
