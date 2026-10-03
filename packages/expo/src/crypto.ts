/**
 * `Crypto`, bound to `expo-crypto`: random identifiers, random bytes, and hashes.
 *
 * ```ts
 * import { Crypto, CryptoDigestAlgorithm } from '@ng-native/expo/crypto';
 *
 * private readonly crypto = inject(Crypto);
 *
 * readonly id = this.crypto.randomUUID();
 * async fingerprint(text: string): Promise<string> {
 *   return this.crypto.digestString(CryptoDigestAlgorithm.SHA256, text);
 * }
 * ```
 *
 * The module's functions under shorter names, with its own types. Hermes has no Web Crypto, so
 * this is where a UUID or a hash comes from on a device.
 *
 * Unlike the other Expo services, this one is not inert without its module. An empty identifier
 * is a key every record shares, and an empty hash matches every input; neither looks wrong until
 * the data is. So every call without the module throws, naming the package to install.
 */
import { InjectionToken, Service, inject } from '@angular/core';
import type {
  CryptoDigestAlgorithm as ExpoDigestAlgorithm,
  CryptoEncoding as ExpoEncoding,
} from 'expo-crypto';
import { expoModule, unavailable } from './native.ts';

type Expo = typeof import('expo-crypto');

/** The module's functions this service calls. The real module is one; a test provides a fake. */
export type NativeCrypto = Pick<
  Expo,
  | 'randomUUID'
  | 'digestStringAsync'
  | 'digest'
  | 'getRandomBytes'
  | 'getRandomBytesAsync'
  | 'getRandomValues'
>;

type Args<K extends keyof NativeCrypto> = Parameters<NativeCrypto[K]>;

/**
 * The hash algorithms, as `expo-crypto`'s own enum. Importing the enum from the module loads the
 * module, which a test in Node cannot; these are the same strings, typed as the enum.
 */
export const CryptoDigestAlgorithm = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA384: 'SHA-384',
  SHA512: 'SHA-512',
  MD2: 'MD2',
  MD4: 'MD4',
  MD5: 'MD5',
} as unknown as typeof ExpoDigestAlgorithm;

/** How `digestString` writes its hash, as `expo-crypto`'s own enum: hex unless asked otherwise. */
export const CryptoEncoding = {
  HEX: 'hex',
  BASE64: 'base64',
} as unknown as typeof ExpoEncoding;

@Service()
export class Crypto {
  /** Overridden in a test to hand out identifiers that are not random. */
  static readonly SOURCE = new InjectionToken<NativeCrypto | null>('angular-native.cryptoSource', {
    factory: () => expoModule('expo-crypto', () => require('expo-crypto') as Expo),
  });

  private readonly native = inject(Crypto.SOURCE);

  /** A version 4 UUID, from the platform's secure random source. */
  randomUUID(): string {
    return this.module().randomUUID();
  }

  /** The hash of a string, as hex or base64. */
  async digestString(...args: Args<'digestStringAsync'>): Promise<string> {
    return this.module().digestStringAsync(...args);
  }

  /** The hash of bytes, as Web Crypto's `digest` answers it. */
  async digest(...args: Args<'digest'>): Promise<ArrayBuffer> {
    return this.module().digest(...args);
  }

  /** Cryptographically secure random bytes, between 0 and 1024 of them. */
  randomBytes(count: number): Uint8Array {
    return this.module().getRandomBytes(count);
  }

  /** The same, as a promise. */
  async randomBytesAsync(count: number): Promise<Uint8Array> {
    return this.module().getRandomBytesAsync(count);
  }

  /** Fills an integer typed array with secure random values and hands it back, as Web Crypto's. */
  randomValues<T extends Args<'getRandomValues'>[0]>(array: T): T {
    return this.module().getRandomValues(array);
  }

  private module(): NativeCrypto {
    if (!this.native) throw unavailable('expo-crypto', 'Provide Crypto.SOURCE with a stand-in.');
    return this.native;
  }
}
