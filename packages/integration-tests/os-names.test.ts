/**
 * One list of OS names: the `OS` token answers each OS in `OS_NAMES` as itself, and an OS the host
 * reports that is not in it is an error that names it, never iOS by default.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Injector, ɵINJECTOR_SCOPE as INJECTOR_SCOPE } from '@angular/core';
import { Menus, OS, OS_NAMES } from '@ng-native/device';
import { registerPlatformComponents } from '@ng-native/fabric';

/** A root injector of an app's own, as `OS` and `Menus` are made in. */
const root = () => Injector.create({ providers: [{ provide: INJECTOR_SCOPE, useValue: 'root' }] });

describe('the OS the host reports', () => {
  after(() => registerPlatformComponents('ios'));

  it('is each OS in OS_NAMES as itself', () => {
    for (const os of OS_NAMES) {
      registerPlatformComponents(os);
      assert.equal(root().get(OS), os);
    }
  });

  it("is an error naming an OS not in OS_NAMES, where it used to read as 'ios'", () => {
    registerPlatformComponents('windows');
    assert.throws(() => root().get(OS), /reports the OS 'windows'.*ios, android, macos, web/);
  });

  it('is an error for the shortcuts too, which read an unknown OS as iOS, with Cmd', () => {
    registerPlatformComponents('windows');
    assert.throws(() => root().get(Menus), /reports the OS 'windows'/);
  });
});
