---
__default__: patch
---

`@oxc-angular/vite` is updated to 0.0.41, which fixes the compiler bugs the Metro transform guarded against, so those guards are removed:

- A template arrow function that reads its own parameter, such as `open.update((was) => !was)`, compiles correctly and no longer fails the build.
- A component's `host` and `styles` can use a spread, a concatenation, a constant or a `function` declaration in the same file. A value imported from another file now fails the build with the compiler's own error, which names the import.
- An unclosed control-flow block such as `@if (on() {` is reported by the compiler; Angular's parser still places the error in the template.
- A hot update no longer patches the compiler's update module, which now writes the template's fields itself.

A capitalized element name such as `<View>` still fails the build, with a new message: `element <View> is capitalized`.
