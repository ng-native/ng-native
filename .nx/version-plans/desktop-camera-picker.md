---
__default__: patch
---

On macOS `ImagePicker.capture()` from `@ng-native/expo` takes a photo with the desktop host's own camera sheet, and `Camera.takePicture()` writes a PNG with `imageType: 'png'`.

The sheet shows on the key window with the camera's preview, mirrored, and Cancel (Escape) and Take Photo (Return). The photo is a JPEG at `quality`, not mirrored, shaped as iOS shapes a camera shot: no `assetId` or `fileName`, and `base64` and `exif` only when asked. It takes photos only, so `mediaTypes` asking for videos alone resolves to an empty list. `cameraPermission` on `ImagePicker` is now the camera's permission on macOS, where it used to answer denied; it is asked only when the app declares `NSCameraUsageDescription`. On a Mac with no camera `capture()` rejects. `takePicture()` rejects an `imageType` other than `'jpg'` or `'png'` on macOS, as on iOS.
