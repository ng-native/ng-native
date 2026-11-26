---
__default__: patch
---

On Linux a `<text-input>` sends no `(keyPress)` for an input method's composition, as on iOS and macOS, and Space and Return press the focused view, as on macOS.

With an input method such as Japanese or Pinyin, the GTK host sent a `(keyPress)` for each keystroke of a composition, Return and the arrows included. It now sends none from a composition's first keystroke to its commit; outside one, a key that types a character sends its `(keyPress)` as its text goes in, still before the change, and a named key such as Backspace or an arrow sends its own as it is pressed. A read-only input sends none for a key that types a character.

On Linux, Space and Return (and the keypad's Enter) press a focused view, so a focused `<pressable>` fires `(press)` and a `<pressable [menu]>` opens its menu from the keyboard. A window's default button takes Return first, and a key held down presses once, as on macOS.

The shortcuts docs now say that on macOS and Linux a `shortcut` with no modifier takes its key from a focused text input.
