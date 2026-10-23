---
'__default__': patch
---

An accessibility setting that changes while `@ng-native/device` is still reading the settings at startup keeps its new value, in `Accessibility` and in the `prefers-reduced-motion` condition `watchConditions` keeps. The startup read answers asynchronously, and its answer replaced whatever a change event had reported in the meantime, so a setting turned off in that gap read as on until it changed again. The startup answer now fills in only the settings no event has reported.
