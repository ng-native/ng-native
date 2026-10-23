---
'__default__': patch
---

`@ng-native/testing` finds an `@expo/ui` `<ui-button>` by role and name, and `userEvent.press` and `fireEvent.press` fire its `(buttonPress)`.

Its role is `button` and its name is its `label`, or the text inside it, as a screen reader reads SwiftUI's and Compose's buttons. Its SwiftUI `role`, such as `destructive`, no longer matches `getByRole`. On iOS, SwiftUI's `disabled` modifier makes it `disabled` and a press on it sends nothing. A press also reaches a `<ui-button>` in a `ui-bottom-sheet`'s bar on iOS. A query for `getByRole('button')` alone now finds `<ui-button>`s as well as core buttons, so a test that expected one match may need a `name`. Other `@expo/ui` controls are not covered yet.
