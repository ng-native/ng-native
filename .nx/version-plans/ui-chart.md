---
__default__: patch
---

A typed `UiChart` in `@ng-native/expo/expo-ui-components` draws a Swift Charts chart with its data and styles type-checked, in an app and in a widget or Live Activity layout, where `<ui-chart>` was an untyped element that strict templates rejected.

It is iOS only, as Compose has no chart. Each chart type takes a style of its own, and `referenceLines` draws lines across the chart.
