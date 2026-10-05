---
'__default__': patch
---

A `transition` shorthand whose time is a token, `transition: opacity linear var(--duration, 0ms)`, is eased over the time the token is set to, and a time set on an element (`style.setProperty('--duration', '150ms')`, or a bound `[style.--duration]`) is read as one. The shorthand was dropped with a warning and the time was read as a word, so what a library opens with such a transition was there at once.
