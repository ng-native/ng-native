---
'__default__': patch
---

A custom property can hold `platform-color()` or a system colour such as `LinkText`, and `var()` of it in a colour property commits what the colour written there commits.

`--accent: platform-color(link)` was refused where it was defined, so `color: var(--accent)` was dropped. It is now read in a component's sheet, its `:host` rules, a global sheet, a `@media` override such as `prefers-color-scheme: dark`, and a bound `[style.--accent]`, and as a `var()` fallback. A platform colour has no channels, so a `color-mix()`, a relative colour, a gradient, a `box-shadow` or a faded colour (Tailwind's `bg-accent/50`) worked out of such a token is dropped: the build warns where the sheet that sets the token also does that, and in development the engine warns on the device, naming the declaration and the token. A `text-shadow` takes such a token as its colour, as its colour is a property of its own.
