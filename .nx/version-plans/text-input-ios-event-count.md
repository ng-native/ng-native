---
__default__: patch
---

`<text-input>` on iOS 26 and later no longer loses characters typed quickly into an empty field, because iOS is sent the latest `eventCount` as the `mostRecentEventCount` prop only with a change to a multiline field's text style.

UIKit gives an empty field's first typed text a paragraph style whose line break strategy differs from the one React Native compares an echoed `text` prop with, so an echo carrying the latest count replaced that text with the same string and dropped the keystrokes queued behind the replace. On iOS the prop now stays at 0, the count a field starts at, so an initial value and a value set before anything is typed still arrive as the prop; text set from code after typing, a refused or rewritten keystroke and a bound selection arrive with the count through `setTextAndSelection`, as before. The commit that changes a multiline field's color, font or another text style carries the latest count, so the text already typed is restyled. Android is unchanged. In `@ng-native/testing`, `fireEvent.changeText` and `userEvent.type` count each field's changes themselves, so an iOS field's committed `mostRecentEventCount` reads 0 after typing, but after a multiline field is restyled.
