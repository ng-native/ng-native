---
title: Camera
summary: <expo-camera> on screen, and a picture or a video taken from it without a React ref.
---

# Camera

`ImagePicker.capture()` (see [Image picker](/packages/expo/image-picker)) opens the system camera
over your app. For a camera inside your own screen - a scanner, a custom shutter - register the
`<expo-camera>` view and import the `Camera` directive, which applies to every `<expo-camera>` in
the template.

<!-- platforms: Camera -->

## Install

```sh
npx expo install expo-camera
```

```ts
import { Camera, cameraPermission, microphonePermission } from '@ng-native/expo/camera';
```

## The smallest thing that works

```ts
import { Component, viewChild } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { registerExpoViews } from '@ng-native/expo';
import { Camera, cameraPermission } from '@ng-native/expo/camera';

registerExpoViews('expo-camera'); // once, before the app mounts

@Component({
  selector: 'app-shutter',
  imports: [Camera, Pressable, Text],
  template: `
    @if (permission.granted()) {
      <expo-camera facing="back" class="flex-1" />
      <pressable (press)="shoot()"><text>Take picture</text></pressable>
    } @else if (permission.blocked()) {
      <text>Enable camera access in Settings to take a picture.</text>
    } @else {
      <pressable (press)="permission.ensure()"><text>Allow camera access</text></pressable>
    }
  `,
})
export class Shutter {
  private readonly camera = viewChild(Camera);
  protected readonly permission = cameraPermission();

  protected async shoot(): Promise<void> {
    const picture = await this.camera()?.takePicture({ quality: 0.8 });
    if (picture) console.log(picture.uri, picture.width, picture.height);
  }
}
```

The camera renders only once `permission.granted()` is true, and `shoot()` is only reachable from
that branch. `permission.blocked()` is the state where the platform will not show its own dialog
again - `ensure()` would resolve to the same refusal without asking - so that branch sends the
user to Settings instead of retrying.

## Registering the view

`<expo-camera>` is not registered by default. Call `registerExpoViews('expo-camera')` once at
startup, before the first commit that uses the element - it teaches the engine the Fabric
component name for `expo-camera`'s view. `expo-camera` registers as the module's _default_ view
(the Fabric name is `ViewManagerAdapter_ExpoCamera`, with no view name suffix), because the camera
is the only view the module renders.

## The camera permission

The view needs the camera permission before it shows anything. Nothing in `Camera` asks for it -
the directive only takes pictures - so ask yourself, with **`cameraPermission()`**. It returns a
[`Permission`](/packages/expo/permissions): `status()`, `granted()` and `blocked()` as signals, and
`check()`, `request()` and `ensure()` to read or ask.

```ts
protected readonly permission = cameraPermission();
```

Made in an injection context, as a field of a component or a service, it checks a refusal again
each time the app comes back to the front, so turning the camera on in Settings shows the camera
without a restart. On iOS and Android it calls `expo-camera`'s own permission functions, and on
macOS the desktop host's, so the same code runs on each. Where there is no such module, as on the
web or in a test in Node, it answers denied, and `blocked()` is true.

Add to `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Allow this app to access your camera</string>
<key>NSMicrophoneUsageDescription</key>
<string>Allow this app to access your microphone</string>
```

The `CAMERA` (and, for video with audio, `RECORD_AUDIO`) Android permissions are added
automatically by the module's config plugin.

## Taking a picture

**`takePicture(options)`** takes `expo-camera`'s own `CameraPictureOptions` (minus
`onPictureSaved` and `pictureRef`, which do not apply here) and resolves to a
`CameraCapturedPicture` - `uri`, `width`, `height`, and `base64` or `exif` if asked for. It
resolves to **null** before the view has reached the screen, or without the module. The picture is
a JPEG at `quality`, or a PNG with `imageType: 'png'`, which ignores `quality`; on iOS and macOS
any other `imageType` rejects.

In React, `takePictureAsync` is a method on the camera component's ref. Underneath, it is one of
the functions Expo defines on the view itself (`AsyncFunction('takePicture')` in the native
module), which native finds by reading the tag off whatever it is called on. `Camera` calls that
same function with the tag the engine committed the view under, so no ref is needed - `takePicture`
is a method on the directive instance a `viewChild` reaches.

## Recording a video

**`record(options)`** records from the same view and resolves once the recording stops - when
**`stopRecording()`** is called, when `maxDuration` (seconds) or `maxFileSize` (bytes) is reached,
or when the preview stops - to `{ uri }`, a file in the cache directory. It takes `expo-camera`'s
own `CameraRecordingOptions` (minus `mirror`, which `expo-camera` has deprecated for the view's
`mirror` prop), and resolves to **null** before the view has reached the screen, or without the
module.

```html
<expo-camera mode="video" facing="back" class="flex-1" />
```

```ts
protected readonly recording = signal(false);

protected async toggle(): Promise<void> {
  if (this.recording()) {
    await this.camera()?.stopRecording();
    return;
  }
  this.recording.set(true);
  try {
    const video = await this.camera()?.record({ maxDuration: 60 }); // resolves when it stops
    if (video) console.log(video.uri);
  } finally {
    this.recording.set(false);
  }
}
```

The view records with `mode="video"`. Without `mute` on the view, `record()` needs the microphone
permission, **`microphonePermission()`**, a `Permission` like the camera's: without it, Android
rejects, and iOS and macOS record without sound. With `mute`, it records without sound and needs no
microphone permission.

```ts
protected readonly microphone = microphonePermission();

protected async start(): Promise<void> {
  // A refusal records without sound on iOS and macOS, and makes record() reject on Android.
  await this.microphone.ensure();
  try {
    const video = await this.camera()?.record({ maxDuration: 60 });
    if (video) console.log(video.uri);
  } catch (error) {
    console.warn('Not recorded', error);
  }
}
```

On macOS the microphone permission is the one `audioRecorder` needs too, so
`microphonePermission()` and `recordingPermission()` from `@ng-native/expo/audio` answer the same.

On macOS the movie is a QuickTime file (`.mov`) from the Mac's camera, with any `mode`. It has sound
only with the microphone already allowed, and `record()` never asks for it, so it records without
sound otherwise, as iOS does: ask with `microphonePermission()` first. One recording runs at a time
for a view; a second `record()` rejects until the first stops.

## Reference

<!-- api: Camera -->
