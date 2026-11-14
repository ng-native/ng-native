---
__default__: patch
---

On macOS, `import 'expo'` installs a `fetch` whose `Response` streams its `body` over React Native's Networking module, as Expo's `fetch` does on iOS and Android, so `HttpClient` with plain `provideHttpClient()` gets response bodies there too. The body is read as text: a binary response is not byte-exact through `body`, `arrayBuffer()` or `blob()`, and a debug build warns when one arrives. `EXPO_PUBLIC_USE_RN_FETCH` set to `1` or `true` keeps React Native's own `fetch`.
