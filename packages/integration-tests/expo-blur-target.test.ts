/**
 * `expo-blur` blurs on Android only what a `BlurTargetView` draws: `BlurView` passes the target's
 * view tag as `blurTargetId`. Elsewhere the target is a plain view, as `expo-blur`'s own is.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import type { Type } from '@angular/core';
import { registerExpoViews } from '@ng-native/expo';
import {
  cleanup,
  render,
  settle,
  type FakeFabric,
  type FakeFabricNode,
  type TestOs,
} from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const flatten = (nodes: FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)]);
const byID = (fabric: FakeFabric, id: string) =>
  flatten(fabric.committed).find((node) => node.props['nativeID'] === id)!;

let Fixture: Type<unknown>;
before(async () => {
  Fixture = (await compileFixture('fixtures/expo-blur-target.ts'))[
    'ExpoBlurTargetFixture'
  ] as Type<unknown>;
});
afterEach(cleanup);

async function open(os: TestOs) {
  registerExpoViews('expo-blur', 'expo-blur-target');
  const app = await render(Fixture, { os });
  await settle();
  return app;
}

describe('a blur target', () => {
  it("is expo-blur's target view on Android, whose tag the blur commits as blurTargetId", async () => {
    const { fabric } = await open('android');
    const target = byID(fabric, 'target');
    assert.equal(target.viewName, 'ViewManagerAdapter_ExpoBlur_ExpoBlurTargetView');
    assert.equal(byID(fabric, 'blur').props['blurTargetId'], target.reactTag);
  });

  it('is a plain view on iOS, as BlurTargetView is there', async () => {
    const { fabric } = await open('ios');
    assert.equal(byID(fabric, 'target').viewName, 'View');
  });

  it('takes blurTargetId off the blur once the target goes', async () => {
    const { fabric, componentRef } = await open('android');
    (componentRef.instance as { shown: { set(value: boolean): void } }).shown.set(false);
    await settle();
    assert.equal(byID(fabric, 'blur').props['blurTargetId'] ?? null, null);
  });
});
