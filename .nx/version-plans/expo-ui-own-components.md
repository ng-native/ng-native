---
__default__: patch
---

A component of an app's own with a `ui-` selector, such as `ui-button`, is now a plain view drawing its own template after `registerExpoUiViews()`, where its host was committed as the `@expo/ui` view of that name and its template drew nothing.

An element with no component on it is still the native view, and so are the typed components `@ng-native/expo/ui` exports. A view registered with `registerViewName` or `registerExpoView` can ask for the same with the `yieldsToComponents` option, and a component that wraps such a view keeps it by calling `keepNativeView` on its host from its constructor.
