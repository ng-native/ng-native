---
__default__: patch
---

A press no longer styles the whole screen again. `:active` is true of the pressed element and every ancestor up to the root, and each was restyled with everything under it, at touch down and again at release. Now each is only matched again, and keeps its style unless it matches other rules, so a press costs the pressed element and not the screen. An element a rule asks about from another one (`.card:active .title`, Tailwind's `group-active:`) is still restyled with what is under it.
