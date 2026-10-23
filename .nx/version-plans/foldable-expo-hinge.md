---
__default__: patch
---

Foldable in @ng-native/expo/foldable reads the posture and the angle from expo-hinge (Expo SDK 58) when it is installed, and keeps reading expo-foldables where expo-hinge is not installed or reports no hinge.

expo-hinge's closed, partiallyOpen, fullyOpen and unknown statuses become the existing 'closed', 'partially-open', 'fully-open' and 'unknown' postures, and its angle becomes angle(). expo-hinge does not report where the fold crosses the window, so fold(), separating(), book() and tabletop() still come from expo-foldables, and are null or false without it. With expo-hinge in the app and expo-foldables not, reading the posture, fold or angle no longer throws an error asking to install expo-foldables. expo-hinge is a new optional peer dependency, and Foldable.HINGE stands in for it in a test.
