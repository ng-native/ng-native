---
__default__: patch
---

On macOS, text with no `textAlign`, in `<text>` and in a `<text-input>` and its placeholder, aligns to the layout's leading side as on iOS, rather than by its script or the system's language.

`<text>` with no `textAlign` in a left-to-right layout now aligns to the left, where a paragraph that starts with a right-to-left script (Hebrew, Arabic) used to align to the right; a justified paragraph's last line still follows its own script. A `<text-input>`, single line or multiline, used to take AppKit's natural alignment from the system's language and ignore `textAlign` and `writingDirection`. With no `textAlign` its text and placeholder now align to the right when `I18nManager.isRTL` is true and to the left otherwise. A `textAlign` that is set on a `<text-input>` applies as React Native iOS applies it, not turned round in right to left: `auto`, `start` and `left` align to the left, `end` and `right` to the right, and `center` and `justify` as named. That differs from `<text>`, where right to left puts `auto` and `start` on the right and `end` on the left and swaps `left` and `right`, as on iOS. `writingDirection` sets the field's base writing direction.
