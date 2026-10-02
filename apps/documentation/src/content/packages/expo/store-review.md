---
title: Store review
summary: Ask for a rating with the platform's own prompt, or link to the store page.
---

# Store review

`StoreReview` is the platform's "rate this app" prompt, bound to `expo-store-review`: the App
Store's review sheet on iOS and the Play Store's in-app review on Android.

The prompt belongs to the platform, and so does the decision whether it appears. iOS shows it at
most three times in a year and says nothing when it declines, so `request()` resolving does not
mean anyone saw a prompt. Ask at a moment of success - a task finished, not an app launched - and
never from a button labeled "Rate us", which is what the store page is for.

## Install

```sh
npx expo install expo-store-review
```

```ts
import { StoreReview } from '@ng-native/expo/store-review';
```

## The smallest useful example

```ts
import { Component, inject } from '@angular/core';
import { StoreReview } from '@ng-native/expo/store-review';

@Component({
  selector: 'app-workout-done',
  template: `<pressable (press)="finish()"><text>Done</text></pressable>`,
})
export class WorkoutDone {
  private readonly review = inject(StoreReview);

  protected async finish(): Promise<void> {
    if (await this.review.hasAction()) await this.review.request();
  }
}
```

## What it does

- **`available()`** - whether the platform has an in-app review prompt.
- **`hasAction()`** - whether `request()` would do anything: show the prompt, or open the store
  page when there is no prompt.
- **`request()`** - asks the platform to show the prompt. Where there is none, it opens the store
  page set as `ios.appStoreUrl` or `android.playStoreUrl` in the app config instead.
- **`storeUrl()`** - that store page, for a "rate us" link that opens the store directly. Null when
  the app config sets none.

## Without the module

On iOS and Android, a missing `expo-store-review` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `available()` and `hasAction()` resolve to `false`,
`storeUrl()` is `null`, and `request()` resolves without doing anything.

## Reference

<!-- api: StoreReview -->
