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

`styleSheetOf()` reads `null`, or a styled base class's sheet, from a static field of the
component's own class (`static sheet = styleSheetOf(GlobalStyles)`), because that runs before the
build attaches the sheet. Read it after the class instead, in a module-scope `const` or a static getter. A
development build warns about that call, and about a `null` sheet given to `loadFonts()` or as
`globalStyles` to `mount()`.

A face that names several files, as an icon font's own stylesheet does for browsers of different
ages, is registered from its TrueType or OpenType file: the one with `format('truetype')` or
`format('opentype')`, or with no format a name ending `.ttf` or `.otf`. A face with neither is
registered from the first file it names. Where `src` is written twice, the second is the one read.

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

### A variable font

A variable font is one file that covers a range of weights. Declare it once, with the range:

```css
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-VariableFont_wght.ttf');
  font-weight: 100 900;
}
```

The face is registered as `Inter-100to900`, a text whose `font-weight` falls in the range is
pointed at it, and the weight stays on the text for the platform to pick the instance by. A weight
outside the range takes the face nearest it, as in a browser. From Expo SDK 58:

- **iOS** draws the font's named instance nearest the weight. A weight between two named instances,
  such as 650, draws one of them.
- **Android 15 and later** draws the weight from the font's `wght` axis. **Android 10 to 14** draw
  it at the nearest hundred, 100 to 900.
- **Android 9 and earlier** draws the font's default instance, made bolder by the platform at a bold
  weight.

Before Expo SDK 58, expo-font registers only the font's default instance, so the weight picks
nothing: iOS draws the default instance at every weight, and Android draws it below 700 and its
system font at 700 and above. The build warns about a face with a range there. On those versions,
declare one file per weight instead, each with the weight it draws:

```css
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-Regular.ttf');
  font-weight: 400;
}

@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter-SemiBold.ttf');
  font-weight: 600;
}
```

Many variable fonts ship their static weights beside the variable file. For one that does not,
fontTools cuts one:

```sh
fonttools varLib.instancer Inter-VariableFont_wght.ttf wght=600 -o Inter-SemiBold.ttf
```

## In a SwiftUI `font` modifier

A `font` modifier on an `@expo/ui` view takes a face by the name it is registered under, as
`font-family` does: the family, or `<family>-<weight>` and the other names above.

```ts
const title: UiModifier[] = [{ $type: 'font', family: 'Nunito Sans-700', size: 17 }];
```

SwiftUI finds a custom face only by the PostScript name inside its file (`NunitoSans-Bold`), and
draws the system font for any other name. So the build reads that name from each face's file, and on
iOS a `font` modifier whose `family` is a name a face is registered under is committed with the
face's PostScript name. A PostScript name, or the name of a font built into the system, is
committed as it is written. Compose finds a face by the name it is registered under, so Android
takes the family as written.

The name is read from a `.ttf`, `.otf`, `.ttc` (its first font) or `.woff` file. A face file in a
format the name cannot be read from, such as `.woff2`, is reported in the build, and a modifier
naming that face needs the PostScript name itself.

A family and a weight are not matched to a face here, as they are for a `<text>`: name the face,
`Nunito Sans-700`, rather than `Nunito Sans` with a `weight`.

A font registered by hand with `inject(Fonts).load(map)` has no stylesheet the build can read a
file from, so a `font` modifier has to name it by its PostScript name. In development, a modifier
naming such a font by the name it was loaded under logs a warning.

## Reading what loaded: `Fonts`

`loadFonts()` runs before there is an injector to inject from, which is why it is a function
rather than a service. `inject(Fonts)` is for afterwards - a screen that wants to ask what is
registered:

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { Fonts } from '@ng-native/expo/fonts';

@Component({
  selector: 'app-family-picker',
  imports: [Text],
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
  stylesheet. A SwiftUI `font` modifier names such a face by its PostScript name, not by the name
  in `map`. `loadSheet(...sheets)` is what `loadFonts()` calls underneath.

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

`inject(Fonts)` does not throw: `Fonts.available` is `false`, and a call, or a read of a value only
the module knows, throws it.

On the web, and in a test that provides no fake, `loadFonts()` resolves without registering
anything, so text renders in the platform's fallback face rather than failing to mount.
`Fonts.available` is `false`, `families()` is empty, and `has()` is always `false`.
