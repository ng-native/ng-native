---
__default__: patch
---

`LanguageModel.session()` keeps a conversation with the on-device model across turns, with tools the model can call through `defineTool()`, on iOS.

A session's `stream()` and `respond()` see the turns before them, `transcript` is the conversation as plain JSON, and `toolCalls` lists the tool calls running now, on the session and on each reply. Tool handlers run in the session's injection context, so they can `inject()`. A cancelled or failed turn is left out of the transcript, as the model leaves it out of its context. A conversation that outgrows the context window fails with `LanguageModelContextExceededError`. The session is released when the injector it was made in is destroyed, or with `release()`. On Android, `expo-local-llm` refuses a session with tools, and that error reaches the reply unchanged. `LanguageModelStream` gains a `toolCalls` signal, which is always empty for the one-shot `stream()`.
