---
title: Tailwind and platforms
---

Stylesheets work, and for a small app they are plenty. Tailwind is the other way to style one.
`@ng-native/tailwind` takes the CSS Tailwind generates and passes it through the same native CSS
compiler as a component's `styles`, so the two treat a declaration a device cannot draw the same
way: it is dropped with a build warning, and a utility with no native equivalent does nothing on
the device. The preset also adds
what a phone needs and a browser does not: `ios:` and `android:` variants, and safe-area utilities
such as `pt-safe`.

The course sets Tailwind up for you. In an Expo app, a stylesheet imports Tailwind's theme and
utilities and `@ng-native/tailwind/native.css`, but not Tailwind's preflight, which is a browser
reset; `withTailwind` in the Metro config builds it; and the generated stylesheet goes to `mount()`
as `globalStyles`. [Tailwind](/packages/tailwind) covers the setup.

## Swap the screen's stylesheet for classes

Delete `styles` from `app.ts`, and put the same design on the elements as classes:

```html
<view class="flex-1 gap-2 bg-zinc-100 px-5 pt-safe">
  <text class="pt-4 text-3xl font-bold text-zinc-900">Today</text>
  <text class="text-zinc-500">{{ remaining() }} left to do</text>
  ...
</view>
```

`pt-safe` applies the top safe-area inset, and `pt-4` on the title adds the 16 points the
stylesheet's calculation did. `pt-safe-4` would do both on the screen in one class. Either reads
the safe-area custom properties from the first lesson, so on a device they need a
`<safe-area-provider>` too.

## Style the habit row with utilities

Do the same in `habit-row.ts`. `active:` styles the row while a finger is on it:

```html
<pressable
  class="mt-2 flex-row items-center justify-between rounded-xl bg-white p-4 active:bg-zinc-200"
  accessibilityRole="button"
  (press)="toggle.emit()"
>
  <text class="text-base text-zinc-900">{{ name() }}</text>
  <text [class]="done() ? 'text-emerald-600' : 'text-zinc-500'">
    {{ done() ? 'Done' : 'To do' }}
  </text>
</pressable>
```

## Look at home on each platform

`ios:` and `android:` apply a class on one platform only. They match the `platform-ios` or
`platform-android` class that `mount()` puts on the root of a native app, as the preview does too.
For this design, give Android a smaller, medium-weight title, and iOS a small uppercase count.
These are design choices, not platform rules:

```html
<text class="pt-4 text-3xl font-bold text-zinc-900 android:text-2xl android:font-medium">
  Today
</text>
<text class="text-zinc-500 ios:text-xs ios:font-semibold ios:uppercase">
  {{ remaining() }} left to do
</text>
```

Then add `android:rounded-md` to the pressable in `habit-row.ts`, for squarer corners on Android.
Switch the preview between iOS and Android to compare.

The same app runs on macOS through the desktop host, where `macos:` matches `platform-macos`. A Mac
reads smaller type and tighter rows than a phone, so `macos:text-[13px]` or `macos:py-2` is how an
app reaches Mac sizes. The preview shows a phone, so these change nothing in it.

## Follow the phone into dark mode

`dark:` applies beneath an element with the `dark` class. In an app generated from the template,
`src/main.ts` calls `watchConditions(app.engine)`, which keeps that class on the root in step with
the system's color scheme, so `dark:` follows the phone with nothing more to write. This preview
does not run that bootstrap. It reports its Dark setting through `ColorScheme` from
`@ng-native/device`, so here `App` puts the class on its own host element, which is the root:

```ts
import { Component, computed, inject, signal } from '@angular/core';
import { ColorScheme } from '@ng-native/device';

@Component({
  // ...
  host: { '[class.dark]': 'dark()' },
})
export class App {
  private readonly scheme = inject(ColorScheme);
  protected readonly dark = computed(() => this.scheme.current() === 'dark');
}
```

An app with a theme switch of its own works the same way on a device: it calls
`watchConditions(app.engine, { darkClass: false })` and puts the class on its root itself.

Then give the screen, the title and the rows their dark colors: `dark:bg-black` on the screen,
`dark:text-white` on the text, `dark:bg-zinc-900` and `dark:active:bg-zinc-800` on the row. The
preview's Dark setting changes what `ColorScheme` reports, and nothing else.
