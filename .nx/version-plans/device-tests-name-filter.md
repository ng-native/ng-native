---
__default__: patch
---

In-app tests from `@ng-native/testing/device` now honour Vitest's `-t` test name filter, so a test it does not match is skipped rather than run.

The pattern reached the app as an empty object, which matched nearly every test name. A file with no test matching the pattern is now reported as skipped too, rather than failing the run with "The snapshot state ... is not found". This applies on iOS, Android, macOS and Linux.
