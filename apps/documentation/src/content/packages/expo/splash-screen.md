---
title: Splash screen
summary: Holding the native splash until the app has something worth showing, and letting it go.
---

# Splash screen

`splashScreen` holds the native splash screen up, wired to `expo-splash-screen`. The ordering is
the whole feature, and it is easy to get subtly wrong: the native splash hides itself as soon as
the first frame is drawn, so an app that loads fonts before mounting shows a blank window for as
long as that takes.

## Install

```sh
npx expo install expo-splash-screen
```

```ts
import { splashScreen } from '@ng-native/expo/splash-screen';
```

## The smallest useful example

Preventing the auto-hide has to happen at module scope, before anything else runs. Hiding has to
happen after the first real frame is drawn:

```ts
import { splashScreen } from '@ng-native/expo/splash-screen';
import { loadFonts } from '@ng-native/expo/fonts';

// At module scope, before anything renders.
splashScreen.hold();

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const fonts = loadFonts(styleSheetOf(GlobalStyles));
  mount(Number(rootTag), App, getFabricUIManager(), { globalStyles: styleSheetOf(GlobalStyles) });
  void splashScreen.hideWhenReady(fonts);
});
```

Mounting does not wait for the fonts; the splash screen does. Text laid out before they arrive is
laid out again as each face registers, behind the splash, so nothing is ever seen in the fallback
face.

## `hold()`

Keeps the splash up. Called at module scope, before anything is mounted - the first thing an entry
file does. Failures are swallowed: the only ones are races with the screen already having gone,
and an app that cannot hold its splash should still start. Calling it twice is safe; only the
first call does anything.

## `hide()`

Lets it go. Safe to call whether or not it was ever held.

## `hideWhenReady(work, nextFrame?)`

Hides once `work` resolves (or rejects) _and_ one further frame has passed. Hiding the moment the
work resolves would uncover the frame that was on screen while it ran, which is the empty one -
waiting a frame is what makes the handover invisible, and is why this is one method rather than
two calls at a call site. It hides even when `work` fails, rather than leaving the splash screen
up forever.

## Why this is a value, not a service

`splashScreen` is exported directly, and `hold()` runs before there is an injector at all -
holding the splash is the first thing an entry file does, ahead of `bootstrapApplication` or
anything else. `inject(SplashScreen)` also works, for code that already has an injection context
and wants the same instance; both resolve to the one `Splash` the module created.

## Without the module

On iOS and Android, a missing `expo-splash-screen` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when `hold()` first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, `available` is `false`. `hold()`, `hide()` and `hideWhenReady()` all resolve without touching
anything - the app starts as though the module hides itself instantly, which is what actually
happens: with no `expo-splash-screen`, the native splash hides itself on the first frame anyway.
