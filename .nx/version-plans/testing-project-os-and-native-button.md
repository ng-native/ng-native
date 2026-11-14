---
__default__: patch
---

`@ng-native/testing`: a `render` that names no `os` renders as the project's (the Vitest preset's `os`, from `expo.platforms`), so a desktop-only app's tests get a Mac's tokens, pointer and desktop fakes without passing `os: 'macos'` to each render. `userEvent.keyboard` presses a drawn menu bar's key equivalents, as AppKit does. A `<native-button>` is found by its label with `getByRole('button', { name })`, and `userEvent.press` sends it the press the host's button does, unless it is disabled.
