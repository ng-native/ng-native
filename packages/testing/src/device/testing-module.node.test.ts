/** Where a device test finds `NgNativeTesting`, and what it says when the app has none. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testingModuleFrom } from './testing-module.ts';

const module = { capture: async () => '', captureView: async () => '' };

describe('the testing module', () => {
  it("is the Expo module on iOS and Android, and the desktop host's TurboModule on macOS", () => {
    assert.equal(
      testingModuleFrom({ expoModules: { NgNativeTesting: module }, os: 'ios' }),
      module,
    );
    const asked: string[] = [];
    const turboModule = (name: string) => (
      asked.push(name),
      name === 'NgNativeTesting' ? module : null
    );
    assert.equal(testingModuleFrom({ turboModule, os: 'macos' }), module);
    assert.deepEqual(asked, ['NgNativeTesting']);
  });

  it('says a macOS host needs updating, not a development build rebuilding', () => {
    assert.throws(
      () => testingModuleFrom({ turboModule: () => null, os: 'macos' }),
      (error: Error) =>
        /Update @ng-native\/desktop/.test(error.message) &&
        !/development build/.test(error.message),
    );
  });

  it('says the Linux host does not have it yet', () => {
    assert.throws(() => testingModuleFrom({ os: 'linux' }), /the Linux host does not have yet/);
  });

  it('says to rebuild the development build on iOS and Android', () => {
    assert.throws(
      () => testingModuleFrom({ expoModules: {}, os: 'android' }),
      /Rebuild the development build/,
    );
  });
});
