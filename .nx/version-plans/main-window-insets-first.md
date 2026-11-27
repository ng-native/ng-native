---
__default__: patch
---

On macOS, a window the app opens, its main window included, now shows once its first frame has the title bar's safe areas and its native controls' sizes, so content padded by `--safe-area-inset-titlebar-leading` no longer starts under the window controls and then moves.

The window waits at most 0.3 seconds for them, as the host's own fallback window already did, and still waits for a splash screen the app holds. On the reporter's probe with `titleBar: 'hidden'`, the inset reached the app before the first frame instead of after it, with the first frame at the same time.
