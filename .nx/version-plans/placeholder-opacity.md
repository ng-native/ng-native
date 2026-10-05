---
'__default__': patch
---

`opacity` in a `::placeholder` rule fades the placeholder's colour, so `opacity: 0` hides a placeholder and `opacity: 1` shows it again. It was dropped with a warning, which left a placeholder a stylesheet hides drawn over whatever was meant to show in its place.
