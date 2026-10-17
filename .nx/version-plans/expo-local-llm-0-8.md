---
__default__: patch
---

`@ng-native/expo` takes `expo-local-llm` 0.8.1, whose Android side now uses ML Kit's published Prompt API, so an Android build with the module in it resolves again. An app on `expo-local-llm` 0.6 has to update it, since the optional peer range is now `^0.8.1`, which does not include 0.6: run `npx expo install expo-local-llm@^0.8.1`.

`LanguageModel` treats the module as available on Android as well as iOS. An Android build without its native half, such as one that excludes it from autolinking, still reports `notInstalled`, but `download()` there now throws a `MissingModuleError` instead of doing nothing.

On Android the module needs `minSdkVersion` 26; the language model page says how to raise it with `expo-build-properties`, or how to keep the module out of the Android build instead. `generateObject()` rejects on Android, where `expo-local-llm` 0.7 and later refuse a schema, and `maxTokens` is no longer capped at 256 there. On Android, `refresh()` and the check before each call return the module's last reading, which is `unknown` until its first check after launch; follow the `availability` signal there.
