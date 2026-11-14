/**
 * `controlSize` on every native control: AppKit's control sizes on macOS, and UIKit's on iOS 26
 * and later, which the host maps the committed `controlSize` prop to. Android and the web ignore
 * it. A control left unsized commits nothing, which is `regular`.
 */
import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, settle } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

it('commits the size each native control is given, and none for one not given it', async () => {
  const mod = await compileFixture('fixtures/control-size.ts');
  const field = await compileFixture('../expo/src/search-field.ts');
  const { getByTestId } = await render(mod['ControlSizeFixture'] as Type<unknown>, {
    // The search field's native code, there: without it the element draws nothing.
    providers: [{ provide: (field['SearchField'] as { SOURCE: unknown }).SOURCE, useValue: {} }],
  });
  for (let turn = 0; turn < 3; turn++) await settle();
  for (const control of [
    'native-button',
    'switch',
    'activity-indicator',
    'segmented-control',
    'date-time-picker',
    'search-field',
  ]) {
    assert.equal(getByTestId(control).props['controlSize'], 'mini', control);
  }
  assert.equal(getByTestId('unsized').props['controlSize'], undefined);
});
