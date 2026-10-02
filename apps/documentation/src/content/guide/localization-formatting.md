---
title: Formatting and right to left
summary: Dates, numbers and currency from Angular's locale data, and mirroring a layout for Arabic.
---

# Formatting and right to left

Alongside translations in [Localization](/guide/localization), language affects date and number
formatting and layout direction.

## Dates, numbers and currency

Angular's `date`, `number`, `percent` and `currency` pipes use `LOCALE_ID` and Angular's locale
data. `@angular/common` does not call `Intl`, so Hermes and browsers behave alike without
polyfills. English is built in; register other languages once, as
[`localisation.ts`](/guide/localization-loading) does with `registerLocaleData(localeFr)`.
With `LOCALE_ID` set to `fr`:

```html
<text>{{ when | date: 'longDate' }}</text>
<!-- 24 septembre 2026 -->
<text>{{ 1234567.891 | number: '1.0-2' }}</text>
<!-- 1 234 567,89 -->
<text>{{ 1234.5 | currency: 'EUR' }}</text>
<!-- 1 234,50 € -->
```

French uses narrow and non-breaking spaces, as in a browser. For regional variants (`fr-CA`,
`en-GB`), register the matching `@angular/common/locales/` data file and
use the full `LOCALE_ID` tag.

### Timezones

`date` accepts the same timezones as in a browser through its third argument: offsets such as
`'+0530'` or `'-05:00'`, `'UTC'`, `'GMT'`, and North American abbreviations such as `'EST'` or
`'PDT'`. `mount()` adds support to Hermes' `Date.parse` for the legacy date form Angular uses to
determine the offset.

```html
<text>{{ when | date: 'HH:mm' : 'UTC' }}</text>
<!-- 14:30 -->
<text>{{ when | date: 'HH:mm' : '+0500' }}</text>
<!-- 19:30 -->
```

Angular does not support named zones such as `'Europe/London'`, in browsers or here. The pipe uses
the device's zone and logs a development warning once, naming the unsupported zone. For named zones,
use `Intl.DateTimeFormat` with `timeZone`, supported by Hermes:

```ts
new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', timeStyle: 'short' }).format(when);
// '23:30'
```

Hermes supports only part of `Intl`, affecting direct callers. The iOS Hermes framework used here
provides `Intl.Collator`, `Intl.DateTimeFormat` and `Intl.NumberFormat`, but no `Intl.PluralRules`,
`Intl.RelativeTimeFormat` or `Intl.ListFormat`. Hence
[Localization](/guide/localization#plurals-and-selects) uses `i18nPlural`. Check missing APIs before
using them, for example `'PluralRules' in Intl`.

Angular's locale data excludes user clock and calendar preferences; an English speaker may use a
24-hour clock. `Locale.calendars()` exposes `uses24hourClock`, `firstWeekday` and `timeZone` to
help choose formats such as `'HH:mm'` instead of `'shortTime'`.

## Right to left

The platform sets direction at startup, independently of translations. Enable `supportsRTL` in
the same plugin entry to lay out a right-to-left language correctly:

```json
["expo-localization", { "supportedLocales": ["en", "ar"], "supportsRTL": true }]
```

React Native chooses direction from the device language at startup; it cannot change while the app
runs. The cascade mirrors padding, text alignment and row-child order without stylesheet changes.
For TypeScript-calculated positions, such as a drawer's opening edge or a slider's drag direction,
use [`Direction`](/packages/device/direction) from `@ng-native/device`. `Locale.rtl()` reports
language direction; branch on `Direction` for the actual layout.
