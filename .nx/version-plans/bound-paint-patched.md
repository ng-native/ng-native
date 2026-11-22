---
__default__: patch
---

A view whose bound `opacity`, `transform` or `background-color` (`[style.opacity]`, `[style.transform]`, `[style.backgroundColor]`) is all that changed since its last commit has it patched into what it committed, instead of every prop being merged again: a frame of an animation driven from JavaScript that moves and colours 2,000 views costs about a quarter less, and one that only fades them about a third less. A change of anything else on the view, a transition or animation in the app, or an `!important` rule over the value still merges the view in full. Where React Native's animated module paints views (iOS, Android, and now macOS and Linux), what one commit has it paint is sent in one batch rather than one a view.
