---
__default__: patch
---

`@ng-native/expo` has a `TextRecognition` service whose `recognize(imageUri, { languages, level })` reads the text in an image on iOS, answering the whole text and each line with its confidence and its box in the image's pixels.

It is Vision's `VNRecognizeTextRequest`, from new native code in `@ng-native/expo`, so it needs a new development build. It runs offline and does not need Apple Intelligence. A box is measured from the image's top left corner with the orientation in the file's metadata applied. In Expo Go, on Android, on the web and in Node, `available` is false and `recognize` rejects with a `MissingModuleError`; a test provides a stand-in through `TextRecognition.SOURCE`.
