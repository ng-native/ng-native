---
'__default__': patch
---

`NgIcon` from `@ng-native/icons` does more of what `@ng-icons/core` does on the web:

- It draws `<mask>`, `<clipPath>` and `<use>`. A lets-icons duotone line icon was a solid square, a flag-icons flag lost the stars or emblem it draws with `<use>`, and a flag whose artwork is clipped drew past its edge.
- `provideNgIconsConfig({ size, color, strokeWidth })` sets the default of each. An icon's own input still wins.
- `provideNgIconLoader` is asked for a name no `provideIcons` has. The loader can return a string, a promise or an observable, and `withCaching()` asks it once per name.
- `color="var(--accent)"` resolves against the tokens in scope, where it was sent to native as the text `var(--accent)`.
- A static `aria-label` labels the icon for a screen reader, as `accessibilityLabel` does.
- With no `size`, an icon takes `--ng-icon__size` when something around it sets it, as `<ng-icon-stack size>` does.
- `stroke-dasharray="none"` draws a solid line, and an opacity written as a percentage, `opacity="50%"`, is read as a fraction.
