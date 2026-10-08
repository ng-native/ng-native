---
title: Localization
summary: Ship an app in more than one language with Angular's own i18n, translated at runtime.
---

# Localization

Use Angular's `i18n` in templates, `$localize` in TypeScript, `localize-extract` to extract
messages, and `loadTranslations()` from `@angular/localize` to load a language. Unlike the Angular
CLI, Metro cannot bake a language into each build. Translations load at runtime before mount, so
one build carries every language.

Verification covers installation in a template app and iOS/Android bundles through `expo export`.
`localisation.test.ts` covers most of the remaining examples through the Metro preset's compiler,
except where explicitly noted as unverified.

## Install

```sh
npm install @angular/localize@<version>
npm install --save-dev @babel/core@^7.29.0
npx expo install expo-localization expo-secure-store
```

Replace `<version>` with your app's exact `@angular/core` version, shown by `npm ls @angular/core`.
It provides `localize-extract`, and its peers include `@angular/compiler` and
`@angular/compiler-cli`. [`Locale`](/packages/expo/locale) uses `expo-localization` to read device
languages. Omit `expo-secure-store` if the app follows the device rather than remembering an in-app
language choice.

### The Babel pin, and why it is not optional

`@angular/localize` 22 uses `@babel/core` 8 for build tools. React Native, Metro's Babel plugins
and `react-native-worklets` use Babel 7, but React Native declares an unranged `@babel/core` peer.
Without a direct Babel 7 dependency, a package manager is free to resolve that peer to Babel 8:

- **pnpm** resolves React Native's peer to `@babel/core@8.0.1` in a fresh app or workspace, and
  the next bundle fails:
  `[Worklets] Babel plugin exception: Requires Babel "^7.0.0-0", but was loaded with "8.0.1"`.
  Bundles without worklets still succeed, hiding the problem until worklets are added.
- **npm** usually nests Babel 8 under `@angular/localize`, but can hoist it to `node_modules`
  and nest Babel 7 under each Metro package. That layout bundles, but is unreliable.

The `@babel/core@^7` dev dependency makes the peer resolve to Babel 7, keeping Babel 8 private to
`@angular/localize`. Neither `@angular/localize/init` nor `loadTranslations()` uses Babel at
runtime. Check the installed versions:

```sh
pnpm why @babel/core     # or: npm ls @babel/core
```

`react-native`, `expo` and `react-native-worklets` should show `7.x`; `8.x` should appear only
under `@angular/localize` and `@angular/compiler-cli`. In pnpm workspaces, also pin Babel in the
root `package.json`: an unpinned package can move every package's React Native onto Babel 8.

### Load the runtime first

`@angular/localize/init` defines the `$localize` global. Import it first in the entry file, before
any component module is evaluated:

```ts
// src/main.ts
import '@angular/localize/init';
import { AppRegistry, Image, Platform, processColor } from 'react-native';
// ...the rest of the entry file
```

## Mark the text

### In a template

`i18n` marks an element's text as a message. Give each one an ID with `@@`, and optionally a
meaning and a description for the translator:

```html
<text i18n="@@home.title">Your basket</text>
<text i18n="checkout|The button that pays@@checkout.pay">Pay now</text>
<text i18n="@@home.greeting">Hello, {{ name() }}!</text>
<text i18n="@@home.hint">Tap <text class="font-bold">the basket</text> to check out</text>
```

The format is `meaning|description@@id`; all parts are optional. Without an `@@id`, the runtime
uses the same text-and-meaning hash as `localize-extract`. Changing the English changes that ID,
orphaning its translations. Prefer custom IDs.

Interpolations become placeholders (`{$INTERPOLATION}`). Nested elements produce paired
placeholders named for the element (`{$START_TAG_TEXT}` and `{$CLOSE_TAG_TEXT}` for a `<text>`),
letting translations move styled text to suit their grammar. Use the names from the extracted
file: a block inside a message has a pair too, such as `{$START_BLOCK_IF}`.

### In TypeScript

`$localize` is a tagged template, with the same `:meaning|description@@id:` block at the front:

