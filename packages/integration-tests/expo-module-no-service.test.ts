/**
 * An Expo module this package has no service for, wrapped as the package wraps its own: a token
 * whose factory loads the module through `expoModule()`. The example on the Using a module page.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InjectionToken, Injector, inject, runInInjectionContext } from '@angular/core';
import { expoModule } from '@ng-native/expo';

interface NativeContacts {
  getContactsAsync(): Promise<{ data: { name: string }[] }>;
}

declare const require: (id: string) => unknown;

const load = () => expoModule('expo-contacts', () => require('expo-contacts') as NativeContacts);
const CONTACTS = new InjectionToken<NativeContacts | null>('app.contacts', { factory: load });

class People {
  private readonly native = inject(CONTACTS);

  async names(): Promise<string[]> {
    return (await this.native?.getContactsAsync())?.data.map((contact) => contact.name) ?? [];
  }
}

const peopleWith = (providers: object[]) => {
  const injector = Injector.create({ providers: providers as never });
  return runInInjectionContext(injector, () => new People());
};

test('loads in a test, where the module is not there, and does nothing', async () => {
  // The token's own factory, which an injector made here has no root scope to run.
  const people = peopleWith([{ provide: CONTACTS, useFactory: load }]);
  assert.deepEqual(await people.names(), []);
});

test('takes the fake a test provides under the token', async () => {
  const fake: NativeContacts = { getContactsAsync: async () => ({ data: [{ name: 'Ada' }] }) };
  const people = peopleWith([{ provide: CONTACTS, useValue: fake }]);
  assert.deepEqual(await people.names(), ['Ada']);
});
