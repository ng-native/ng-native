/**
 * A test's fake for `Storage`: a `Store` over a map, provided under the token. The example on the
 * storage page.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Injector } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import { Store } from '@ng-native/expo/store';

test('a Store over a map starts from a stored value and shows what was written', async () => {
  const disk = new Map([['theme', JSON.stringify('dark')]]);
  const storage = new Store({
    get: async (key) => disk.get(key) ?? null,
    set: async (key, value) => void disk.set(key, value),
    remove: async (key) => void disk.delete(key),
  });
  const injector = Injector.create({ providers: [{ provide: Storage, useValue: storage }] });

  const theme = injector.get(Storage).signal('theme', 'system');
  assert.equal(theme(), 'system', 'the initial value, until the read is back');
  // A task later, which is sooner than `render()` resolves.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(theme(), 'dark');

  theme.set('light');
  await storage.flush();
  assert.equal(disk.get('theme'), '"light"', 'stored as JSON text');
});
