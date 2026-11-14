/**
 * expo-crypto over the desktop host's `NgNativeCrypto`.
 *
 * A TurboModule passes no typed arrays, so bytes cross as `{base64}` both ways: this turns them
 * into the `Uint8Array` and `ArrayBuffer` expo-crypto answers, and fills `getRandomValues`'s array
 * from the host's random bytes, 1024 at a time, the most one call gives.
 */
import { base64Of, bytesOf } from './base64.ts';
import type { NativeCrypto } from './crypto.ts';

interface Host {
  randomUUID(): string;
  getRandomBytes(count: number): { base64: string };
  digestStringAsync(algorithm: string, data: string, options?: object): Promise<string>;
  digestAsync(algorithm: string, data: { base64: string }): Promise<{ base64: string }>;
}

/** The most bytes the host hands back in one call, as expo-crypto's `getRandomBytes`. */
const MOST = 1024;

/** The bytes a `BufferSource` views. */
function viewOf(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

/** The desktop host's `NgNativeCrypto` in expo-crypto's shape, or null where it has none. */
export function desktopCrypto(): NativeCrypto | null {
  const { TurboModuleRegistry } = require('react-native') as typeof import('react-native');
  const host = TurboModuleRegistry.get('NgNativeCrypto') as Host | null;
  if (!host) return null;
  const randomBytes = (count: number) => bytesOf(host.getRandomBytes(count).base64);
  const crypto = {
    randomUUID: () => host.randomUUID(),
    digestStringAsync: (algorithm: string, data: string, options?: object) =>
      host.digestStringAsync(algorithm, data, options),
    digest: async (algorithm: string, data: ArrayBuffer | ArrayBufferView) => {
      const { base64 } = await host.digestAsync(algorithm, { base64: base64Of(viewOf(data)) });
      const bytes = bytesOf(base64);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    getRandomBytes: randomBytes,
    getRandomBytesAsync: async (count: number) => randomBytes(count),
    getRandomValues: <T extends ArrayBufferView>(array: T) => {
      const target = viewOf(array);
      for (let at = 0; at < target.length; at += MOST) {
        target.set(randomBytes(Math.min(MOST, target.length - at)), at);
      }
      return array;
    },
  };
  return crypto as unknown as NativeCrypto;
}