```ts
protected readonly saveLabel = $localize`:@@editor.save:Save`;

protected welcome(name: string): string {
  return $localize`:@@home.welcome:Welcome back, ${name}:name:!`;
}
```

The `:name:` after an expression names its placeholder, `{$name}` in the extracted file; without
one it is `{$PH}`.

Keep `$localize` inside classes and functions. Class fields evaluate when components are created,
after translations load. Module-level constants evaluate on import, before translations load, and
remain in the source language.

### Attributes

`i18n-` before an attribute's name marks its value as a message, with the same
`meaning|description@@id` format:

```html
<pressable
  accessibilityRole="button"
  i18n-accessibilityLabel="@@dialog.close"
  accessibilityLabel="Close the dialog"
  (press)="close()"
></pressable>
```

A label built in code is a `$localize` string, bound as any other value:
`[accessibilityLabel]="closeLabel"`.

### Plurals and selects

An ICU expression chooses between messages by a number or a string, on iOS and Android; for the
web host see [Known limitations](/guide/limitations#i18n-is-runtime-only). Give it an element of
its own, so the whole expression is one message under your ID:

```html
<text i18n="@@basket.count"
  >{count(), plural, =0 {Your basket is empty} one {One item} other {{{ count() }} items}}</text
>
<text i18n="@@reply.author">{reply().author, select, me {You replied} other {They replied}}</text>
```

A plural takes an exact `=N` case first. Otherwise `LOCALE_ID` selects a category using Angular's
locale data, not `Intl`. Include every category your languages need: English uses `one` and
`other`; Polish also uses `few` and `many`. Missing categories fall back to `other`.

The translation is the same expression with its cases translated. The value it chooses by is
`VAR_PLURAL` or `VAR_SELECT`, and an interpolation in a case is `{INTERPOLATION}`:

```json
"basket.count": "{VAR_PLURAL, plural, =0 {Votre panier est vide} one {Un article} other {{INTERPOLATION} articles}}"
```

A case holds text and interpolations. An element inside a case, such as `<text>`, is left out with
its content; see [Known limitations](/guide/limitations#i18n-is-runtime-only). A case is read as
HTML, so write `&amp;` and `&lt;` for `&` and `<` in a translation. Numeric character references
are read, and of the named ones only `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and `&nbsp;`.

With text beside the expression in the same element, Angular extracts the expression as a second
message under a computed ID.

For a plural in TypeScript, use Angular's `i18nPlural` pipe with a `$localize` string per form:

```ts
import { Component, input } from '@angular/core';
import { I18nPluralPipe } from '@angular/common';
import { Text } from '@ng-native/components';

@Component({
  selector: 'app-basket-count',
  imports: [I18nPluralPipe, Text],
  template: `<text>{{ count() | i18nPlural: items }}</text>`,
})
export class BasketCount {
  readonly count = input.required<number>();
  protected readonly items: Record<string, string> = {
    '=0': $localize`:@@basket.empty:Your basket is empty`,
    one: $localize`:@@basket.one:One item`,
    other: $localize`:@@basket.other:# items`,
  };
}
```

`#` becomes the number. To choose a category in code, use
`inject(NgLocalization).getPluralCategory(count)` from `@angular/common`: Hermes has
`Intl.NumberFormat` and `Intl.DateTimeFormat` but no `Intl.PluralRules`, so
`new Intl.PluralRules(...)` throws on device.

## Recipes

- [Extracting messages](/guide/localization-extraction) - pulling `messages.json` out of a Metro
  bundle, and translating a copy of it.
- [Loading a language](/guide/localization-loading) - deciding `LOCALE_ID` and loading its
  translations before the app's first frame.
- [Switching language](/guide/localization-switching) - in the app, and following the system.
- [Formatting and right to left](/guide/localization-formatting) - dates, numbers, currency, and
  mirroring a layout.

## What does not work yet

- **Build-time translation** (`localize-translate`, one bundle per language) has no Metro
  integration or verification. Use runtime translation.
- **`ng extract-i18n`** requires an unsupported browser build. Use `localize-extract` on the Metro
  bundle; see [Extracting messages](/guide/localization-extraction).

See [Known limitations](/guide/limitations#i18n-is-runtime-only).
