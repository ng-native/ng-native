---
__default__: patch
---

HTML's text and layout elements can be written in a template with no import: `span`, `p`, `h1` to `h6`, `label`, `strong`, `em` and the rest draw as text, and `div`, `section`, `ul`, `li` and the rest as views, where each was an unknown element drawn as an empty view.

A text element is text when it holds only text and other text elements, which then flow inline, and a view when it holds anything else. Text written straight into a view is now drawn, as a paragraph of its own, where it drew nothing: a template that left stray text inside a `<view>` shows it. `strong`, `em`, `u`, `s`, `small`, `code` and `mark` have the styles Tailwind's preflight leaves them, a heading and a paragraph have none, and `h1` to `h6` are announced as headings. `@ng-native/web`'s reset gives the same elements the same look.
