---
title: Localization with Transloco
summary: Switch language at runtime with no reload, using Transloco scopes and an inline loader.
---

# Localization with Transloco

[Localization](/guide/localization) uses Angular's `i18n`, which fixes the language when the app
starts: changing it means reloading the JavaScript.
[Transloco](https://jsverse.gitbook.io/transloco) looks keys up in a dictionary at runtime instead,
so an in-app language picker takes effect on the next frame, with no reload and no mixed-language
screens. The cost is that you write a key for each text and keep a JSON file per language, where
`i18n` extracts the source text for you.

Choose Transloco when users switch language inside the app, or when you already have Transloco
translation files and tooling. Choose Angular's `i18n` when the language follows the device and a
reload on change is acceptable.

Transloco itself needs no change: it touches
`window` only behind `typeof` guards. Three things differ from a web app, and each has a section
below:

- Metro needs literal import paths, and a device has no `assets/` folder to fetch from, so the
  default HTTP loader does not exist. Use an
  [inline loader](https://jsverse.gitbook.io/transloco/advanced-features/lazy-load/inline-loaders).
- `getBrowserLang()` returns `undefined`, so read the device's language with
  [`Locale`](/packages/expo/locale) (`expo-localization`) and choose the first language yourself.
- The native header does not show a route's `title`, so a title strategy has nothing to show.

## Install

```sh
npm install @jsverse/transloco
```

Transloco is a normal Angular library, so it needs no Metro configuration. Add
`@jsverse/transloco-messageformat` only if you write ICU plurals (see [Plurals](#plurals)).

## Provide Transloco

Register the available languages and the default one. With every file loaded through a scope (see
below), no global loader is needed:

```ts
// app.config.ts
import { isDevMode } from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';

export const appProviders = [
  provideTransloco({
    config: {
      availableLangs: ['en', 'fr', 'ar'],
      defaultLang: 'en',
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
  }),
];
```

`reRenderOnLangChange` is what re-renders a native template when the language changes.

## Load files with an inline loader

On the web, Transloco fetches `assets/i18n/<lang>.json` over HTTP. On a device there is nothing to
fetch, and Metro resolves `import()` paths at build time, so a path computed from the language
(``import(`./i18n/${lang}.json`)``) cannot be bundled. Write one literal `import()` per language.

For a feature's own texts, give the feature a scope with an [inline
loader](https://jsverse.gitbook.io/transloco/advanced-features/lazy-load/inline-loaders), in the
providers of its route. It is the same place a scope is declared on the web, and it needs no central
list of files:

```ts
// settings.routes.ts
import { type Route } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';

export const SETTINGS_ROUTE: Route = {
  path: 'settings',
  providers: [
    provideTranslocoScope({
      scope: 'settings',
      loader: {
        en: () => import('./i18n/settings/en.json'),
        fr: () => import('./i18n/settings/fr.json'),
        ar: () => import('./i18n/settings/ar.json'),
      },
    }),
  ],
  loadComponent: () => import('./settings-page'),
};
```

The scope's files hold their keys without the scope prefix. Transloco unwraps a JSON module's
`default` itself, so the loader returns the `import()` as it is. Enable `resolveJsonModule` in the
app's `tsconfig.json`.

Keys that several features read belong in the global dictionary. Give `provideTransloco` a
`TranslocoLoader` of the same shape, with one literal `import()` per language:

```ts
import { Service } from '@angular/core';
import { type Translation, type TranslocoLoader } from '@jsverse/transloco';

@Service()
export class AppTranslocoLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    const module = await {
      en: () => import('./i18n/en.json'),
      fr: () => import('./i18n/fr.json'),
      ar: () => import('./i18n/ar.json'),
    }[lang === 'fr' || lang === 'ar' ? lang : 'en']();
    return (module as { default?: Translation }).default ?? module;
  }
}
```

```ts
provideTransloco({ loader: AppTranslocoLoader, config: {/* as above */} });
```

Each file becomes its own small Metro module in a development bundle, and a release bundle inlines
them. A forgotten scope shows its keys, not a blank.

## Translate in a template

Use the `transloco` pipe or the structural directive. Both work inside `<text>`. They are
standalone, so import `TranslocoPipe` and `TranslocoDirective` in the component that uses them:

```ts
import { Component, signal } from '@angular/core';
import { TranslocoDirective, TranslocoPipe } from '@jsverse/transloco';
import { Text } from '@ng-native/components';

@Component({
  selector: 'app-settings',
  imports: [Text, TranslocoPipe, TranslocoDirective],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly name = signal('Sam');
}
```

```html
<text>{{ 'settings.title' | transloco }}</text>
<text>{{ 'settings.greet' | transloco: { name: name() } }}</text>

<text *transloco="let t">{{ t('settings.title') }}</text>
```

Write the full key, scope included. Prefer the pipe to `translateSignal()`: under a route that
provides the `settings` scope, `translateSignal('settings.title')` prefixes the scope a second
time and renders `settings.settings.title`.

Do not call `translate()` in a field initializer or a `computed()` that runs before the scope has
loaded: it returns the key. A scope loads the first time a `transloco` pipe or directive renders,
so translate in the template, or in an event handler.

When a component needs a translated string for a prop, translate it where the prop is bound:

```html
<text-input [placeholder]="'form.name' | transloco" />
<pressable [accessibilityLabel]="'common.close' | transloco" (press)="close()" />
```

### Screen titles

Angular still resolves a route's `title` into `ActivatedRoute.snapshot.title`, but the native header
does not show it: a screen's title is an input of the header. `provideTranslocoTitleStrategy()`
therefore has no visible effect (the document stub makes
`Title.setTitle` a no-op that does not throw). Do not use it, and bind the title yourself:

```html
<native-header [title]="'settings.title' | transloco" />
```

## Choose the first language

`getBrowserLang()` returns `undefined` on React Native, because `navigator.language` does not
exist. Use [`Locale`](/packages/expo/locale), which wraps `expo-localization`, to read the device's
languages, and activate one before the first screen shows. The stored choice wins, then the
device's language, then the default. Install the module first:

```sh
npx expo install expo-localization expo-secure-store
```

Omit `expo-secure-store` if the app only follows the device and never remembers an in-app choice.

```ts
import { inject, provideAppInitializer } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Locale } from '@ng-native/expo/locale';
import { getItem } from 'expo-secure-store';

const SUPPORTED = ['en', 'fr', 'ar'];

export function pickLanguage(
  stored: string | null,
  deviceLanguages: readonly (string | null)[],
): string {
  if (stored && SUPPORTED.includes(stored)) return stored;
  // A device locale can have no language code, so skip those.
  const device = deviceLanguages.find((code) => code != null && SUPPORTED.includes(code));
  return device ?? 'en';
}

provideAppInitializer(() => {
  const transloco = inject(TranslocoService);
  const deviceLanguages = inject(Locale)
    .locales()
    .map((locale) => locale.languageCode);
  transloco.setActiveLang(pickLanguage(getItem('language'), deviceLanguages));
});
```

`Locale` keeps its list current as the user changes language in the system settings, and lists
every preferred locale, not only the first. If you cannot add a native module,
`Intl.DateTimeFormat().resolvedOptions().locale` returns the device's first locale on Hermes.

ng-native starts `provideAppInitializer` functions but does not wait for them: the first frame does
not wait. If a screen must not render before the language is active, hold the router outlet back
(for example behind a `ready` signal set after `await lastValueFrom(transloco.load(lang))`).

## Switch language

Call `setActiveLang()` and store the choice. The templates update in the same frame, because the
pipe re-renders on the language change:

```ts
import { Component, inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Pressable, Text, View } from '@ng-native/components';
import { setItemAsync } from 'expo-secure-store';

@Component({
  selector: 'app-language-picker',
  imports: [Pressable, Text, View],
  template: `
    <view>
      @for (language of languages; track language.code) {
        <pressable accessibilityRole="button" (press)="switchTo(language.code)">
          <text>{{ language.name }}</text>
        </pressable>
      }
    </view>
  `,
})
export class LanguagePicker {
  private readonly transloco = inject(TranslocoService);
  protected readonly languages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
  ];

  protected async switchTo(code: string): Promise<void> {
    this.transloco.setActiveLang(code);
    await setItemAsync('language', code);
  }
}
```

Display language names in their own languages so users can recover from an unreadable choice.
Compare [Switching language](/guide/localization-switching) for Angular's `i18n`, which has to
restart the JavaScript.

## Follow the language with the layout direction

Translating to a right-to-left language changes the text, not the layout: views stay left-aligned
until something sets a direction. Bind `direction` on the root view from the active language. The
cascade mirrors paint and layout for every view under it, so a language change needs no restart.
React Native's `I18nManager.forceRTL` does need one, so do not use it for this. Keep the list of
your app's right-to-left languages in one place, and derive the direction from it:

```ts
// language-direction.ts
const RTL_LANGUAGES: readonly string[] = ['ar', 'he', 'fa', 'ur'];

export function isRtl(lang: string | undefined): boolean {
  return !!lang && RTL_LANGUAGES.includes(lang);
}
```

```ts
import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { isRtl } from './language-direction.ts';

@Component({
  selector: 'app-root',
  template: `<view [style.direction]="direction()"><!-- the app --></view>`,
})
export class App {
  private readonly lang = toSignal(inject(TranslocoService).langChanges$);
  protected readonly direction = computed(() => (isRtl(this.lang()) ? 'rtl' : 'ltr'));
}
```

A `modal` reads its layout direction from the
[`Direction`](/packages/device/direction) service, whose default source asks the device. The device
language cannot change while the app runs, and says nothing of a language picked in your settings,
so point the source at Transloco:

```ts
import { inject } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Direction, type DirectionSource, type LayoutDirection } from '@ng-native/device';
import { isRtl } from './language-direction.ts';

function languageDirectionSource(transloco: TranslocoService): DirectionSource {
  const current = (): LayoutDirection => (isRtl(transloco.getActiveLang()) ? 'rtl' : 'ltr');
  return {
    current,
    subscribe: (listener) => {
      const subscription = transloco.langChanges$.subscribe(() => listener(current()));
      return () => subscription.unsubscribe();
    },
  };
}

// in the app's providers
{ provide: Direction.SOURCE, useFactory: () => languageDirectionSource(inject(TranslocoService)) },
```

See [Formatting and right to left](/guide/localization-formatting) for dates, numbers and the
rest of mirroring.

## Plurals

Transloco's default interpolation has no plurals. `@jsverse/transloco-messageformat` adds ICU
`{count, plural, one {...} other {...}}`:

```ts
import { provideTranslocoMessageformat } from '@jsverse/transloco-messageformat';

providers: [provideTranslocoMessageformat()];
```

The plugin builds on `@messageformat/core`, which compiles each message to a function that carries
the plural rules of its language (generated from CLDR, languages with many forms included). Neither
package calls `Intl.PluralRules`, which Hermes lacks on iOS and Android, so plurals need no
polyfill. The runtime does call `Intl.NumberFormat` for number arguments, which Hermes has.

## Extract and validate the keys

`transloco-keys-manager` and `transloco-validator` read source files, so they work on ng-native
templates as they are. A key is found in these forms, all verified inside native templates:

- `{{ 'key' | transloco }}` in a `<text>` or as a prop binding, such as
  `[title]="'key' | transloco"`
- `*transloco="let t"` with `t('key')`
- a ternary of two literals, such as `(cond ? 'a.b' : 'a.c') | transloco`
- a `marker()` call in TypeScript

Give each scope an entry in the `scopePathMap` of `transloco.config.ts`, so its keys land in the
scope's file and not in the global one:

```ts
// transloco.config.ts
import { type TranslocoGlobalConfig } from '@jsverse/transloco-utils';

const config: TranslocoGlobalConfig = {
  rootTranslationsPath: 'src/i18n/',
  langs: ['en', 'fr', 'ar'],
  scopePathMap: {
    settings: 'src/features/settings/i18n/settings',
  },
  keysManager: {
    input: ['src'],
    output: 'src/i18n',
  },
};

export default config;
```

A key stored as a plain string and only bound later (`{{ item.labelKey | transloco }}`) is
invisible to the extractor: wrap it in `marker()` where it is defined.

## Test with Vitest

Transloco has to go through Vite with your code. As an external Node module it brings its own copy
of `@angular/core`, and `inject()` then fails with `NG0203` (no injection context). Metro bundles
one copy, so a device is unaffected. Inline it in `vitest.config.ts`:

```ts
import { ngNative } from '@ng-native/testing/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ngNative({ inline: [/\/node_modules\/@jsverse\/transloco/] })],
});
```

A render test can then provide a scope with an inline loader, render a component, and switch
language, all in the fake Fabric:

```ts
import { provideTranslocoScope } from '@jsverse/transloco';

const scope = provideTranslocoScope({
  scope: 'settings',
  loader: {
    en: () => Promise.resolve({ title: 'Settings' }),
    fr: () => Promise.resolve({ title: 'Réglages' }),
  },
});
```

Call `transloco.setActiveLang('fr')` and wait for the new text with `findByText`: the old text is
gone, with no reload. A component that builds text with `translate()` shows the raw key until the
scope has loaded, so wait for the text and do not read it on the first tick.

## Known limits

- The native header does not show a route's title, so there is no title strategy to configure. See
  [Screen titles](#screen-titles).
- `Intl.PluralRules`, `Intl.RelativeTimeFormat` and `Intl.ListFormat` are missing from Hermes, so
  code that calls them directly throws on device. Transloco and its messageformat plugin do not.
  `Intl.NumberFormat` and `Intl.DateTimeFormat` exist on both platforms, but their output differs:
  Arabic gets Latin digits on iOS and Arabic-Indic digits on Android, and iOS can round
  differently. Pass `numberingSystem` and `calendar` explicitly where the two must match. See
  [Formatting and right to left](/guide/localization-formatting).
- Moving to Transloco from Angular's `i18n` is a rewrite of the texts, not of the build: the two
  do not read each other's files. Transloco has a migration guide from Angular's `i18n`
  ([link](https://jsverse.gitbook.io/transloco/migration-guides/migrate-from-angulars-i18n))
  for the web; the steps for the texts apply to a native app too.
