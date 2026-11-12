---
__default__: patch
---

With `@ng-native/web-compat`, a stylesheet's selector of the `style` attribute, such as `[style]`, `[style*=top]` or `:not([style*=top])`, now matches the `style` attribute's text as a script writes it through `element.style` (a property by name, `setProperty`, `removeProperty` or `cssText`) or with `setAttribute`, and matches again each time it changes, as Chrome does. It matched none of that text before, so a library's rule such as Taiga UI's `:host:not([style*=top])` kept its element hidden after the library positioned it.

An empty `style` attribute, which `cssText = ''` or removing a script's last property leaves, still matches `[style]`, and `removeAttribute('style')` stops it matching where a template sets no style on the element, as in Chrome. A copy made with `cloneNode` matches by the attribute it was copied with. Once a script takes away every declaration it wrote, the view's `style` prop is removed rather than left as an empty object. A style a template sets, in a `style` attribute or with a binding, is still not part of the attribute's text.
