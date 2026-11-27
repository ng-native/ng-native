---
__default__: patch
---

On macOS, a window the app opens, its main window included, waits up to 0.3 seconds for its content to have the title bar's safe areas and its native controls' sizes before it first shows, so content padded by `--safe-area-inset-titlebar-leading` starts clear of the window controls.

A window whose content has not settled by then is shown anyway, and its content can still move as the values arrive. The host's own fallback window already waited the same way, and a splash screen the app holds still keeps the window hidden. On the reporter's probe with `titleBar: 'hidden'`, the inset reached the app before the first frame instead of after it, with the first frame at the same time.
