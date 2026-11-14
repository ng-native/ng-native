/**
 * `expoModule` on a desktop OS. Every `expo-*` package resolves to an empty module there, so an
 * Expo module's loader is never called: the module is the desktop host's TurboModule the call
 * names with `desktop`, or nothing.
 *
 * The platform is `react-native`'s, reached through the same bare `require` the modules are, which
 * a test defines on the global and removes again.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { MissingModuleError, expoModule } from '@ng-native/expo';

/** A device on `os` whose desktop host registers the TurboModules in `registered`. */
function on(os: string, registered: Record<string, object> = {}): void {
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id === 'react-native') {
      return {
        Platform: { OS: os },
        TurboModuleRegistry: { get: (name: string) => registered[name] ?? null },
      };
    }
    throw new Error(`Cannot find module '${id}'`);
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

/** A loader that records being called, and answers a module. */
function loader() {
  const calls: string[] = [];
  return { calls, load: () => (calls.push('load'), { from: 'expo' }) };
}

describe('expoModule on macOS', () => {
  it('never calls the Expo loader', () => {
    on('macos');
    const { calls, load } = loader();
    expoModule('expo-haptics', load);
    expoModule('expo-haptics', load, ['ios', 'android', 'web']);
    expoModule('expo-haptics', load, { desktop: 'NgNativeHaptics' });
    assert.deepEqual(calls, []);
  });

  it('is null without a desktop module, so the service is inert', () => {
    on('macos', { NgNativeHaptics: { from: 'desktop' } });
    assert.equal(expoModule('expo-haptics', loader().load), null);
    assert.equal(expoModule('expo-haptics', loader().load, { platforms: ['ios'] }), null);
  });

  it("answers the desktop host's TurboModule the call names", () => {
    const desktop = { from: 'desktop' };
    on('macos', { NgNativeHaptics: desktop });
    assert.equal(
      expoModule('expo-haptics', loader().load, { desktop: 'NgNativeHaptics' }),
      desktop,
    );
  });

  it('says to rebuild the desktop host when the named module is not in it', () => {
    on('macos');
    const found = expoModule('expo-haptics', loader().load, { desktop: 'NgNativeHaptics' });
    assert.ok(found, 'a stand-in, which throws when it is used');
    assert.throws(
      () => (found as Record<string, unknown>)['impactAsync'],
      (error: unknown) =>
        error instanceof MissingModuleError &&
        error.module === 'expo-haptics' &&
        /npm run macos/.test(error.message) &&
        !/npx expo run:/.test(error.message),
    );
  });
});

describe('expoModule with an options object', () => {
  it('takes platforms as the array form does', () => {
    on('android');
    const { calls, load } = loader();
    assert.deepEqual(expoModule('expo-x', load, { platforms: ['ios', 'android'] }), {
      from: 'expo',
    });
    on('web');
    assert.equal(
      expoModule('expo-x', () => null, { platforms: ['ios', 'android'] }),
      null,
      'inert where the module cannot exist',
    );
    on('ios');
    const missing = expoModule<object>('expo-x', () => null, { platforms: ['ios'] });
    assert.throws(() => (missing as unknown as Record<string, unknown>)['a'], MissingModuleError);
    assert.deepEqual(calls, ['load']);
  });

  it('still loads the Expo module on iOS and Android when it names a desktop one', () => {
    on('ios', { NgNativeHaptics: { from: 'desktop' } });
    assert.deepEqual(expoModule('expo-x', loader().load, { desktop: 'NgNativeHaptics' }), {
      from: 'expo',
    });
  });
});
