---
__default__: patch
---

On the GTK desktop host on Linux, the header bar leads with a back and forward pair that follows the window's history, as the router reports it, as the macOS toolbar's chevrons do. A press goes one step back or forward, and a secondary click or a long press on either chevron lists the entries that way, nearest first, to jump to. For an app that reports no history, the back chevron pops the stack in front and forward stays off. The header's `hideBackButton` and its own left items hide the pair, as they hide the back button.
