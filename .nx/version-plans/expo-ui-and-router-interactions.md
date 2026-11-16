---
__default__: patch
---

Interaction observers now hear the typed `@expo/ui` controls from `@ng-native/expo` and the native tab bar and header bar buttons from `@ng-native/router`, each as a `click` with no value.

The `@expo/ui` controls reported are `ui-button`, `ui-segmented-button`, `ui-dropdown-menu-item`, `ui-toggle`, `ui-stepper` (iOS only), `ui-color-picker` (iOS only), `ui-date-picker`, `ui-picker` (as the picker on Android too, not the segmented button or menu item it draws) and `ui-slider`, once a drag as the finger lifts. A `ui-button`'s event carries its label as `text`, cut to 100 characters. `ui-text-field`, opening a `ui-exposed-dropdown-menu-box` and dismissing a `ui-bottom-sheet` report nothing.

A tap on a native tab, or on a `<native-header-item>` that is a native bar button (iOS), is a `click` labelled with the item's title, or its accessibility label when it has none. The navigation a tab starts is not reported.

`provideInteractionObserver`, `INTERACTION_OBSERVERS` and the interaction types are now also exported from `@ng-native/device`, with `describeElement`, `interactionObservers` and `notifyInteraction` for a package that reports its own controls. `@ng-native/components` exports what it did before.
