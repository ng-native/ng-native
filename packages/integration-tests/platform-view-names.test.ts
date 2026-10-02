/**
 * View names that differ by platform, however the app orders its startup.
 *
 * An app's `main.ts` reports the platform with `registerPlatformComponents(Platform.OS)`, but its
 * imports run first, and the app config among them calls `provideNativeRouter()`, which registers
 * the router's views. A name chosen then was chosen for iOS, the default, so an Android app asked
 * Fabric for `RNSFullWindowOverlay`, which only iOS has, and crashed as it opened.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registerPlatformComponents, viewNameOf } from '@ng-native/fabric';
import { provideNativeRouter } from '@ng-native/router';

const element = (name: string) => ({ kind: 'element' as const, name, parent: null });

describe('a view name registered before the platform is known', () => {
  it('is the Android one once Android is reported, as main.ts reports it after its imports', () => {
    provideNativeRouter([]);
    assert.equal(viewNameOf(element('full-window-overlay')), 'RNSFullWindowOverlay');
    registerPlatformComponents('android');
    assert.equal(viewNameOf(element('full-window-overlay')), 'RCTView');
    assert.equal(viewNameOf(element('native-tabs-outlet')), 'RNSTabsHostAndroid');
    assert.equal(viewNameOf(element('native-tab')), 'RNSTabsScreenAndroid');
  });
});

describe('reporting a platform again', () => {
  it("puts back iOS's names once iOS is reported after Android, as a test resetting does", () => {
    registerPlatformComponents('android');
    assert.equal(viewNameOf(element('switch')), 'AndroidSwitch');
    registerPlatformComponents('ios');
    assert.equal(viewNameOf(element('switch')), 'Switch');
    assert.equal(viewNameOf(element('text-input')), 'TextInput');
    assert.equal(viewNameOf(element('safe-area-view')), 'SafeAreaView');
  });
});
