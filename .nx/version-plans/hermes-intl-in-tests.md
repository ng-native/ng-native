---
'__default__': minor
---

Tests under `@ng-native/testing` run without the `Intl` constructors Hermes lacks (`DisplayNames`, `DurationFormat`, `ListFormat`, `Locale`, `PluralRules`, `RelativeTimeFormat` and `Segmenter`), so code that builds one fails its test with a `TypeError`, as it fails on a device, rather than passing on Node's.

This is breaking for a test that relies on one of them. Both `ngNative()` and `@ng-native/testing/register` remove them; `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat` are unchanged. A polyfill an app installs in a Vitest setup file, or in a module given to `node --import` after `@ng-native/testing/register`, stays, and one that installs only what `Intl` lacks sees them missing: `ngNative()` removes them ahead of the app's own setup files. To keep Node's full `Intl` in Vitest, pass `ngNative({ intl: 'node' })`.
