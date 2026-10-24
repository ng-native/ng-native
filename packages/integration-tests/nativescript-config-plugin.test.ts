/**
 * `@ng-native/nativescript`'s config plugin, on Android, where `@nativescript/react-native` 9.1.2
 * cannot build or run a minified release on Expo SDK 58: its metadata filtering adds keep rules to
 * a list Android Gradle Plugin 9 makes immutable, and it ships no keep rules for its own runtime, so
 * R8 renames the classes its native code finds by name and the app aborts at launch. Its release
 * bindings task bundles with React Native's CLI, which an Expo app does not have.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

type Property = { type: string; key?: string; value?: string };

const require = createRequire(import.meta.url);
const { releaseProperties } = require('@ng-native/nativescript/app.plugin.cjs') as {
  releaseProperties: (properties: Property[]) => Property[];
};

const value = (properties: Property[], key: string) =>
  properties.filter((entry) => entry.type === 'property' && entry.key === key).map((e) => e.value);

describe("the config plugin's gradle.properties", () => {
  it('turns R8 off in release builds, over the true expo prebuild writes', () => {
    const properties = releaseProperties([
      { type: 'comment', value: ' Enable R8 in release builds' },
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
    ]);
    assert.deepEqual(value(properties, 'android.enableMinifyInReleaseBuilds'), ['false']);
  });

  it("skips NativeScript's release bindings, which need React Native's CLI", () => {
    assert.deepEqual(value(releaseProperties([]), 'nsSkipStaticBindings'), ['true']);
  });

  it("leaves NativeScript's metadata filtering to NativeScript", () => {
    assert.deepEqual(value(releaseProperties([]), 'nsFilterMetadata'), []);
  });

  it('adds nothing run again', () => {
    const once = releaseProperties([
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
    ]);
    assert.deepEqual(releaseProperties(structuredClone(once)), once);
  });
});
