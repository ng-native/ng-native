/**
 * `SegmentedControl` and `DateTimePicker` from `@ng-native/expo` register their element as they are
 * made, so an app that imports one without calling `registerNativeViews` still commits the native
 * view rather than an empty one.
 */
import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

let mod: Record<string, unknown>;
before(async () => {
  mod = await compileFixture('fixtures/community-controls.ts');
});
after(() => cleanup());

it('commits each control as its native view without a registerNativeViews call', async () => {
  await render(mod['CommunityControls'] as Type<unknown>);
  await settle();
  assert.equal(screen.getByTestId('segments').viewName, 'RNCSegmentedControl');
  assert.equal(screen.getByTestId('more').viewName, 'RNCSegmentedControl');
  assert.equal(screen.getByTestId('date').viewName, 'RNDateTimePicker');
  // The library's default comes with the name: without it the interop layer never wires onChange.
  assert.equal(screen.getByTestId('segments').props['onChange'], true);
});
