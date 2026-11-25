---
__default__: patch
---

`@ng-native/testing` adds `fakeLanguageModel()`, a scripted on-device model to provide as `LanguageModel.SOURCE`, so a test can cover a chat or a service built on `@ng-native/expo/language-model` in Node.

Each turn takes the next reply the test gives with `reply()`: a string, the tool calls the model makes and then its text, or a failure with a native `code`. A turn with no reply given yet waits for one, so the streaming state can be checked first. `requests` lists every turn asked, with its session's configuration, and `setAvailability()` changes what the platform reports.
