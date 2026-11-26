---
title: Switching language
summary: Restart the JavaScript to change LOCALE_ID in the app, or let the system do it.
---

# Switching language

After [Loading a language](/guide/localization-loading), calling `loadTranslations()` again changes
no existing templates, even after unmounting and remounting. Template messages are evaluated on the
component's first render anywhere in the app and cached for the JavaScript runtime's lifetime.
`$localize` class fields in newly created components use the new language, producing mixed-language
screens.

Restart JavaScript to switch languages. Expo can reload in place:

```ts
import { Component, LOCALE_ID, inject } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { reloadAppAsync } from 'expo';
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
  protected readonly current = inject(LOCALE_ID);
  protected readonly languages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
  ];

  protected async switchTo(code: string): Promise<void> {
    if (code === this.current) return;
    await setItemAsync('language', code);
    await reloadAppAsync('The language changed');
  }
}
```

Store the choice where startup can read it _synchronously_, before `LOCALE_ID` is set for the first
frame. `expo-secure-store`'s `getItem` can read synchronously; AsyncStorage cannot. Await the write
before reloading to avoid a race. Display language names in their own languages so users can
recover from an unreadable choice.

Alternatively, let the system manage language without app code. With `supportedLocales`, iOS and
Android 13+ expose per-app language settings, which `Locale` reports:

```json
{
  "expo": {
    "plugins": [["expo-localization", { "supportedLocales": ["en", "fr"] }]]
  }
}
```

iOS terminates the app after a Settings language change; the next launch uses the new language.
Android's behavior for a running React Native app remains unverified. If necessary, on foreground,
compare `chooseLanguage` over `Locale.locales()` with `LOCALE_ID` and reload if they differ.

Expo documents `reloadAppAsync` for release and development builds; device behavior remains
unverified here.

Next: [Formatting and right to left](/guide/localization-formatting) covers dates, numbers and
layout mirroring.
