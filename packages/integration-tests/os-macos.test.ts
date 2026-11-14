/**
 * macOS as an OS: the `OS` token says `'macos'` rather than folding it into `'ios'`, `DESKTOP`
 * follows `OS` so the two cannot disagree, and the engine draws macOS with iOS's view names, which
 * the desktop host implements.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  Injector,
  type ProviderToken,
  type StaticProvider,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
} from '@angular/core';
import { DESKTOP, OS } from '@ng-native/device';
import {
  isApplePlatform,
  nativePlatform,
  registerPlatformComponents,
  viewNameOf,
} from '@ng-native/fabric';
import { provideNativeRouter } from '@ng-native/router';

const element = (tag: string) => ({ nodeKind: 'element' as const, tag, parent: null });

/** What `token` answers in an app's root injector of its own, with `providers` in it. */
function read<T>(token: ProviderToken<T>, providers: StaticProvider[] = []): T {
  return Injector.create({
    providers: [{ provide: INJECTOR_SCOPE, useValue: 'root' }, ...providers],
  }).get(token);
}

describe('the OS on a Mac', () => {
  after(() => registerPlatformComponents('ios'));

  it("is 'macos', where it used to read as 'ios'", () => {
    registerPlatformComponents('macos');
    assert.equal(read(OS), 'macos');
  });

  it('is a desktop, and iOS, Android and the web are not', () => {
    for (const [os, desktop] of [
      ['macos', true],
      ['ios', false],
      ['android', false],
      ['web', false],
    ] as const) {
      assert.equal(read(DESKTOP, [{ provide: OS, useValue: os }]), desktop, os);
    }
  });

  it('is an Apple platform, as iOS is and Android is not', () => {
    for (const [os, apple] of [
      ['macos', true],
      ['ios', true],
      ['android', false],
    ] as const) {
      registerPlatformComponents(os);
      assert.equal(isApplePlatform(), apple, os);
    }
  });
});

describe('view names on a Mac', () => {
  after(() => registerPlatformComponents('ios'));

  it("are iOS's, even after Android's were in place", () => {
    registerPlatformComponents('android');
    registerPlatformComponents('macos');
    assert.equal(nativePlatform(), 'macos');
    assert.equal(viewNameOf(element('switch')), 'Switch');
    assert.equal(viewNameOf(element('text-input')), 'TextInput');
    assert.equal(viewNameOf(element('activity-indicator')), 'ActivityIndicatorView');
  });

  it('draw the full-window overlay as a plain view, which is all a Mac window needs', () => {
    provideNativeRouter([]);
    registerPlatformComponents('macos');
    assert.equal(viewNameOf(element('full-window-overlay')), 'RCTView');
    registerPlatformComponents('ios');
    assert.equal(viewNameOf(element('full-window-overlay')), 'RNSFullWindowOverlay');
  });
});
