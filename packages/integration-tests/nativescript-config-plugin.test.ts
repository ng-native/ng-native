/**
 * `@ng-native/nativescript`'s config plugin, on Android: NativeScript's metadata filtering adds
 * keep rules to a release build's ProGuard files, a list Android Gradle Plugin 9 (Expo SDK 58)
 * makes immutable, and the build fails with UnsupportedOperationException in nativescript.gradle
 * whenever release minification is on, which SDK 58 turns on by default.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { withoutMetadataFilter } = require('@ng-native/nativescript/app.plugin.cjs') as {
  withoutMetadataFilter: (
    properties: { type: string; key?: string; value?: string }[],
  ) => { type: string; key?: string; value?: string }[];
};

describe("the config plugin's gradle.properties", () => {
  it("turns NativeScript's metadata filtering off", () => {
    const properties = withoutMetadataFilter([
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
    ]);
    assert.deepEqual(properties.at(-1), {
      type: 'property',
      key: 'nsFilterMetadata',
      value: 'false',
    });
  });

  it('keeps a value the app sets itself, and adds nothing run again', () => {
    const own = [{ type: 'property', key: 'nsFilterMetadata', value: 'true' }];
    assert.deepEqual(withoutMetadataFilter(structuredClone(own)), own);
    const once = withoutMetadataFilter([]);
    assert.deepEqual(withoutMetadataFilter(structuredClone(once)), once);
  });
});
