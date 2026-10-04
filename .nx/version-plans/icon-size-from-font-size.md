---
__default__: minor
---

An `<ng-icon>` with no `size` is `1em`, as big as the text around it, where it was 24 points. That is what `@ng-icons/core` does on the web, and it is how a component library sizes its icons: with a `font-size` on the icon or above it, or a width and height from a stylesheet. An icon with a `size` is unchanged. To keep an unsized icon at 24, give it `size="24"`.
