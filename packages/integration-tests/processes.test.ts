/**
 * `Processes`, which on a desktop OS holds the app's environment, and will run programs the app
 * declares. On mobile and the web it is absent: `env` is empty and `available()` is false.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Processes } from '@ng-native/device';
import { cleanup, injectService } from '@ng-native/testing';

afterEach(cleanup);

describe('Processes', () => {
  it("holds the environment the desktop host's module reports", () => {
    const processes = injectService(Processes, {
      providers: [{ provide: Processes.SOURCE, useValue: { env: { HOME: '/Users/me' } } }],
    });
    assert.equal(processes.available(), true);
    assert.deepEqual(processes.env, { HOME: '/Users/me' });
    assert.ok(Object.isFrozen(processes.env), 'a copy the app cannot change under the host');
  });

  it("reads the environment from the desktop host's NgNativeProcesses module", () => {
    const host = globalThis as Record<string, unknown>;
    host['nativeFabricUIManager'] = {};
    host['require'] = (id: string) => {
      assert.equal(id, 'react-native');
      return {
        TurboModuleRegistry: {
          get: (name: string) =>
            name === 'NgNativeProcesses'
              ? { getConstants: () => ({ env: { LANG: 'en_GB' } }) }
              : null,
        },
      };
    };
    try {
      const provider = (Processes.SOURCE as unknown as { ɵprov: { factory(): unknown } }).ɵprov;
      assert.deepEqual(provider.factory(), { env: { LANG: 'en_GB' } });
    } finally {
      delete host['nativeFabricUIManager'];
      delete host['require'];
    }
  });

  it('is absent without the module, with an empty environment', () => {
    const processes = injectService(Processes);
    assert.equal(processes.available(), false);
    assert.deepEqual(processes.env, {});
  });
});
