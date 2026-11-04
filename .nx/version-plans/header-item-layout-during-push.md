---
__default__: patch
---

On iOS a large title no longer drops into place on every push when a header item holds a `ui-host` with `matchContents`, on a stack whose root page has no header, in a development build with `@ng-native/expo`.

react-native-screens lays the navigation bar out at once whenever a header item's size changes, and such a host has its size only once SwiftUI lays it out, during the push. `@ng-native/expo` now defers that layout until the push or pop ends, for every header item. Expo Go keeps the drop; a host with a fixed size, or `systemImageName`, avoids it there.
