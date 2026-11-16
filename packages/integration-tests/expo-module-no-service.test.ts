/**
 * An Expo module this package has no service for, wrapped as the package wraps its own: a token
 * whose factory loads the module through `expoModule()`. The example on the Using a module page.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InjectionToken, Injector, inject, runInInjectionContext } from '@angular/core';
import { expoModule } from '@ng-native/expo';

interface NativeContacts {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  getContactsAsync(): Promise<{ data: { name: string }[] }>;
}

declare const require: (id: string) => unknown;

const load = () =>
  expoModule('expo-contacts', () => require('expo-contacts/legacy') as NativeContacts);
const CONTACTS = new InjectionToken<NativeContacts | null>('app.contacts', { factory: load });

class People {
  private readonly native = inject(CONTACTS);

  async names(): Promise<string[]> {
    const native = this.native;
    if (!native || !(await native.requestPermissionsAsync()).granted) return [];
    return (await native.getContactsAsync()).data.map((contact) => contact.name);
  }
}

const peopleWith = (providers: object[]) => {
  const injector = Injector.create({ providers: providers as never });
  return runInInjectionContext(injector, () => new People());
};

const contacts = (granted: boolean): NativeContacts => ({
  requestPermissionsAsync: async () => ({ granted }),
  getContactsAsync: async () => ({ data: [{ name: 'Ada' }] }),
});

test('loads in a test, where the module is not there, and does nothing', async () => {
  // The token's own factory, which an injector made here has no root scope to run.
  const people = peopleWith([{ provide: CONTACTS, useFactory: load }]);
  assert.deepEqual(await people.names(), []);
});

test('takes the fake a test provides under the token', async () => {
  const people = peopleWith([{ provide: CONTACTS, useValue: contacts(true) }]);
  assert.deepEqual(await people.names(), ['Ada']);
});

test('answers no names when the user refuses access to the contacts', async () => {
  const people = peopleWith([{ provide: CONTACTS, useValue: contacts(false) }]);
  assert.deepEqual(await people.names(), []);
});

test("loads expo-contacts/legacy on a device, since the root's functions throw on SDK 57 and 58", async () => {
  const global = globalThis as Record<string, unknown>;
  const fake = contacts(true);
  global['require'] = (id: string) => {
    if (id === 'react-native') return { Platform: { OS: 'ios' } };
    if (id === 'expo-contacts/legacy') return fake;
    throw new Error(`Cannot find module '${id}'`);
  };
  try {
    const people = peopleWith([{ provide: CONTACTS, useFactory: load }]);
    assert.deepEqual(await people.names(), ['Ada']);
  } finally {
    delete global['require'];
  }
});
