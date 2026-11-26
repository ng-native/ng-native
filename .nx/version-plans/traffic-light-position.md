---
__default__: patch
---

On macOS, `trafficLightPosition` in a window's options places the window controls, as Electron's option of the same name does: `provideMainWindow({ titleBar: 'hidden', trafficLightPosition: { x: 18, y: 28 } })` puts the close button's top-left 18 points in and 28 down, with the minimise and zoom buttons beside it.

The title bar grows to hold them, they stay there as the window resizes, becomes key and leaves full screen, and `--safe-area-inset-titlebar-leading` follows them. Linux and iPadOS ignore it.
