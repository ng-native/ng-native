---
title: Text recognition
summary: The text in a photo, line by line, read on the device with no network.
---

# Text recognition

`TextRecognition` reads the text in an image: a receipt, a letter or a label someone photographed
or picked from their library. It answers the whole text and each line with its confidence and its
box in the image. It runs on the device, offline, and does not need Apple Intelligence, so it also
works where the [on-device language model](/packages/expo/language-model) is unavailable. It is
`@ng-native/expo`'s own native code on iOS, and the desktop host's on macOS. Android and the web
have no Vision.

<!-- platforms: TextRecognition -->

## Install

Recognition itself needs nothing beyond `@ng-native/expo`. Its native half is in a development
build; Expo Go cannot load it. The example below picks its photo with the
[image picker](/packages/expo/image-picker), which needs `npx expo install expo-image-picker`.

```ts
import { TextRecognition } from '@ng-native/expo/text-recognition';
```

## The smallest thing that works

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text, View } from '@ng-native/components';
import { ImagePicker } from '@ng-native/expo/image-picker';
import { TextRecognition } from '@ng-native/expo/text-recognition';

@Component({
  selector: 'app-receipt',
  imports: [Pressable, Text, View],
  template: `
    <view>
      @if (ocr.available()) {
        <pressable accessibilityRole="button" (press)="read()">
          <text>Read a receipt</text>
        </pressable>
      }
      <text>{{ text() }}</text>
    </view>
  `,
})
export class Receipt {
  protected readonly ocr = inject(TextRecognition);
  private readonly picker = inject(ImagePicker);
  protected readonly text = signal('');

  protected async read(): Promise<void> {
    const [photo] = await this.picker.pick({ mediaTypes: ['images'] });
    if (!photo) return;
    const result = await this.ocr.recognize(photo.uri, { languages: ['en-GB'] });
    this.text.set(result.text);
  }
}
```

## Reading an image

`recognize(imageUri, options)` takes a `file://` URI, such as the camera, the
[image picker](/packages/expo/image-picker) or a downloaded file gives, and answers:

| Field    | What it is                                                                                  |
| -------- | ------------------------------------------------------------------------------------------- |
| `text`   | Every line in the order Vision reads them, joined by newlines. Empty when there is no text. |
| `lines`  | Each line as `{ text, confidence, box }`.                                                   |
| `width`  | The image's width in pixels, the right way up.                                              |
| `height` | The image's height in pixels, the right way up.                                             |

`confidence` runs from 0 to 1. `box` is `{ x, y, width, height }` in the image's pixels, from its
top left corner, the right way up: a photo the camera stored on its side, with an orientation in
its metadata, is turned upright before it is read. To draw a box over the image shown at another
size, scale it by the shown width over `width`.

The options:

- `languages`: the languages to read, most likely first, as BCP 47 codes such as `en-GB` or
  `fr-FR`. Left out, Vision detects the language. Vision reads one variant of most languages, so a
  code it does not list reads as the first variant of the same language it does: `en-GB` as
  `en-US`, `pt-PT` as `pt-BR`. A language it has no variant of at the chosen level rejects the
  call, and the error lists the ones it can. `fast` reads fewer languages than `accurate`.

  Chinese and Cantonese go by script, as Vision lists them: `zh-TW`, `zh-HK` and `zh-MO` read
  Traditional (`zh-Hant`), other regions Simplified (`zh-Hans`), and a script in the code, such as
  `zh-Hant-CN`, wins. `yue` codes do the same.

- `level`: `accurate`, the default, reads more and takes longer. `fast` suits a quick check.

A file that is not an image, or a URI that is not a file, rejects with `ERR_IMAGE_LOAD`. A failure
in Vision rejects with `ERR_TEXT_RECOGNITION`.

## Scanning a document

`scanDocument()` opens the system's document camera, VisionKit's, which finds the page's edges,
straightens it and lets the person scan several pages before saving. It answers each page with its
`imageUri`, a JPEG in the app's caches directory, and the text read in it, the same as `recognize`
answers. The person cancelling answers no pages. It takes the same `languages` and `level`.

```ts
import { Component, inject, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { TextRecognition, type ScannedPage } from '@ng-native/expo/text-recognition';

@Component({
  selector: 'app-scan',
  imports: [Pressable, Text],
  template: `
    @if (ocr.scannerAvailable()) {
      <pressable (press)="scan()"><text>Scan a letter</text></pressable>
    }
    @for (page of pages(); track page.imageUri) {
      <text>{{ page.text }}</text>
    }
  `,
})
export class Scan {
  protected readonly ocr = inject(TextRecognition);
  protected readonly pages = signal<readonly ScannedPage[]>([]);

  protected async scan(): Promise<void> {
    this.pages.set(await this.ocr.scanDocument());
  }
}
```

The camera needs a reason shown to the person, in `app.json`, or iOS stops the app when the
camera opens:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCameraUsageDescription": "Scans documents to read their text."
      }
    }
  }
}
```

`scannerAvailable` is false where there is no document camera: the iOS simulator, macOS, Android
and the web. There `scanDocument` answers no pages without opening anything, so hide the button.
In the simulator and on macOS, `recognize` still reads an image the app already has. A failure of
the camera itself rejects with `ERR_DOCUMENT_SCAN`. Saving the files the pages are in is up to the
app: the system may remove them from the caches directory.

## Turning text into a typed object

With the [on-device language model](/packages/expo/language-model) available, `generateObject` turns
the text into fields. Where it is not, the lines can fill a form for the person to check.

```ts
const { text } = await this.ocr.recognize(photo.uri);
if (this.model.available()) {
  const receipt = await this.model.generateObject<{ shop: string; total: number }>(
    `Read this receipt:\n${text}`,
    { shop: { type: 'string' }, total: { type: 'number' } },
  );
}
```

## Platform differences

- **iOS:** Vision's `VNRecognizeTextRequest`, on iOS 16.4 and later, and VisionKit's document
  camera on a device with a camera.
- **macOS:** the same Vision request in the desktop host, with the same answers. No document
  camera.
- **Android:** not yet available. `available()` is false, `recognize` answers no text and
  `scanDocument` answers no pages.

## Without the native module

In Expo Go, on Android, on the web and in Node tests there is no native module, and
`available()` is false. On Android and the web `recognize` answers no text and `scanDocument` no
pages; in Expo Go on iOS and in Node both reject with a `MissingModuleError` that says why. A test
provides a stand-in through `TextRecognition.SOURCE`:

```ts
import { injectService } from '@ng-native/testing';
import { TextRecognition } from '@ng-native/expo/text-recognition';

const ocr = injectService(TextRecognition, {
  providers: [
    {
      provide: TextRecognition.SOURCE,
      useValue: {
        recognize: async () => ({ text: 'Total 4.20', lines: [], width: 600, height: 900 }),
      },
    },
  ],
});
```
