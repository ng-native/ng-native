---
__default__: patch
---

`<text-input>` on iOS 26 and later no longer loses the last characters typed quickly while JavaScript is busy, because iOS is no longer sent the latest `eventCount` as the `mostRecentEventCount` prop.

That prop let iOS take the echoed `text` prop as an update, and from iOS 26 the text UIKit typed carries a paragraph style the echoed text lacks, so iOS replaced its own text with the same string and dropped the keystrokes queued behind the replace. On iOS the prop now stays at 0, the count a field starts at, so an initial value and a value set before anything is typed still arrive as the prop; text set from code after typing, a refused or rewritten keystroke and a bound selection arrive with the count through `setTextAndSelection`, as before. Android is unchanged. In `@ng-native/testing`, `fireEvent.changeText` and `userEvent.type` keep counting each field's changes themselves, so an iOS field's committed `mostRecentEventCount` now reads 0 after typing.
