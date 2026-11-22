---
__default__: patch
---

A view whose bound `opacity`, `transform` or `background-color` is all that changed since its last commit can have that value patched into what it committed, instead of every prop being merged again.

Bound as `[style.opacity]`, `[style.transform]` or `[style.backgroundColor]`, as a frame of an animation driven from JavaScript changes them: a frame that moves and colours 2,000 views costs about a quarter less, and one that only fades them about a third less. The view is still merged in full where anything else on it changed, a transition or animation is declared anywhere in the app, an `!important` rule or a component's `styleOverride` sets the value, the view is hidden or clipped away, its parent paints its background on it, a transform comes or goes (which can make or unmake it what its absolute children are placed against, where its position or a filter does not already), or the transform is one the patch does not read, such as one in `em` or `calc()`. Where React Native's animated module paints views (iOS, Android, and now macOS and Linux), what the commit's walk has it paint is sent in one batch rather than one a view.
