/**
 * The platform modules on macOS, each through its service and the desktop host's TurboModule:
 * the JS adapters that turn what a TurboModule can pass (`{base64}` for bytes, events on
 * `DeviceEventEmitter` for listeners) into the shapes the Expo packages answer.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { injectService } from '@ng-native/testing';

type Listener = (event: unknown) => void;

/** A Mac whose desktop host registers `modules`, with the events the host sends on `send`. */
function mac(modules: Record<string, object>) {
  const listeners = new Map<string, Set<Listener>>();
  (globalThis as Record<string, unknown>)['require'] = (id: string) => {
    if (id !== 'react-native') throw new Error(`Cannot find module '${id}'`);
    return {
      Platform: { OS: 'macos' },
      TurboModuleRegistry: { get: (name: string) => modules[name] ?? null },
      DeviceEventEmitter: {
        addListener: (event: string, listener: Listener) => {
          const set = listeners.get(event) ?? new Set();
          listeners.set(event, set);
          set.add(listener);
          return { remove: () => void set.delete(listener) };
        },
      },
      Image: {
        resolveAssetSource: (id: number) => ({
          uri: `http://localhost:8081/assets/font-${id}.ttf`,
        }),
      },
    };
  };
  return {
    send: (event: string, body: unknown) => listeners.get(event)?.forEach((l) => l(body)),
    listening: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['require'];
});

describe('Crypto on macOS', () => {
  function host() {
    const calls: unknown[][] = [];
    mac({
      NgNativeCrypto: {
        randomUUID: () => 'a-uuid',
        getRandomBytes: (count: number) => {
          calls.push(['getRandomBytes', count]);
          return { base64: Buffer.alloc(count, 7).toString('base64') };
        },
        digestStringAsync: async (...args: unknown[]) => (
          calls.push(['digestString', ...args]),
          'ab'
        ),
        digestAsync: async (...args: unknown[]) => (
          calls.push(['digest', ...args]),
          { base64: 'AQID' }
        ),
      },
    });
    return calls;
  }

  it('answers bytes as a Uint8Array, and a digest as an ArrayBuffer', async () => {
    const calls = host();
    const { Crypto, CryptoDigestAlgorithm } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    assert.equal(crypto.available(), true);
    assert.equal(crypto.randomUUID(), 'a-uuid');
    const bytes = crypto.randomBytes(3);
    assert.ok(bytes instanceof Uint8Array);
    assert.deepEqual([...bytes], [7, 7, 7]);
    assert.deepEqual([...(await crypto.randomBytesAsync(2))], [7, 7]);
    const digest = await crypto.digest(CryptoDigestAlgorithm.SHA256, new Uint8Array([9, 8]));
    assert.ok(digest instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(digest)], [1, 2, 3]);
    assert.deepEqual(calls.at(-1), ['digest', 'SHA-256', { base64: 'CQg=' }]);
    assert.equal(await crypto.digestString(CryptoDigestAlgorithm.SHA1, 'x'), 'ab');
    assert.deepEqual(calls.at(-1), ['digestString', 'SHA-1', 'x', undefined]);
  });

  it('digests the bytes a view covers, not its whole buffer', async () => {
    const calls = host();
    const { Crypto, CryptoDigestAlgorithm } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    const whole = new Uint8Array([1, 2, 3, 4]);
    await crypto.digest(CryptoDigestAlgorithm.SHA256, whole.subarray(1, 3));
    assert.deepEqual(calls.at(-1), ['digest', 'SHA-256', { base64: 'AgM=' }]);
  });

  it('fills getRandomValues 1024 bytes at a time', async () => {
    const calls = host();
    const { Crypto } = await import('@ng-native/expo/crypto');
    const crypto = injectService(Crypto);
    const array = new Uint16Array(1000);
    assert.equal(crypto.randomValues(array), array);
    assert.ok(array.every((value) => value === 0x0707));
    assert.deepEqual(calls, [
      ['getRandomBytes', 1024],
      ['getRandomBytes', 976],
    ]);
  });
});

describe('Network on macOS', () => {
  it('reads the state from NgNativeNetwork and follows its ngNativeNetwork events', async () => {
    const host = mac({
      NgNativeNetwork: {
        getNetworkStateAsync: async () => ({
          type: 'WIFI',
          isConnected: true,
          isInternetReachable: true,
        }),
      },
    });
    const { Network } = await import('@ng-native/expo/network');
    const network = injectService(Network);
    assert.equal(network.available(), true);
    await new Promise((resolve) => setTimeout(resolve));
    assert.deepEqual(network.status(), { connected: true, type: 'wifi', reachable: true });
    assert.equal(host.listening('ngNativeNetwork'), 1);
    host.send('ngNativeNetwork', { type: 'NONE', isConnected: false, isInternetReachable: false });
    assert.deepEqual(network.status(), { connected: false, type: 'none', reachable: false });
  });
});

describe('Battery on macOS', () => {
  it('reads NgNativeBattery and follows each kind of ngNativeBattery event', async () => {
    const host = mac({
      NgNativeBattery: {
        getBatteryLevelAsync: async () => 0.5,
        getBatteryStateAsync: async () => 1,
        isLowPowerModeEnabledAsync: async () => false,
        isAvailableAsync: async () => true,
      },
    });
    const { Battery } = await import('@ng-native/expo/battery');
    const battery = injectService(Battery);
    assert.equal(battery.available(), true);
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(battery.level(), 0.5);
    assert.equal(battery.state(), 'unplugged');
    assert.equal(battery.saving(), false);
    assert.equal(host.listening('ngNativeBattery'), 3);
    host.send('ngNativeBattery', { type: 'level', batteryLevel: 0.1 });
    assert.equal(battery.level(), 0.1);
    assert.equal(battery.low(), true);
    host.send('ngNativeBattery', { type: 'state', batteryState: 2 });
    assert.equal(battery.state(), 'charging');
    host.send('ngNativeBattery', { type: 'lowPowerMode', lowPowerMode: true });
    assert.equal(battery.saving(), true);
    assert.equal(battery.level(), 0.1);
    // Held below full on the adapter reads as full, as expo-battery's NOT_CHARGING does.
    host.send('ngNativeBattery', { type: 'state', batteryState: 4 });
    assert.equal(battery.state(), 'full');
  });

  it('reads a Mac with no battery as a level not known, and never low', async () => {
    mac({
      NgNativeBattery: {
        getBatteryLevelAsync: async () => -1,
        getBatteryStateAsync: async () => 0,
        isLowPowerModeEnabledAsync: async () => false,
      },
    });
    const { Battery } = await import('@ng-native/expo/battery');
    const battery = injectService(Battery);
    await new Promise((resolve) => setTimeout(resolve));
    assert.equal(battery.known(), false);
    assert.equal(battery.level(), 1);
    assert.equal(battery.state(), 'unknown');
    assert.equal(battery.low(), false);
  });
});
