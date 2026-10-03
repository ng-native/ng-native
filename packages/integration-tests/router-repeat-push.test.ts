/**
 * A push to a url that is already on the stack: a customer page that links to one of its jobs,
 * whose page links back to the customer. A native stack pushes a second screen for it, and Back
 * returns to where the push came from. Going back to a screen below is a pop, not a push.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Type } from '@angular/core';
import { Router, type Routes } from '@angular/router';
import { cleanup, render, settle, type FakeFabricNode } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture(fileURLToPath(new URL('./fixtures/repeat-push.ts', import.meta.url)));
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
