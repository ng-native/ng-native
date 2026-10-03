---
title: Crypto
summary: Random UUIDs, secure random bytes and hashes, where Hermes has no Web Crypto.
---

# Crypto

`Crypto` is random identifiers, secure random bytes and hashes, bound to `expo-crypto`. Hermes has
no Web Crypto, so `crypto.randomUUID()` is not there on a device; this is where a UUID or a SHA-256
comes from instead.

It is the one Expo service that is not inert without its module. An empty identifier is a key
every record shares, and an empty hash matches every input, and neither looks wrong until the data
is. So without `expo-crypto` installed, every call throws, and the error names the package.

## Install

```sh
npx expo install expo-crypto
```

```ts
import { Crypto, CryptoDigestAlgorithm, CryptoEncoding } from '@ng-native/expo/crypto';
```

## The smallest useful example

```ts
import { Component, inject, signal } from '@angular/core';
import { Crypto, CryptoDigestAlgorithm } from '@ng-native/expo/crypto';

@Component({
  selector: 'app-new-note',
  template: `<pressable (press)="create()"
    ><text>New note {{ id() }}</text></pressable
  >`,
})
export class NewNote {
  private readonly crypto = inject(Crypto);
  protected readonly id = signal('');

  protected async create(): Promise<void> {
    this.id.set(this.crypto.randomUUID());
    console.log(await this.crypto.digestString(CryptoDigestAlgorithm.SHA256, this.id()));
  }
}
```

## What it does

- **`randomUUID()`** - a version 4 UUID from the platform's secure random source.
- **`digestString(algorithm, text, options?)`** - the hash of a string, as hex by default or
  base64 with `{ encoding: CryptoEncoding.BASE64 }`.
- **`digest(algorithm, bytes)`** - the hash of bytes as an `ArrayBuffer`, as Web Crypto's `digest`
  answers it.
- **`randomBytes(count)`** and **`randomBytesAsync(count)`** - between 0 and 1024 secure random
  bytes, as a `Uint8Array`.
- **`randomValues(array)`** - fills an integer typed array with secure random values in place and
  hands it back, as Web Crypto's `getRandomValues` does.

`CryptoDigestAlgorithm` (`SHA1`, `SHA256`, `SHA384`, `SHA512`, `MD5`, and on iOS `MD2` and `MD4`)
and `CryptoEncoding` are exported beside the service: the module's own enums, typed as those
enums, without loading the module, so code that hashes can run in a test.

AES encryption is not part of the service. `aesEncryptAsync` and `aesDecryptAsync` take a key and
sealed data that only the module's own `AESEncryptionKey` and `AESSealedData` classes make, so code
that encrypts imports `expo-crypto` directly.

## Without the module

On iOS and Android, a missing `expo-crypto` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, every method throws, or rejects for the
promise-returning ones, with an error naming `expo-crypto`.

## In a test

Node has no native modules, so in a test `Crypto` throws when it is first used, saying so. Provide
`Crypto.SOURCE` with the methods the code under test calls:

```ts
const ids = injectService(Ids, {
  providers: [{ provide: Crypto.SOURCE, useValue: { randomUUID: () => 'test-id' } }],
});
```

## Reference

<!-- api: Crypto -->
