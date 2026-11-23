---
__default__: patch
---

`userEvent.press`, `userEvent.longPress`, `userEvent.type`, `userEvent.clear` and `fireEvent.press` do nothing on a screen nobody can see, a native stack screen another covers or a tab behind the selected one, where before they reached a node found there with `includeHiddenElements`.

A node hidden only from accessibility still takes a press, as React Native Testing Library presses it.
