/**
 * `setAudioMode()`: expo-audio's own `setAudioModeAsync` on iOS, the desktop host's `NgNativeAudio`
 * on macOS, where expo-audio is an empty module, and nothing where neither is there.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setAudioMode } from '@ng-native/expo/audio';

function withModules(modules: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`Cannot find module '${id}'`);
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

describe('setAudioMode', () => {
  it("sets the mode through expo-audio's setAudioModeAsync on iOS", async () => {
    const modes: unknown[] = [];
    withModules({
      'react-native': { Platform: { OS: 'ios' } },
      'expo-audio': { setAudioModeAsync: async (mode: unknown) => void modes.push(mode) },
    });
    await setAudioMode({ playsInSilentMode: true });
    assert.deepEqual(modes, [{ playsInSilentMode: true }]);
  });

  it("hands the mode to the desktop host's NgNativeAudio on macOS", async () => {
    const modes: unknown[] = [];
    withModules({
      'react-native': {
        Platform: { OS: 'macos' },
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeAudio'
              ? { setAudioModeAsync: async (mode: unknown) => void modes.push(mode) }
              : null,
        },
      },
      'expo-audio': {
        setAudioModeAsync: () => assert.fail('expo-audio is an empty module on macOS'),
      },
    });
    await setAudioMode({ allowsRecording: true });
    assert.deepEqual(modes, [{ allowsRecording: true }]);
  });

  it('says to rebuild the desktop host on macOS without NgNativeAudio', async () => {
    withModules({
      'react-native': { Platform: { OS: 'macos' }, TurboModuleRegistry: { get: () => null } },
    });
    await assert.rejects(setAudioMode({ allowsRecording: true }), {
      name: 'MissingModuleError',
    });
  });

  it('does nothing, and resolves, where there is no audio module', async () => {
    withModules({});
    await setAudioMode({ playsInSilentMode: true });
  });
});
