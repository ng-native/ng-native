---
title: Assets
summary: Bundled images, downloaded before they are needed, as an Angular resource.
---

# Assets

`assets(modules)` downloads the images a screen should not pop in with. `useAssets()` is a hook
around `Asset.loadAsync`, which is already a plain promise with no React in it - what is worth
having is the reason the hook exists: a screen that shows an image bundled with the app still has
to wait for it the first time, and a splash screen or a skeleton is only useful if something says
when the wait is over.

## Install

```sh
npx expo install expo-asset
```

```ts
import { assets } from '@ng-native/expo/assets';
```

## The smallest useful example

```ts
import { Component } from '@angular/core';
import { View, Image } from '@ng-native/components';
import { assets } from '@ng-native/expo/assets';

@Component({
  selector: 'app-hero',
  imports: [View, Image],
  template: `
    @if (hero.isLoading()) {
      <view class="bg-slate-200 h-40" />
    } @else if (hero.error() || !hero.value()?.length) {
      <view class="bg-slate-200 h-40" />
    } @else {
      <image [source]="{ uri: hero.value()![0].uri }" />
    }
  `,
})
export class Hero {
  protected readonly hero = assets(() => [require('./hero.png')]);
}
```

## `assets(modules, options)`

Returns an Angular `ResourceRef`: `value()` is `undefined` until the first load resolves, then the
list of downloaded assets, each carrying `uri`, `width` and `height`; `isLoading()` and `error()`
follow the usual resource shape, and a failed download lands in `error()` rather than being thrown
at a caller who has nothing to do with it.

`modules` is a reactive function: read a signal inside it and a change re-runs the load, which is
what a screen showing one of several pictures wants:

```ts
protected readonly photo = assets(() => [this.photos()[this.index()]]);
```

Called per call site on purpose, for the same reason the hook is: two screens loading different
pictures are two separate waits, and one shared "loaded" signal would have the second screen's
load answer the first's.

An app that wants assets warmed before there is an injector at all - during bootstrap, say - calls
`Asset.loadAsync` from `expo-asset` directly; there is nothing here to add for that case.

## Without the module

On iOS and Android, a missing `expo-asset` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when `assets()` first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, the resource resolves to an empty list rather than
throwing or rejecting.
