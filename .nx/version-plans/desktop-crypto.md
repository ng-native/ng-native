---
__default__: patch
---

On macOS `Crypto` answers from the desktop host's `NgNativeCrypto`, over CommonCrypto and the system's secure random source: `randomUUID()`, `randomBytes()`, `randomValues()`, `digest()` and `digestString()` with expo-crypto's algorithms, where it threw `MissingModuleError` before.
