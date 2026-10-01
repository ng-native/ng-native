/**
 * `SecureStorage`, a `Store` over `expo-secure-store`: the keychain and the Android keystore.
 *
 * ```ts
 * private readonly store = inject(SecureStorage);
 * protected readonly token = this.store.signal<string | null>('token', null);
 * ```
 *
 * See `Store` in `@ng-native/expo/store` for what the signal does.
 */
import { InjectionToken } from '@angular/core';
import { expoModule } from './native.ts';
import { Store, type NativeStore } from './store.ts';

const secure = (): NativeStore | null => {
  const expo = expoModule(
    'expo-secure-store',
    () => require('expo-secure-store') as typeof import('expo-secure-store'),
  );
  if (!expo) return null;
  return {
    get: (key) => expo.getItemAsync(key),
    set: (key, value) => expo.setItemAsync(key, value),
    remove: (key) => expo.deleteItemAsync(key),
    // The keychain can answer without waiting, so a token never flashes its default.
    getSync: (key) => expo.getItem(key),
  };
};

/** The keychain and the Android keystore. Small values, and worth the size limit. */
export const SecureStorage = new InjectionToken<Store>('angular-native.secureStorage', {
  factory: () => new Store(secure()),
});
export type SecureStorage = Store;
