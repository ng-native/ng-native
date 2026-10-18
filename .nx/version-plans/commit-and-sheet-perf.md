---
__default__: patch
---

A commit hands native each cloned view its children in one call, as an array, where it made one call per child, and the sheets of components rendered for the first time are matched against the tree in one walk at the next commit rather than one walk per sheet. What is rendered does not change. `createFakeFabric` from `@ng-native/testing` takes a clone's children as React Native does, as the second argument of `cloneNodeWithNewChildren` and of `cloneNodeWithNewChildrenAndProps`; a test that wraps those methods passes the children on.
