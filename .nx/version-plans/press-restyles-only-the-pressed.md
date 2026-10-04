---
__default__: patch
---

A press no longer styles the whole screen again. `:active` is true of the pressed element and every ancestor up to the root, and each was restyled with everything under it, at touch down and again at release. Now each is only matched again, and keeps its style unless it matches other rules, so a press costs the pressed element and not the screen. A stylesheet that styles what is inside or beside a pressed element (`.card:active .title`, `:has(:active)`, Tailwind's `group-active:`) is restyled as before.
