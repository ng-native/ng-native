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

Mounting without waiting for it works too. Text that names a face still loading is laid out in
the fallback face meanwhile, and again in the face once it registers, with a size measured for
it.

A face declared in the Tailwind entry works the same way: pass the generated sheet to
`loadFonts()`. Its `url()` is relative to the entry file, including in a stylesheet the entry
imports, because the Tailwind CLI inlines imports without rewriting their URLs.

## Matching a weight and a style

Native looks a family up by name and that is all, so each face is registered under a name of its
own: `Inter` for the first face declared for the family, and `<family>-<weight>`,
`<family>-<style>` or `<family>-<weight>-<style>` for a face that declares them (`Inter-700`,
`Inter-italic`, `Inter-700-italic`).

The engine does the matching a browser does. Once a text's style is resolved, a `font-family` that
names a declared family is pointed at the face CSS's matching rules pick for its `font-weight` and
`font-style`: the closest style first, then the nearest weight. So `font-family: Inter;
font-weight: 700`, or `class="font-sans font-bold"` with Inter as the sans family, draws the file
declared for 700, wherever the family and the weight were set. The weight and style that picked
the face are then left out of what reaches native, which would otherwise draw the platform's own
font on Android in place of the face.

A weight no declared face covers is left to the platform: iOS draws the family's face as it is,
and Android draws its system font in that weight. An italic or oblique no declared face covers is
dropped, so both platforms draw the upright face rather than Android drawing its system font
slanted.

A face is found once the sheet declaring it has been used, so declare faces in the global
stylesheet, or in the component whose styles use them.

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
being rebuilt since - is a `MissingModuleError`. Its message names the module and the commands
that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).
`loadFonts()` rejects with it rather than throwing, and only when a sheet declares a face, so an
app that should still start mounts after the promise settles either way and draws its text in
the fallback face:

```ts
AppRegistry.registerRunnable('main', ({ rootTag }) => {
  void loadFonts(styleSheetOf(GlobalStyles))
    .catch((error: unknown) => console.error(error))
    .then(() =>
      mount(rootTag, App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) }),
    );
});
```

`inject(Fonts)` throws it when `Fonts` is first injected.

On the web, and in a test that provides no fake, `loadFonts()` resolves without registering
anything, so text renders in the platform's fallback face rather than failing to mount.
`Fonts.available` is `false`, `families()` is empty, and `has()` is always `false`.
