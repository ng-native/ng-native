import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { registerPlatformComponents, registeredViewName } from '@ng-native/fabric';
import { EXPO_UI_MACOS, registerExpoUiViews } from '@ng-native/expo';
import { EXPO_UI_VIEWS } from '../expo/src/expo-ui.ts';

/** Every view ng-native commits for `@expo/ui` on iOS. */
const iosNames = new Set(
  Object.values(EXPO_UI_VIEWS)
    .map(([ios]) => ios)
    .filter((name): name is string => name !== null),
);

const onMac = Object.entries(EXPO_UI_MACOS)
  .filter(([, entry]) => 'swiftUI' in entry)
  .map(([name]) => name)
  .sort();

/** The views the desktop host registers, from its list in the core. */
function hostViews(): string[] {
  const source = readFileSync(
    new URL('../desktop/native/core/src/expo-ui.cpp', import.meta.url),
    'utf8',
  );
  const list = /kExpoUIViews\[\] = \{([^}]*)\}/.exec(source);
  assert.ok(list, 'kExpoUIViews is in expo-ui.cpp');
  return [...list[1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!).sort();
}

describe('@expo/ui on macOS', () => {
  it('maps every iOS view to a SwiftUI view or to a reason it is absent', () => {
    for (const name of iosNames) {
      const entry = EXPO_UI_MACOS[name];
      assert.ok(entry, `${name} has no macOS entry`);
      if ('absent' in entry) assert.ok(entry.absent.length > 20, `${name} says why it is absent`);
      else assert.ok(entry.swiftUI.length > 0, `${name} names its SwiftUI view`);
    }
    for (const name of Object.keys(EXPO_UI_MACOS)) {
      assert.ok(iosNames.has(name), `${name} is not a view ng-native commits on iOS`);
    }
  });

  it('is the list of views the desktop host draws', () => {
    assert.deepEqual(hostViews(), onMac);
  });

  it('registers the views in v1 under their iOS names, and leaves the absent ones plain', () => {
    try {
      registerPlatformComponents('macos');
      registerExpoUiViews('macos');
      assert.equal(registeredViewName('ui-picker'), 'ViewManagerAdapter_ExpoUI_PickerView');
      assert.equal(
        registeredViewName('ui-date-picker'),
        'ViewManagerAdapter_ExpoUI_DatePickerView',
      );
      assert.equal(registeredViewName('ui-host'), 'ViewManagerAdapter_ExpoUI_HostView');
      assert.equal(registeredViewName('ui-sync-toggle'), undefined);
      assert.equal(registeredViewName('ui-toolbar'), undefined);
      // Android's own views stay unregistered too.
      assert.equal(registeredViewName('ui-checkbox'), undefined);
    } finally {
      registerPlatformComponents('ios');
      registerExpoUiViews('ios');
    }
  });
});
