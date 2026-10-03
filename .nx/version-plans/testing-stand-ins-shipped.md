---
__default__: patch
---

A test of a component with a `[gesture]`, a worklet or Reanimated loads in an app that installed `@ng-native/testing` from npm, where it failed with `Cannot find module '.../@ng-native/testing/src/gestures.ts'`: the Vitest plugin's stand-ins pointed at source files the package does not ship.
