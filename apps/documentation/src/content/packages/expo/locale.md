---
title: Locale
summary: The user's preferred locales and calendar settings, kept current as they change.
---

# Locale

`Locale` reports the user's preferred locales and calendar settings.

Both of `expo-localization`'s getters are synchronous, so unlike the rest of the device-state
services there is no default to sit at while the platform answers. What makes this worth a service
is that the answers _change_: a user can switch language in Settings and come back, and a date that
was formatted correctly a moment ago is then wrong. `Locale` subscribes to that; nothing else in
the package does.

## Install

```sh
npx expo install expo-localization
```

```ts
import { Locale } from '@ng-native/expo/locale';
```

## The smallest useful example

```ts
import { Component, computed, inject } from '@angular/core';
import { Locale } from '@ng-native/expo/locale';

@Component({
  selector: 'app-date',
  template: `<text>{{ formatted() }}</text>`,
})
export class Date {
  private readonly locale = inject(Locale);
  protected readonly formatted = computed(() =>
    new Intl.DateTimeFormat(this.locale.tag()).format(new globalThis.Date()),
  );
}
```

## What it reports

- **`locales`** - every preferred locale, most preferred first, always at least one entry. That
  ordering is the reason to prefer this over a single locale string: an app that supports the
  user's second language should use it rather than fall back to English.
- **`locale`** - the first entry of `locales`, the one to format with. Null before anything is
  installed.
- **`calendars`** - the user's calendar preferences: `calendar`, `timeZone`, `uses24hourClock`,
  `firstWeekday`.
- **`rtl`** - whether the preferred locale reads right to left. This is a layout decision, not a
  translation one, which is why it is worth a signal of its own rather than folding into `locale`.
- **`tag`** - the preferred locale's language tag, the string `Intl` wants. `undefined` rather than
  a guess when nothing has been reported yet.

## When it updates

`expo-localization` does not export the listeners its own hooks use internally, and a language or
calendar change happens in Settings, outside the app. So `Locale` re-reads when the app comes back
to the foreground, which is exactly when the answer can have changed - a public API (`AppState`)
rather than a path into a build directory.

## Without the module

On iOS and Android, a missing `expo-localization` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `locales` and `calendars` are empty arrays,
`locale` is null, `rtl` is `false`, `tag` is `undefined`.

## Reference

<!-- api: Locale -->
