---
__default__: patch
---

Under `provideWebCompat()`, a drawing's shape whose `fill` is no colour native reads, `contrast` as Highcharts writes one for a label, is painted in the text's colour rather than in native's default black, so the label stays visible on a dark shape. A `stroke` native cannot read is still drawn as none, as a browser drops it, and an `@ng-native/icons` shape is unchanged.
