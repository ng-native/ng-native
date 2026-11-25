---
__default__: patch
---

`TextRecognition` in `@ng-native/expo/text-recognition` gains `scanDocument()`, which opens VisionKit's document camera on iOS and answers each scanned page's image and the text read in it.

The pages are JPEGs in the app's caches directory, read with the same `languages` and `level` as `recognize`, and cancelling answers no pages. The new `scannerAvailable` signal is false where there is no document camera (the iOS simulator, macOS, Android and the web), and there `scanDocument` answers no pages without opening anything. The app needs `NSCameraUsageDescription` in its iOS `infoPlist`.
