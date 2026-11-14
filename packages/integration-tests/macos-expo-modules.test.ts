/**
 * What a `macos` bundle's `import ... from 'expo'` gives Expo's own JavaScript libraries, where no
 * Expo native module is: `@expo/ui`'s modifiers call `requireNativeModule('ExpoUI')` as they load,
 * and an app that imports them (to style the host's own `@expo/ui` views) must still load.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const expo = require('@ng-native/metro/macos/expo-modules.js') as {
  requireNativeModule(name: string): Record<string, unknown>;
  requireOptionalNativeModule(name: string): unknown;
  requireNativeView(name: string): (...args: unknown[]) => unknown;
  useReleasingSharedObject(...args: unknown[]): unknown;
  useReleasingSharedObjectWithLifecycle(...args: unknown[]): unknown;
  installOnUIRuntime(...args: unknown[]): unknown;
};

describe("expo's native-module functions in a macos bundle", () => {
  it('load a module without throwing, and fail when it is used, naming it', () => {
    const module = expo.requireNativeModule('ExpoUI');
    assert.throws(() => (module['completeRefresh'] as () => void)(), /ExpoUI.*completeRefresh/);
    // What a promise or a module interop looks for is simply absent.
    assert.equal(module['then'], undefined);
    assert.equal(module['__esModule'], undefined);
  });

  it('answer no optional module', () => {
    assert.equal(expo.requireOptionalNativeModule('ExpoUI'), null);
  });

  it('give a native view that fails only when it is drawn', () => {
    const view = expo.requireNativeView('ExpoUI');
    assert.equal(typeof view, 'function');
    assert.throws(() => view({}), /ExpoUI/);
  });

  it('fail the shared-object hooks only when called, and install nothing on a UI runtime', () => {
    assert.throws(() => expo.useReleasingSharedObject(() => ({}), []), /shared object/);
    assert.throws(
      () => expo.useReleasingSharedObjectWithLifecycle(() => ({}), []),
      /shared object/,
    );
    assert.doesNotThrow(() => expo.installOnUIRuntime({}));
  });
});
