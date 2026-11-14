/**
 * `present()` with an `anchor`: the screen shows as a popover at the element where the OS has
 * popovers, and as it would without one elsewhere.
 *
 * The host contract: the presented `RNSScreen` takes an `anchor` prop, the react tag of the
 * anchor's committed view, beside its `stackPresentation`. The desktop host shows it in an
 * NSPopover at that view, and iPadOS in a UIPopover; iPhone and Android ignore it. A popover draws
 * no header, and its title becomes the popover's accessibility label.
 */
import assert from 'node:assert/strict';
import { afterEach, before, it } from 'node:test';
import type { Type } from '@angular/core';
import { cleanup, render, screen, settle } from '@ng-native/testing';
import { NativeNavigation } from '../router/src/native-navigation.ts';
import { provideNativeRouter } from '../router/src/provide-native-router.ts';
import { compileFixture } from './compile.ts';

afterEach(cleanup);

let mod: Record<string, Type<unknown>>;
before(async () => {
  mod = (await compileFixture('fixtures/app-windows.ts')) as Record<string, Type<unknown>>;
});

it('commits the anchor view tag on the presented screen, and none without one', async () => {
  const app = await render(mod['RoutedApp']!, {
    providers: [
      provideNativeRouter([
        { path: '', component: mod['HomePage']! },
        { path: 'filters', component: mod['GeneralPage']! },
      ]),
    ],
  });
  for (let turn = 0; turn < 3; turn++) await settle();
  const navigation = app.componentRef.injector.get(NativeNavigation);
  const home = screen.getByTestId('home');
  assert.equal(
    await navigation.present('/filters', { anchor: home.instanceHandle as never }),
    true,
  );
  for (let turn = 0; turn < 3; turn++) await settle();
  const presented = screen.getByTestId('general');
  let at = presented.parent;
  while (at && at.viewName !== 'RNSScreen') at = at.parent;
  assert.equal(at?.props['anchor'], home.reactTag);
  assert.equal(at?.props['stackPresentation'], 'modal');
  let under = home.parent;
  while (under && under.viewName !== 'RNSScreen') under = under.parent;
  assert.equal('anchor' in (under?.props ?? {}), false, 'a screen pushed without one has none');
});
