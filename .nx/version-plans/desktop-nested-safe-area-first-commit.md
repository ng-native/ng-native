---
__default__: patch
---

On macOS and Linux, a safe-area view inside another one now gets the right insets in its first commit, so a page with its own `<screen-safe-area-view>` under a macOS window's toolbar no longer draws one commit at twice the toolbar's height before settling.

A safe-area view's new insets reach the layout only in the commit after the one that tells it, so a view inside it was measured from where it was still mounted and was told the insets the outer view was about to take. Each view is now measured from where the insets of the safe-area views around it will put it, whether they apply them as a margin (`<screen-safe-area-view>`, the stack's own inset view, `<safe-area-view mode="margin">`) or as padding (`<safe-area-view>`). A `<safe-area-provider>` inside such a view hears the frame it will have, too.
