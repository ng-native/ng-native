/**
 * Linux as an OS: the `OS` token says `'linux'`, `DESKTOP` is true and `APPLE` false, and the
 * engine draws Linux with iOS's view names less the ones the desktop host has none of, as on macOS.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  Injector,
  type ProviderToken,
  type StaticProvider,
  ɵINJECTOR_SCOPE as INJECTOR_SCOPE,
} from '@angular/core';
import { APPLE, DESKTOP, Dock, OS, Vibration, type NativeDock } from '@ng-native/device';
import {
  isApplePlatform,
  nativePlatform,
  registerPlatformComponents,
  viewNameOf,
} from '@ng-native/fabric';

const element = (tag: string) => ({ nodeKind: 'element' as const, tag, parent: null });

/** What `token` answers in an app's root injector of its own, with `providers` in it. */
function read<T>(token: ProviderToken<T>, providers: StaticProvider[] = []): T {
  return Injector.create({
    providers: [{ provide: INJECTOR_SCOPE, useValue: 'root' }, ...providers],
  }).get(token);
}

describe('the OS on Linux', () => {
  after(() => registerPlatformComponents('ios'));

  it("is 'linux'", () => {
    registerPlatformComponents('linux');
    assert.equal(read(OS), 'linux');
  });

  it('is a desktop, and not an Apple OS', () => {
    const linux = [{ provide: OS, useValue: 'linux' }];
    assert.equal(read(DESKTOP, linux), true);
    assert.equal(read(APPLE, linux), false);
    registerPlatformComponents('linux');
    assert.equal(isApplePlatform(), false);
  });

  it('has nothing to vibrate, as on a Mac, where a phone does', () => {
    const motor = { vibrate: () => {}, cancel: () => {} };
    const on = (os: string) =>
      read(Vibration, [
        { provide: OS, useValue: os },
        { provide: Vibration.SOURCE, useValue: motor },
      ]).available();
    assert.equal(on('linux'), false);
    assert.equal(on('macos'), false);
    assert.equal(on('android'), true);
  });
});

describe('the Dock menu on Linux', () => {
  it('reads mod as Ctrl, where a Mac reads it as Cmd', () => {
    const sentOn = (os: string) => {
      let sent: unknown = null;
      const native: NativeDock = {
        setMenu: (entries) => void (sent = entries),
        bounce: () => 0,
        cancelBounce: () => {},
        subscribe: () => () => {},
      };
      read(Dock, [
        { provide: OS, useValue: os },
        { provide: Dock.SOURCE, useValue: native },
      ]).setMenu([{ label: 'Save', shortcut: 'mod+s', select: () => {} }]);
      return (sent as { shortcut: { ctrl: boolean; meta: boolean } }[])[0]!.shortcut;
    };
    assert.deepEqual([sentOn('linux').ctrl, sentOn('linux').meta], [true, false]);
    assert.deepEqual([sentOn('macos').ctrl, sentOn('macos').meta], [false, true]);
  });
});

describe('view names on Linux', () => {
  after(() => registerPlatformComponents('ios'));

  it("are iOS's, even after Android's were in place", () => {
    registerPlatformComponents('android');
    registerPlatformComponents('linux');
    assert.equal(nativePlatform(), 'linux');
    assert.equal(viewNameOf(element('switch')), 'Switch');
    assert.equal(viewNameOf(element('text-input')), 'TextInput');
  });

  it('draw the views only an iPhone has as plain ones, as on a Mac, and give them back to iOS', () => {
    registerPlatformComponents('linux');
    assert.equal(viewNameOf(element('refresh-control')), 'View');
    assert.equal(viewNameOf(element('input-accessory-view')), 'View');
    registerPlatformComponents('ios');
    assert.equal(viewNameOf(element('refresh-control')), 'PullToRefreshView');
  });
});
