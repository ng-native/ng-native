---
__default__: patch
---

Fast Refresh works on the GTK desktop host on Linux: an edit reaches the running app, and the app reconnects after a full reload. A JavaScript `WebSocket` on Linux opens an `http` or `https` url as `ws` or `wss`, as macOS does, and React Native's HMR client opens Metro's `/hot` by such a url. Before, Linux refused the url and the app never heard of an edit.

A one-line `<text-input>` on Linux shows its placeholder in `placeholderTextColor` and in the text's font, and `autoCapitalize` of `characters` or `words` capitalizes what is typed or pasted, one line or many, as on macOS. `characters`, `words` and `sentences` also go to the input method as GTK's capitalization hints, so an on-screen keyboard can shift to match; Linux has no sentence rule of its own, so `sentences` is that hint alone.
