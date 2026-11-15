---
__default__: patch
---

On macOS `LanguageModel` answers from the desktop host's `NgNativeLocalLlm`, over Apple's Foundation Models on macOS 26 and later: `generate()`, `generateObject()`, `stream()` and `session()` with tools work as on iOS, and `availability` is `notEligible` before macOS 26, `notEnabled` with Apple Intelligence off and `notReady` while macOS prepares the model. A failure carries expo-local-llm's code, so a full context window rejects with `LanguageModelContextExceededError`.
