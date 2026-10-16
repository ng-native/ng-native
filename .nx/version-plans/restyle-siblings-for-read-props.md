---
__default__: patch
---

A prop that no rule asks of an element before another (`[data-on] ~ .x`, `#lead + .x`) no longer restyles every element after the one it changed on, and neither does a style bound to a token (`[style.color]="'var(--ink)'"`), where a stylesheet has sibling rules.

A long list whose rows set props as they change, such as a chart's points under a finger, styles the changed row alone. A global sheet that asks about a prop that way starts restyling the rows after it as it is added, and stops once it is removed or replaced.
