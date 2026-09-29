---
title: Fonts
summary: Registering a stylesheet's custom fonts with the platform before the app mounts.
---

# Fonts

A font on a phone is not fetched when the text engine first needs it: it has to be registered
with the platform before anything is laid out, or the first paint is in the fallback face and
reflows when the real one lands. `loadFonts()` is the call an app makes before it mounts, wired to
`expo-font`.

## Install

```sh
npx expo install expo-font
```

```ts
import { loadFonts } from '@ng-native/expo/fonts';
```

Unlike most services in this package, this goes through `expo-font`'s own JavaScript rather than
its native module directly: the module takes descriptors the JavaScript builds out of an asset,
and rebuilding those here would be copying its internals rather than using it.

## Declaring faces

A face is declared in CSS, collected at build time, and registered before the app mounts:

```css
@font-face {
  font-family: Inter;
  src: url('./fonts/Inter-Regular.ttf');
}
@font-face {
  font-family: Inter;
  src: url('./fonts/Inter-Bold.ttf');
  font-weight: 700;
}
```

```ts
import { loadFonts } from '@ng-native/expo/fonts';

await loadFonts(styleSheetOf(GlobalStyles));
mount(rootTag, App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
```

`font-family: Inter` then means what it says: the `url()` becomes a `require` at build time, so
the bundler ships the file - a plain path would be a font that is simply missing on the device,
with nothing anywhere to say why. `loadFonts()` takes any number of compiled sheets and does
nothing at all when none of them declare a face, so bootstrap can call it unconditionally.

## There is no font matching on a device

Native looks a family up by name and that is all, so a bold cut is a family of its own. The second
face above is registered only as `Inter-700`: the bare `Inter` stays with the first face declared
for the family, and a rule that wants the bold cut asks for `font-family: Inter-700`. Writing
`font-weight: 700` against a family with one registered face gets whatever the platform
synthesizes, exactly as it would in a plain React Native app. A face that declares a `style` is registered the
same way, under `<family>-<style>`.

## Reading what loaded: `Fonts`

`loadFonts()` runs before there is an injector to inject from, which is why it is a function
rather than a service. `inject(Fonts)` is for afterwards - a screen that wants to ask what is
registered:

```ts
import { Component, inject } from '@angular/core';
import { Fonts } from '@ng-native/expo/fonts';

@Component({
  selector: 'app-family-picker',
  template: `@for (family of fonts.families(); track family) {
    <text>{{ family }}</text>
  }`,
})
export class FamilyPicker {
  protected readonly fonts = inject(Fonts);
}
```

- **`families`** - every family the platform can currently find, custom or bundled. A signal, so a
  template re-renders after a later `load()` adds one.
- **`has(family)`** - whether a family is registered, reactive the same way.
- **`available`** - whether `expo-font` is installed at all. Without it a custom face simply never
  appears.
- **`load(map)`** - register faces by name directly, for a font that did not come from a
  stylesheet. `loadSheet(...sheets)` is what `loadFonts()` calls underneath.

## Without the module

On iOS and Android, a missing `expo-font` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when `Fonts` first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `loadFonts()` resolves without registering anything, so text renders in the platform's fallback
face rather than failing to mount. `Fonts.available` is `false`, `families()` is empty, and
`has()` is always `false`.
