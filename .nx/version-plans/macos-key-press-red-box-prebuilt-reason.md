---
__default__: patch
---

On macOS a `<text-input>` sends `(keyPress)`, and on macOS and Linux it also names `Escape`, `Tab` and the arrow keys.

macOS sent no `(keyPress)` at all. It now sends one for a typed character and for Backspace and Enter, with React Native's names, from single-line and multiline inputs alike. On both desktops `Escape`, `Tab` (and Shift-Tab) and `ArrowUp`, `ArrowDown`, `ArrowLeft` and `ArrowRight`, alone or with Shift, are named as a browser names them; iOS and Android do not send these. On macOS a paste or a drop is not a key press, and neither is text an input method is still composing.

On macOS a dev run's red box stays on the first fatal error rather than moving to the errors that follow it, such as `"main" has not been registered` after a module that threw as the bundle loaded. Those are kept behind it to step to, and once you step away from it each new error shows as before. Once the dev server has symbolicated a fatal error's stack, the host log has it with the app's own files and lines.

`ng-native-desktop run` and `package` say why they build the host from source rather than use the prebuilt one, such as a host library at another version than the prebuilt host's, and how long a build from source takes, before building one.
