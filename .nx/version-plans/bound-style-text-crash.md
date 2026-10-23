---
__default__: patch
---

A style or a custom property bound to text from outside the app's own code, such as a theme fetched from a server, no longer throws in the middle of change detection. Two shapes did, and while the text stayed bound the rest of that view's bindings were skipped on every tick:

- a function named after a property every object has, `[style.color]="'constructor(from red r g b)'"` (`TypeError: keywords is not iterable`);
- brackets nested a few thousand deep, in a `calc()`, a `color-mix()`, a relative colour or a `var()` fallback, which overflowed the stack.

Both are now left unset, as any other value the engine cannot read is. Brackets nested more than 32 deep are not read.

Two smaller cases of the same kind are fixed with them. A bound word named after such a property, `constructor`, is no longer sent to native as a font weight, and `constructor(var(--c))` is no longer drawn as `rgb(var(--c))`. A colour function that is not a colour is no longer read a second time as part of a `color-mix()`, which read each one nested in its fallbacks twice: sixteen of them, about 300 characters, took some 400 ms.
