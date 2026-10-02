---
__default__: patch
---

`<ui-text>` shows the text written inside it, `<ui-text>Us {{ score() }}</ui-text>`, as `<text>` does, where it showed nothing: `@expo/ui`'s `Text` reads its text from a prop and takes no child views, and the content was dropped. `text` still sets it, and wins when both are given. `registerViewName` and `registerExpoView` take a `textContent` option for any other view that reads its text from a prop.
