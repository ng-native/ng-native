---
__default__: patch
---

A declaration whose value is invalid once its tokens are known now unsets its property, as in a browser, rather than letting a weaker rule's value for the same property show through.

The property inherits its parent's value when it inherits, and takes its initial value otherwise. A `border`, or one side's, written with tokens, `border: var(--w) var(--s) var(--c)`, now gives each token the role its value says, in any order, and when a token is none of a width, a style and a colour, or a second of one, the whole border is invalid and unset, as in Chrome, where before each token was tried in every role and whichever fitted was kept.
