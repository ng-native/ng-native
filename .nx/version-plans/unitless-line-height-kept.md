---
'__default__': patch
---

A unitless `line-height` in an app's global stylesheet is now a multiple of the element's own font size, whichever rule that size comes from, as CSS has it.

The Tailwind build multiplied the number by the `font-size` written in the same rule and kept the result, so `.icons { font-size: 24px; line-height: 1 }` on an element another rule made `16px` kept a 24-point line: an icon font drawn smaller sat low in its box. Tailwind's own text sizes come to the same points as before. An element that relied on the larger line now has the one CSS gives it.
