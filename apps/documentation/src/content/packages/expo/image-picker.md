---
title: Image picker
summary: Pick a photo from the library, or take one with the system camera.
---

# Image picker

`ImagePicker` wraps `expo-image-picker`: the system's own photo library and camera UI, not a view
your app draws. Use it for an avatar, an attachment, anything the person picks or shoots once and
hands over.

## Install

```sh
npx expo install expo-image-picker
```

```ts
import { ImagePicker, type PickedAsset } from '@ng-native/expo/image-picker';
```

## The smallest thing that works

```ts
import { Component, inject, signal } from '@angular/core';
import { ImagePicker, type PickedAsset } from '@ng-native/expo/image-picker';

@Component({
  selector: 'app-avatar',
  template: `
    <pressable (press)="choose()"><text>Choose a photo</text></pressable>
    <pressable (press)="take()"><text>Take one</text></pressable>
  `,
})
export class Avatar {
  private readonly picker = inject(ImagePicker);
  protected readonly photo = signal<PickedAsset | null>(null);

  protected async choose(): Promise<void> {
    const [photo] = await this.picker.pick({ mediaTypes: ['images'], allowsEditing: true });
    if (photo) this.photo.set(photo);
  }

  protected async take(): Promise<void> {
    const [photo] = await this.picker.capture({ quality: 0.8 });
    if (photo) this.photo.set(photo);
  }
}
```

## Picking and capturing

- **`pick(options)`** opens the system photo picker. It needs no permission to pick _from_ - the
  system UI runs outside your app's sandbox - so `pick()` never asks for one.
- **`capture(options)`** opens the system camera, asking for the camera permission first. Without
  it, it resolves to an empty list rather than opening the camera.
- Both resolve to a list of assets, **empty if the person canceled** (or refused the camera),
  rather than a result object to unwrap - so a destructured `const [photo] = await picker.pick()`
  gives `undefined`, not a `{ canceled: true }` you have to check first.
- `options` is `expo-image-picker`'s own `ImagePickerOptions`, passed straight through: `mediaTypes`
  (`'images'`, `'videos'`, `'livePhotos'`), `allowsEditing`, `quality`, `allowsMultipleSelection`
  and the rest.

## Permissions

Two separate permissions, each a `Permission` (see [Permissions](/packages/expo/permissions)):

- **`libraryPermission`** guards reading the library yourself, outside `pick()` - the picker itself
  needs nothing. Ask for it only if your app browses or uploads from the library directly.
- **`cameraPermission`** is what `capture()` asks for itself, via `ensure()`. Read
  `cameraPermission.blocked()` to know when to send the person to Settings instead of asking again.

Add to `Info.plist`:

```xml
<key>NSPhotoLibraryUsageDescription</key>
<string>Allow this app to access your photos</string>
<key>NSCameraUsageDescription</key>
<string>Allow this app to access your camera</string>
<key>NSMicrophoneUsageDescription</key>
<string>Allow this app to access your microphone</string>
```

Android's permissions are added automatically by the module's config plugin.

## Without the module

On iOS and Android, a missing `expo-image-picker` - never installed, or installed without the app
being rebuilt since - throws a `MissingModuleError` when the service first reaches for it. Its
message names the module and the commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, every method behaves as though the person
refused: `pick()` and `capture()` resolve to an empty list, and both permissions report `denied`
with `canAskAgain: false` rather than throwing.

## Reference

<!-- api: ImagePicker -->
