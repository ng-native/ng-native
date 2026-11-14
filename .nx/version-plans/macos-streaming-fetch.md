---
__default__: patch
---

On macOS, `import 'expo'` installs a `fetch` whose `Response` streams its `body` over React Native's Networking module, as Expo's `fetch` does on iOS and Android, so `HttpClient` with plain `provideHttpClient()` gets response bodies there too. The host streams the body as bytes, so `body`, `bytes()` and `arrayBuffer()` are byte-exact for a binary response too; `blob()` is made from the body as text. `EXPO_PUBLIC_USE_RN_FETCH` set to `1` or `true` keeps React Native's own `fetch`.
