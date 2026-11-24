---
__default__: patch
---

Reading a `--safe-area-inset-*` custom property, or `env(safe-area-inset-*)`, with no `<safe-area-provider>` in the app now warns once in development that only a provider reports them. Before, the property stayed at its fallback with no warning, so on macOS a header left the window's close, minimise and zoom buttons over its content.
