---
__default__: patch
---

On iOS and Android a `<native-button>` draws an icon's SVG markup, `[icon]="{ svg }"`, before its label in the label's colour, and on Android it draws a bitmap `drawable`, which it took and drew nothing for before.

iOS and Android draw the markup once as an image, through the renderer an SVG `<native-tab>` icon uses: `withSvgIcons(SvgImages)` in `provideNativeRouter`, or the new `SVG_ICON_RENDERER` token from `@ng-native/device` in an app without the router. Without one the button shows no icon and says so once in development, where before it said that only macOS and Linux draw an SVG icon. On iOS the UIButton draws the image as a template image a symbol's height in the title's font, tinted as a symbol is, and an SF Symbol given too wins. The iOS button is native code in `@ng-native/components`, so the image draws in a development build and not in Expo Go.

On Android the button lays its icon, an 18-point `<image>` of the drawable or of the drawn markup, in a row before its label and tints it in the label's colour, black where none is set. The drawable is drawn through React Native's image view, so a PNG or WebP drawable draws and a vector drawable written in XML still draws nothing. A button with no icon is laid out as before.
