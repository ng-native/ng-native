---
__default__: patch
---

A gradient whose stop colour or stop position reads a custom property that is set but of the wrong kind now paints nothing, as in a browser, rather than taking the position written beside it or leaving the stop out.

A stop whose colour token is not set is still left out, which is how Tailwind's optional `via-*` colour disappears, and a position token that is not set still takes the position written beside it.
