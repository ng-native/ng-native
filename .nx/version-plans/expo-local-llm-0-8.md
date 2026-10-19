---
__default__: patch
---

`@ng-native/expo` takes `expo-local-llm` 0.8.1, whose Android side uses ML Kit's published Prompt API, so an Android build with the module in it resolves again.

`LanguageModel` treats the module as available on Android as well as iOS: a build without its native
half there reports `notInstalled`, as on iOS.

On Android the module needs `minSdkVersion` 26; the language model page says how to raise it with
`expo-build-properties`, or how to keep the module out of the Android build instead.
`generateObject()` rejects on Android, where `expo-local-llm` 0.7 and later refuse a schema, and
`maxTokens` is no longer capped at 256 there.
