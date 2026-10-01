/**
 * `Storage`, a `Store` over `@react-native-async-storage/async-storage`: a plain key-value file.
 *
 * ```ts
 * private readonly store = inject(Storage);
 * protected readonly theme = this.store.signal<'light' | 'dark'>('theme', 'light');
 * ```
 *
 * See `Store` in `@ng-native/expo/store` for what the signal does.
 */
import { InjectionToken } from '@angular/core';
import { expoModule } from './native.ts';
import { Store, type NativeStore } from './store.ts';

const plain = (): NativeStore | null => {
  const module = expoModule(
    '@react-native-async-storage/async-storage',
    () =>
      require('@react-native-async-storage/async-storage') as {
        default: typeof import('@react-native-async-storage/async-storage').default;
      },
  );
  const store = module?.default;
  if (!store) return null;
  return {
    get: (key) => store.getItem(key),
    set: (key, value) => store.setItem(key, value),
    remove: (key) => store.removeItem(key),
  };
};

/** A plain key-value file. Bigger and faster than the keychain, and not private. */
export const Storage = new InjectionToken<Store>('angular-native.storage', {
  factory: () => new Store(plain()),
});
export type Storage = Store;
