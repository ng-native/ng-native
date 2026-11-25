---
title: Image picker
summary: Pick a photo from the library, or take one with the system camera.
---

# Image picker

`ImagePicker` wraps `expo-image-picker`: the system's own photo library and camera UI, not a view
your app draws. Use it for an avatar, an attachment, anything the person picks or shoots once and
hands over.

<!-- platforms: ImagePicker -->

## Install

```sh
npx expo install expo-image-picker
```

```ts
import { ImagePicker, type PickedAsset } from '@ng-native/expo/image-picker';
```

## The smallest useful example

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { ImagePicker, type PickedAsset } from '@ng-native/expo/image-picker';

@Component({
  selector: 'app-avatar',
  imports: [Pressable, Text],
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

## On macOS

macOS has no system camera screen, so `capture()` shows the desktop host's own as a sheet on the
window in front: the camera's preview, mirrored as Photo Booth shows it, with Cancel (Escape) and
Take Photo (Return). The photo is a JPEG at `quality`, not mirrored, and has no `assetId` or
`fileName`, as on iOS.

With `mediaTypes: 'videos'` the shutter is Record, then Stop, with the time recorded beside it.
`mediaTypes: ['images', 'videos']` adds a Photo and Video switch, in photo mode first, as iOS's
camera opens. The video is a QuickTime movie (`video/quicktime`, a `.mov`), not mirrored, recorded
at `videoQuality` and stopped at `videoMaxDuration` seconds when that is set. Its `duration` is in
milliseconds, as on iOS. A request for videos asks for the microphone when it has not been asked
yet. With the microphone refused, the video is recorded with no sound, as on iOS. The microphone
makes the request reject only when the app's `Info.plist` has no `NSMicrophoneUsageDescription`,
with iOS's message. On a Mac with no camera `capture()` rejects.

On the desktop, a picked image has `base64` and `exif` when the options ask for them, as a photo
from `capture()` does. `exif` is read from a JPEG's own EXIF, with expo's tag names and GPS
coordinates in degrees; an image in another format has `exif: null`. A video has neither.

## On Linux

`pick()` opens the desktop's file chooser through the FileChooser portal, or GTK's own where no
portal answers, with one filter for the media types asked for (images, videos or both). It needs no
permission, so `libraryPermission` reads as granted. The files chosen are copied into the app's
caches. An image's size comes from its header. An MP4 or QuickTime video's size and duration come
from the file itself; a video in another container, such as WebM, has a width and height of 0 and
no duration. `selectionLimit` keeps the first files chosen, since the portal has no limit of its
own.

`capture()` shows the desktop host's own camera window over the window in front, with the camera's
preview from the Camera portal, Cancel (Escape) and Take Photo, as on macOS, and a Photo and Video
switch for `mediaTypes: ['images', 'videos']`. `cameraPermission` is the portal's camera access,
asked for once. The video is a QuickTime movie, H.264 where an x264 or OpenH264 encoder and
`h264parse` are installed and Motion JPEG otherwise, with sound only where a microphone is present
and an AAC encoder is installed. With no Camera portal the permission is denied, and on a computer
with no camera `capture()` rejects. Without GStreamer's PipeWire plugin there is no camera at all:
`capture()` resolves to an empty list and `cameraPermission` reads as denied.

## Without the module

On iOS and Android, a missing `expo-image-picker` - never installed, or installed without the app
being rebuilt since - leaves the service made, so injecting it does not throw. A call, or a read of
a value only the module knows, throws a `MissingModuleError`. Its message names the module and the
commands that fix it; see
[Using a module](/packages/expo/using-a-module#what-happens-without-the-module-installed).

On the web, and in a test that provides no fake, every method behaves as though the person
refused: `pick()` and `capture()` resolve to an empty list, and both permissions report `denied`
with `canAskAgain: false` rather than throwing.

## Reference

<!-- api: ImagePicker -->
