---
__default__: patch
---

`@ng-native/fabric` exports `DIRECT_EVENTS`, the events the engine delivers to their target only, and `@ng-native/web`'s engine reads the same set. An event in it that the web host is handed, such as `topTextLayout`, `topScrollToTop`, a `react-native-screens` event, `topTabSelected` or `topInsetsChange`, now reaches only its target there too, as it does on native.
