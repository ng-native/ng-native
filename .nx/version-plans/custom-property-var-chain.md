---
__default__: patch
---

A custom property set on an element to another token, `[style.--fill-color]="'var(--brand)'"` or `style="--fill-color: var(--brand)"`, now resolves to that token where it is set, following a theme or an ancestor that redefines it, instead of the rules that read it drawing nothing.

The value can have a fallback, written or itself a `var()`: `var(--missing, var(--brand))`. A fallback that is another `var()` now also works for a custom property defined in a stylesheet, and a chain of aliases, such as `--a: var(--b); --b: var(--c)`, now resolves when it ends at a token built from others, such as `--c: hsl(var(--hue), 100%, 50%)`, declared in the same rule. Custom properties in a cycle, such as `--a: var(--b); --b: var(--a)`, are all invalid, as in a browser, so a rule that reads one takes its own fallback; before, one in the cycle could take its fallback instead. A `var()` inside another value set on an element, such as `calc(var(--gap) * 2)`, is still not resolved.
