---
__default__: minor
---

`@ng-native/expo/widget` keeps a home screen widget in step with a signal, and hands the app the taps on its buttons: `widget(widget, props, { onTaps })`. A widget layout's `<ui-button target="...">` now compiles: a tap runs in the widget extension while the app may be suspended, so it records its target in the widget's props as `taps`, and `widget` collects them when the app next runs, before anything is written over them. Its `error` holds why the last sync failed. `(buttonPress)` is an object of the props to change at once, so the widget shows the tap before the app has seen it. `UiButton` gains a `target` input. The padel example has a score widget with a button for each side.
