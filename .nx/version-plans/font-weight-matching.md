---
__default__: minor
---

A text's `font-weight` and `font-style` now pick the matching declared `@font-face`, as they do on the web. Once a node's style is resolved, a `font-family` naming a declared family is pointed at the face CSS's matching rules choose (closest style, then nearest weight), so `font-family: Inter; font-weight: 600` or `class="font-sans font-semibold"` draws the file declared for 600 rather than the regular face made bold on iOS, or Roboto on Android. A face with both a weight and a style is registered as `<family>-<weight>-<style>` (`Inter-600-italic`), and no longer overwrites `Inter-600` or `Inter-italic` when a face declared exactly that exists. `font-weight: bold` in an `@font-face` is now read as 700; it was dropped.
