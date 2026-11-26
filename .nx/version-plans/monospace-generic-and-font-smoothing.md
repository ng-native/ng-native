---
__default__: patch
---

`font-family: ui-monospace` now draws in SF Mono on macOS and in Android's monospaced face on Android, `font-family: monospace` draws in SF Mono on iOS, and `-webkit-font-smoothing: antialiased` turns off font smoothing for text on macOS.

Before, `ui-monospace` drew in the system font on macOS and Android, and `monospace` drew in the system font on iOS. `-webkit-font-smoothing` takes `auto`, `none`, `antialiased` and `subpixel-antialiased`, is inherited, and is drawn by a `<text>` on the macOS host, as Chrome and Safari draw it on a Mac; it changes nothing on iOS, Android or Linux, and no longer warns there. `-moz-osx-font-smoothing` is left out without a warning.
