---
__default__: patch
---

`userEvent.press`, `userEvent.longPress`, `userEvent.type`, `userEvent.clear` and `fireEvent.press` do nothing on a screen nobody can see, a native stack screen another covers or a tab behind the selected one, where before they reached a node found there with `includeHiddenElements`. A `userEvent.press` or `userEvent.longPress` whose screen goes out of sight while the finger is down ends in a cancelled touch, with no press.

Content of an `@expo/ui` sheet or popover presented from such a screen still takes a press, as it shows in a window of its own. A node hidden only from accessibility still takes a press, as React Native Testing Library presses it.
