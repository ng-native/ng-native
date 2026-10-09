/**
 * react-native-screens keeps a removed screen's views drawn while it animates away, but only once
 * its native module exists: `ScreensModule` installs the listener that starts the transition
 * before the views are unmounted, and React Native makes a module when JavaScript first asks for
 * it. react-native-screens' own JavaScript asks as it is imported. None of it is imported here,
 * so nothing asked, and on Android a sheet was emptied before it slid away.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { registerScreenComponents } from '../router/src/screens.ts';

type Proxy = (name: string) => unknown;
const host = globalThis as { __turboModuleProxy?: Proxy; nativeModuleProxy?: object };

describe("react-native-screens' native module", () => {
  const before = { turbo: host.__turboModuleProxy, legacy: host.nativeModuleProxy };
  afterEach(() => {
    if (before.turbo) host.__turboModuleProxy = before.turbo;
    else delete host.__turboModuleProxy;
    if (before.legacy) host.nativeModuleProxy = before.legacy;
    else delete host.nativeModuleProxy;
  });

  it('is asked for as the screen components are registered, so it is made', () => {
    const asked: string[] = [];
    host.__turboModuleProxy = (name) => (asked.push(name), {});
    registerScreenComponents();
    assert.deepEqual(asked, ['RNSModule']);
  });

  it("is asked for through React Native's other proxy, the only one without the bridge", () => {
    const asked: string[] = [];
    delete host.__turboModuleProxy;
    host.nativeModuleProxy = new Proxy({}, { get: (_, name) => (asked.push(String(name)), {}) });
    registerScreenComponents();
    assert.deepEqual(asked, ['RNSModule']);
  });

  it('is done without where there is no native side to ask, or none that has it', () => {
    delete host.__turboModuleProxy;
    delete host.nativeModuleProxy;
    assert.doesNotThrow(() => registerScreenComponents());
    host.__turboModuleProxy = () => null;
    host.nativeModuleProxy = {};
    assert.doesNotThrow(() => registerScreenComponents());
  });
});
