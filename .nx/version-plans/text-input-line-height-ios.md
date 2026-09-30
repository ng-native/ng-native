---
__default__: patch
---

On iOS, a single-line `<text-input>` with a line height centres its text, and its line height sets its height as it does on Android and in a browser.

React Native's iOS text field drew the text at the bottom of a line box taller than the font: 4.7pt low in a 44pt field with a 16px font and a 24px line height, which every Tailwind font-size utility brings, and 20.7pt low with `leading-10`. A single-line field on iOS now commits no `lineHeight` and a `minHeight` of line height, padding and border instead (the larger of it and its own `min-height`), so its height is unchanged and the text is centred. An explicit `height` still sizes the field alone. A `multiline` field keeps its `lineHeight`, and Android is unchanged.
